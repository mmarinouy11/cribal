import { createHash } from 'crypto'
import Parser from 'rss-parser'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { arceFetch } from '../scraper/arce-http'
import { fetchArceHtml } from '../scraper/fetch-arce'
import { fetchRssFeeds, type FeedStatus, type FetchResult, type RssItem } from './fetcher'
import { normalize } from './normalizer'
import type { TenderItem } from '../scraper/arce-parser'

// Shared, company-independent ingestion. The daily pipeline downloads each ARCE
// feed and tender page once and reuses the result across every company, instead
// of hitting ARCE once per company. Everything here is additive and has a direct
// fallback, so the per-company pipeline keeps working even if these tables are
// empty (e.g. a manual single-company run with no prior global ingestion).

const USER_AGENT = 'Mozilla/5.0 (compatible; Cribal/1.0)'
const FETCH_TIMEOUT_MS = 30_000
// ~1 request / 1.5s, concurrency 1: gentle with ARCE during the global pass.
export const INTER_REQUEST_DELAY_MS = 1_500
// A feed fetched within this window is reused without any request (covers the
// several-companies-in-one-run case).
export const FEED_FRESH_TTL_MS = 6 * 60 * 60 * 1000 // 6h
// Tender detail / HTML considered fresh for a day (re-scraped only after it).
export const DETAIL_FRESH_TTL_MS = 24 * 60 * 60 * 1000 // 24h
// Postgres advisory-lock key for the single global ingestion pass.
const INGESTION_LOCK_KEY = 472900137

const parser = new Parser({ timeout: FETCH_TIMEOUT_MS })

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested — no DB, no network)
// ---------------------------------------------------------------------------

/** Whether a cached value fetched at `fetchedAt` is still fresh at `now`. */
export function isFresh(fetchedAt: Date | null, now: Date, ttlMs: number): boolean {
  if (!fetchedAt) return false
  return now.getTime() - fetchedAt.getTime() < ttlMs
}

/** Conditional-request headers built from a feed-cache row. */
export function conditionalHeaders(
  cache: { etag: string | null; lastModified: string | null } | null
): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  if (cache?.etag) headers['If-None-Match'] = cache.etag
  if (cache?.lastModified) headers['If-Modified-Since'] = cache.lastModified
  return headers
}

/** Stable cache key for company-independent AI work. */
export function contentHash(kind: string, input: string): string {
  return createHash('sha256').update(`${kind}\n${input.trim()}`).digest('hex')
}

/** Map a raw rss-parser item to our RssItem shape (mirrors fetcher.ts). */
function toRssItem(raw: Parser.Item & { [key: string]: unknown }, sourceFeed: string): RssItem {
  const link = (raw.link as string) ?? ''
  const guid = (raw.guid as string) ?? link
  return {
    title: (raw.title as string) ?? '',
    link,
    guid,
    pubDate: (raw.pubDate as string) ?? '',
    content: (raw.content as string) ?? (raw['content:encoded'] as string) ?? '',
    contentSnippet: (raw.contentSnippet as string) ?? '',
    sourceFeed,
  }
}

function toRssItems(items: Prisma.JsonValue | null | undefined): RssItem[] {
  if (!Array.isArray(items)) return []
  return items as unknown as RssItem[]
}

// ---------------------------------------------------------------------------
// Advisory lock (one global ingestion pass at a time)
// ---------------------------------------------------------------------------

async function tryAcquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${INGESTION_LOCK_KEY}) AS locked`
  return rows[0]?.locked === true
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw`SELECT pg_advisory_unlock(${INGESTION_LOCK_KEY})`
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

export interface FeedFetchOutcome {
  url: string
  ok: boolean
  fromCache: boolean // served from a fresh cache or a 304 (not re-downloaded)
  items: RssItem[]
  status: number
  error?: string
}

/**
 * Fetch one feed with conditional requests, backed by the FeedCache row. Reuses
 * the cached body when the cache is fresh or ARCE answers 304; on a network/HTTP
 * error it falls back to the last cached items so a company can still process
 * what was saved.
 */
export async function fetchFeedConditional(url: string, now: Date = new Date()): Promise<FeedFetchOutcome> {
  const cache = await prisma.feedCache.findUnique({ where: { url } })

  // Very fresh → skip the network entirely.
  if (cache && isFresh(cache.lastFetchedAt, now, FEED_FRESH_TTL_MS) && cache.itemsJson) {
    return { url, ok: true, fromCache: true, items: toRssItems(cache.itemsJson), status: cache.lastStatus ?? 200 }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await arceFetch(url, {
      headers: conditionalHeaders(cache),
      cache: 'no-store',
      signal: controller.signal,
    })

    // 304 Not Modified → reuse cached items, just bump lastFetchedAt.
    if (response.status === 304 && cache?.itemsJson) {
      await prisma.feedCache.update({ where: { url }, data: { lastFetchedAt: now, lastStatus: 304 } })
      return { url, ok: true, fromCache: true, items: toRssItems(cache.itemsJson), status: 304 }
    }

    if (!response.ok) {
      await prisma.feedCache.upsert({
        where: { url },
        create: { url, lastFetchedAt: now, lastStatus: response.status },
        update: { lastFetchedAt: now, lastStatus: response.status },
      })
      const items = toRssItems(cache?.itemsJson)
      return { url, ok: false, fromCache: items.length > 0, items, status: response.status, error: `HTTP ${response.status}` }
    }

    const xml = await response.text()
    const parsed = await parser.parseString(xml)
    const items = (parsed.items ?? []).map((raw) => toRssItem(raw, url))
    const etag = response.headers.get('etag')
    const lastModified = response.headers.get('last-modified')
    await prisma.feedCache.upsert({
      where: { url },
      create: {
        url,
        etag,
        lastModified,
        lastFetchedAt: now,
        lastStatus: 200,
        itemsJson: items as unknown as Prisma.InputJsonValue,
        itemCount: items.length,
      },
      update: {
        etag,
        lastModified,
        lastFetchedAt: now,
        lastStatus: 200,
        itemsJson: items as unknown as Prisma.InputJsonValue,
        itemCount: items.length,
      },
    })
    return { url, ok: true, fromCache: false, items, status: 200 }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? `Timeout tras ${FETCH_TIMEOUT_MS / 1000}s`
      : error instanceof Error
        ? error.message
        : String(error)
    await prisma.feedCache.upsert({
      where: { url },
      create: { url, lastFetchedAt: now, lastStatus: 0 },
      update: { lastFetchedAt: now, lastStatus: 0 },
    })
    const items = toRssItems(cache?.itemsJson)
    return { url, ok: false, fromCache: items.length > 0, items, status: 0, error: message }
  } finally {
    clearTimeout(timer)
  }
}

/** Cached items for a feed, or null when there is no usable cache entry. */
export async function getCachedFeedItems(url: string): Promise<RssItem[] | null> {
  const cache = await prisma.feedCache.findUnique({ where: { url } })
  if (!cache || !cache.itemsJson) return null
  if (cache.lastStatus !== 200 && cache.lastStatus !== 304) return null
  return toRssItems(cache.itemsJson)
}

/** Fresh cached items for a feed (within the TTL), or null. */
async function getFreshCachedFeed(url: string, now: Date): Promise<RssItem[] | null> {
  const cache = await prisma.feedCache.findUnique({ where: { url } })
  if (!cache || !cache.itemsJson) return null
  if (cache.lastStatus !== 200 && cache.lastStatus !== 304) return null
  if (!isFresh(cache.lastFetchedAt, now, FEED_FRESH_TTL_MS)) return null
  return toRssItems(cache.itemsJson)
}

/**
 * Feeds for a single company's run: served from the shared cache when it is
 * fresh (the usual case right after the global ingestion pass), and fetched
 * directly — with the normal retry/backoff path — only for feeds the cache does
 * not already hold. This is what makes several companies in one cron pass share
 * a single download per feed, while a manual single-company run still works with
 * no prior ingestion. Items are deduplicated by guid (falling back to link).
 */
export async function fetchCompanyFeeds(feeds: string[], now: Date = new Date()): Promise<FetchResult> {
  const items: RssItem[] = []
  const errors: { feed: string; error: string }[] = []
  const feedStatuses: FeedStatus[] = []
  const seen = new Set<string>()

  const addItems = (feedItems: RssItem[]): void => {
    for (const item of feedItems) {
      const dedupKey = item.guid || item.link
      if (!dedupKey || seen.has(dedupKey)) continue
      seen.add(dedupKey)
      items.push(item)
    }
  }

  const cold: string[] = []
  for (const url of feeds) {
    const cached = await getFreshCachedFeed(url, now)
    if (cached) {
      feedStatuses.push({ url, ok: true, attempts: 0, itemCount: cached.length })
      addItems(cached)
    } else {
      cold.push(url)
    }
  }

  if (cold.length > 0) {
    const direct = await fetchRssFeeds(cold)
    feedStatuses.push(...direct.feedStatuses)
    errors.push(...direct.errors)
    addItems(direct.items)
  }

  return { items, errors, feedStatuses }
}

export interface GlobalIngestionResult {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED'
  feedsTotal: number
  feedsFailed: number
  feedsFromCache: number
}

/**
 * The single global ingestion pass: under an advisory lock, fetch every unique
 * feed URL once (conditional, sequential, rate-limited) and refresh the cache.
 * If another pass holds the lock, returns SKIPPED. On a total ARCE outage the
 * status is FAILED but the caller still proceeds — each company reads whatever
 * is in the cache.
 */
export async function runGlobalIngestion(
  feedUrls: string[],
  now: Date = new Date()
): Promise<GlobalIngestionResult> {
  const unique = [...new Set(feedUrls.filter(Boolean))]

  const acquired = await tryAcquireLock()
  if (!acquired) {
    console.log('[CRIBAL][INGEST] Otra ingesta global está corriendo — se omite')
    return { status: 'SKIPPED', feedsTotal: unique.length, feedsFailed: 0, feedsFromCache: 0 }
  }

  const run = await prisma.globalIngestionRun.create({
    data: { status: 'RUNNING', feedsTotal: unique.length },
  })
  const errors: { feed: string; error: string }[] = []
  let failed = 0
  let fromCache = 0
  let downloaded = 0

  const familiaOf = (url: string): string | null => url.match(/\/familia\/(\d+)/)?.[1] ?? null

  // RSS-level tender rows to share across companies (deduped by tenderId, first
  // feed wins). Detail enrichment fills the rest of each row later.
  const tenderRows = new Map<
    string,
    { tenderId: string; familia: string | null; title: string; rssContent: string; publicationDate: Date | null }
  >()

  try {
    for (let i = 0; i < unique.length; i++) {
      const url = unique[i]
      const outcome = await fetchFeedConditional(url, now)
      if (!outcome.ok) {
        failed++
        errors.push({ feed: url, error: outcome.error ?? 'desconocido' })
      }
      if (outcome.fromCache) fromCache++
      else if (outcome.ok) downloaded++

      const familia = familiaOf(url)
      for (const item of outcome.items) {
        const tender = normalize(item)
        if (!tender.tenderId || tenderRows.has(tender.tenderId)) continue
        tenderRows.set(tender.tenderId, {
          tenderId: tender.tenderId,
          familia,
          title: item.title,
          rssContent: item.content,
          publicationDate: tender.publicationDate,
        })
      }

      // Concurrency 1 + rate limit: wait between requests, not after the last.
      if (i < unique.length - 1) await delay(INTER_REQUEST_DELAY_MS)
    }

    // Persist the new RSS-level tender rows into the shared store. createMany
    // with skipDuplicates inserts only tenders not seen before and tells us how
    // many were new; the rest were reused from earlier reads.
    let newTenders = 0
    if (tenderRows.size > 0) {
      const created = await prisma.globalTender.createMany({
        data: [...tenderRows.values()],
        skipDuplicates: true,
      })
      newTenders = created.count
    }
    const reusedTenders = tenderRows.size - newTenders

    const familyNumbers = [
      ...new Set(unique.map(familiaOf).filter((f): f is string => f !== null)),
    ]
    console.log(
      `[CRIBAL][INGEST] familias=[${familyNumbers.join(', ')}] feeds_descargados=${downloaded} feeds_cache=${fromCache} licitaciones_nuevas=${newTenders} reutilizadas=${reusedTenders}`
    )

    const allFailed = unique.length > 0 && failed === unique.length
    const status = allFailed ? 'FAILED' : failed > 0 ? 'PARTIAL' : 'COMPLETED'
    await prisma.globalIngestionRun.update({
      where: { id: run.id },
      data: {
        tendersEnriched: newTenders,
        status,
        finishedAt: new Date(),
        feedsFailed: failed,
        feedsFromCache: fromCache,
        errors: errors as unknown as Prisma.InputJsonValue,
      },
    })
    return { status, feedsTotal: unique.length, feedsFailed: failed, feedsFromCache: fromCache }
  } finally {
    await releaseLock()
  }
}

// ---------------------------------------------------------------------------
// Tender detail (parsed) — shared across companies by ARCE tenderId
// ---------------------------------------------------------------------------

export interface TenderDetail {
  objectDescription: string | null
  tenderItems: TenderItem[]
  articleCodes: string[]
}

/**
 * Parsed tender detail for `tenderId`, reused from GlobalTender when fresh, else
 * produced by `fetchDetail` (the ARCE scrape) and stored. The fetcher is
 * injected to keep this module free of scraper-specific imports and cycles.
 */
export async function getOrFetchTenderDetail(
  tenderId: string,
  fetchDetail: (tenderId: string) => Promise<TenderDetail>,
  now: Date = new Date()
): Promise<TenderDetail> {
  const existing = await prisma.globalTender.findUnique({ where: { tenderId } })
  const hasParsed =
    existing != null && (existing.objectDescription !== null || existing.tenderItems !== null)
  if (existing && hasParsed && isFresh(existing.detailFetchedAt, now, DETAIL_FRESH_TTL_MS)) {
    return {
      objectDescription: existing.objectDescription,
      tenderItems: (existing.tenderItems as unknown as TenderItem[] | null) ?? [],
      articleCodes: existing.articleCodes,
    }
  }

  const detail = await fetchDetail(tenderId)
  await prisma.globalTender.upsert({
    where: { tenderId },
    create: {
      tenderId,
      objectDescription: detail.objectDescription,
      tenderItems: detail.tenderItems as unknown as Prisma.InputJsonValue,
      articleCodes: detail.articleCodes,
      detailFetchedAt: now,
    },
    update: {
      objectDescription: detail.objectDescription,
      tenderItems: detail.tenderItems as unknown as Prisma.InputJsonValue,
      articleCodes: detail.articleCodes,
      detailFetchedAt: now,
    },
  })
  return detail
}

// ---------------------------------------------------------------------------
// Raw detail HTML — shared across companies (used by opportunity enrichment)
// ---------------------------------------------------------------------------

/**
 * The raw ARCE detail-page HTML for `tenderId`, cached in GlobalTender so the
 * page is downloaded once per day regardless of how many companies enrich the
 * same tender. Parsing stays at the call site (it is cheap and may be
 * company-specific). Returns null when ARCE did not return the page and nothing
 * is cached.
 */
export async function getOrFetchDetailHtml(
  tenderId: string,
  detailUrl: string,
  now: Date = new Date()
): Promise<string | null> {
  const existing = await prisma.globalTender.findUnique({
    where: { tenderId },
    select: { detailHtml: true, htmlFetchedAt: true },
  })
  if (existing?.detailHtml && isFresh(existing.htmlFetchedAt, now, DETAIL_FRESH_TTL_MS)) {
    return existing.detailHtml
  }

  const html = await fetchArceHtml(detailUrl)
  if (html === null) {
    // Fall back to a stale cached copy if we have one.
    return existing?.detailHtml ?? null
  }

  await prisma.globalTender.upsert({
    where: { tenderId },
    create: { tenderId, detailHtml: html, htmlFetchedAt: now },
    update: { detailHtml: html, htmlFetchedAt: now },
  })
  return html
}

// ---------------------------------------------------------------------------
// AI analysis cache (company-independent work only)
// ---------------------------------------------------------------------------

/**
 * Read-through cache for company-independent AI work (e.g. normalizing a tender
 * object). The same input text is only sent to the model once, keyed by a hash
 * of `kind` + the input.
 */
export async function cachedAiAnalysis<T>(
  kind: string,
  input: string,
  compute: () => Promise<T>
): Promise<T> {
  const key = contentHash(kind, input)
  const hit = await prisma.aiAnalysisCache.findUnique({ where: { contentHash: key } })
  if (hit) return hit.resultJson as T
  const result = await compute()
  await prisma.aiAnalysisCache.upsert({
    where: { contentHash: key },
    create: { contentHash: key, kind, resultJson: result as unknown as Prisma.InputJsonValue },
    update: { resultJson: result as unknown as Prisma.InputJsonValue },
  })
  return result
}
