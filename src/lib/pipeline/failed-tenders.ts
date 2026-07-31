import Parser from 'rss-parser'
import type { CompanyConfig, FailureType, NicheCategory, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { normalize, type NormalizedTender } from './normalizer'
import { classifyFailures, type FailureToClassify } from './niche-classifier'
import { recomputeNiches } from './niches'
import { fetchArceHtml, delay } from '../scraper/fetch-arce'
import { parseTenderDetail, extractBuyObject, type TenderItem } from '../scraper/arce-parser'

const ARCE_DETAIL_BASE = 'https://www.comprasestatales.gub.uy/consultas/detalle/id'
const USER_AGENT = 'Mozilla/5.0 (compatible; Cribal/1.0)'
const ENRICH_DELAY_MS = 500

// Two global RSS feeds of failed tenders. The resolution type is not in the item
// title — it is determined by the feed of origin (resol/3 = desierta, resol/7 =
// all offers rejected), so we tag each item with its feed's failureType.
const FAILURE_FEEDS: { url: string; type: FailureType }[] = [
  {
    url: 'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ADJ/resol/3/tipo-doc/R/tipo-fecha/PUB/filtro-cat/CAT/tipo-orden/DESC',
    type: 'DESIERTA',
  },
  {
    url: 'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ADJ/resol/7/tipo-doc/R/tipo-fecha/PUB/filtro-cat/CAT/tipo-orden/DESC',
    type: 'OFERTAS_RECHAZADAS',
  },
]

interface TaggedFailure {
  tender: NormalizedTender
  failureType: FailureType
  failureId: string
}

const CATEGORY_MAP: Record<'nucleo' | 'adyacente' | 'fuera', NicheCategory> = {
  nucleo: 'NUCLEO',
  adyacente: 'ADYACENTE',
  fuera: 'FUERA',
}

function detailUrl(tenderId: string): string {
  return `${ARCE_DETAIL_BASE}/${tenderId}`
}

/** The "call" view (`/mostrar-llamado/1`) carries the items + article codes. */
function callViewUrl(tenderId: string): string {
  return `${ARCE_DETAIL_BASE}/${tenderId}/mostrar-llamado/1`
}

export interface FailureEnrichment {
  articleCodes: string[]
  tenderItems: TenderItem[]
  objectDescription: string | null
}

/** Fetch one failure feed and tag every item with its failureType. */
async function fetchFailureFeed(
  parser: Parser,
  url: string,
  type: FailureType
): Promise<TaggedFailure[]> {
  const parsed = await parser.parseURL(url)
  const tagged: TaggedFailure[] = []
  for (const raw of parsed.items ?? []) {
    const tender = normalize({
      title: raw.title ?? '',
      link: raw.link ?? '',
      guid: raw.guid ?? raw.link ?? '',
      pubDate: raw.pubDate ?? '',
      content: raw.content ?? raw['content:encoded'] ?? '',
      contentSnippet: raw.contentSnippet ?? '',
      sourceFeed: url,
    })
    if (!tender.tenderId) continue
    tagged.push({ tender, failureType: type, failureId: `arce-fail|${tender.tenderId}` })
  }
  return tagged
}

/**
 * Enrich a failure from ARCE. A failed tender has two views and the data we need
 * is split across them: the base detail page holds the object description (and the
 * resolution), while the `/mostrar-llamado/1` call view holds the items and their
 * article codes (a desierta awards nothing, so the base page has no items block).
 * Fetches both, keeping a 500ms delay between requests.
 */
export async function enrichFailure(tenderId: string): Promise<FailureEnrichment> {
  const baseHtml = await fetchArceHtml(detailUrl(tenderId))
  const objectDescription = baseHtml ? extractBuyObject(baseHtml) : null

  await delay(ENRICH_DELAY_MS)

  const callHtml = await fetchArceHtml(callViewUrl(tenderId))
  let tenderItems: TenderItem[] = []
  if (callHtml) {
    try {
      tenderItems = parseTenderDetail(callHtml).items
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[CRIBAL][NICHOS] Error parseando llamado ${tenderId}: ${message}`)
    }
  }
  const articleCodes = tenderItems
    .map((item) => item.articleCode)
    .filter((code): code is string => Boolean(code))

  return { articleCodes, tenderItems, objectDescription }
}

/**
 * Ingest failed tenders (declared desierta or with all offers rejected) for a
 * company. Runs inside the pipeline after normal opportunities are saved.
 *
 * Deliberately applies NO keyword or exclusion filter — the goal is to discover
 * markets the company does not serve yet. Every new failure is classified by the
 * AI and persisted (FUERA included, so the dedup skips it next run); only
 * non-FUERA failures are aggregated into niches and surfaced in the UI.
 */
export async function ingestFailedTenders(
  company: CompanyConfig,
  runId: string
): Promise<{ ingested: number; nichesUpdated: number }> {
  const parser = new Parser({ headers: { 'User-Agent': USER_AGENT }, timeout: 30000 })

  // 1. Fetch both feeds in parallel; if one fails, keep the other.
  const settled = await Promise.allSettled(
    FAILURE_FEEDS.map((feed) => fetchFailureFeed(parser, feed.url, feed.type))
  )
  const tagged: TaggedFailure[] = []
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      tagged.push(...result.value)
    } else {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.error(`[CRIBAL][NICHOS] Error en feed ${FAILURE_FEEDS[i].url}: ${message}`)
    }
  }

  // 2. Deduplicate by tenderId within the run (first feed wins).
  const seen = new Set<string>()
  const deduped: TaggedFailure[] = []
  for (const item of tagged) {
    if (seen.has(item.tender.tenderId)) continue
    seen.add(item.tender.tenderId)
    deduped.push(item)
  }

  // 3. Drop failures already stored for this company.
  const existing = await prisma.failedTender.findMany({
    where: { companyId: company.id, failureId: { in: deduped.map((d) => d.failureId) } },
    select: { failureId: true },
  })
  const existingIds = new Set(existing.map((e) => e.failureId))
  const fresh = deduped.filter((d) => !existingIds.has(d.failureId))

  console.log(
    `[CRIBAL][NICHOS] ${tagged.length} fallos en feeds, ${deduped.length} únicos, ${fresh.length} nuevos para ${company.companyName}`
  )

  if (fresh.length === 0) {
    return { ingested: 0, nichesUpdated: 0 }
  }

  // 4 & 5. No keyword/exclusion filter. Enrich each new failure (500ms apart).
  const enrichedById = new Map<string, FailureEnrichment>()
  for (const item of fresh) {
    await delay(ENRICH_DELAY_MS)
    enrichedById.set(item.failureId, await enrichFailure(item.tender.tenderId))
  }

  // 6. Classify every failure with the AI.
  const toClassify: FailureToClassify[] = fresh.map((item) => ({
    failureId: item.failureId,
    title: item.tender.title,
    description: item.tender.description,
    organismo: item.tender.organismo,
    failureType: item.failureType,
    tenderItems: enrichedById.get(item.failureId)?.tenderItems ?? [],
  }))
  const classifications = await classifyFailures(toClassify, company)
  const classificationById = new Map(classifications.map((c) => [c.failureId, c]))

  // 7. Persist all failures that are not FUERA.
  let ingested = 0
  for (const item of fresh) {
    const classification = classificationById.get(item.failureId)
    if (!classification) continue // Batch dropped — skip this failure.

    // Persist every classified failure, FUERA included. FUERA records never reach
    // a niche or the UI, but storing them lets the failureId dedup skip them on
    // later runs instead of re-fetching and re-classifying them forever.
    const category = CATEGORY_MAP[classification.category] ?? 'FUERA'
    const enriched = enrichedById.get(item.failureId) ?? {
      articleCodes: [],
      tenderItems: [],
      objectDescription: null,
    }
    const fitScore = Math.max(0, Math.min(10, Math.round(classification.fitScore)))

    try {
      await prisma.failedTender.create({
        data: {
          companyId: company.id,
          tenderId: item.tender.tenderId,
          failureId: item.failureId,
          failureType: item.failureType,
          url: item.tender.url,
          title: item.tender.title,
          description: item.tender.description || null,
          objectDescription: enriched.objectDescription,
          organismo: item.tender.organismo || null,
          publicationDate: item.tender.publicationDate,
          articleCodes: enriched.articleCodes,
          tenderItems: enriched.tenderItems as unknown as Prisma.InputJsonValue,
          nicheCategory: category,
          fitScore,
          fitReason: classification.reason || null,
          missingCapability:
            category === 'ADYACENTE' ? classification.missingCapability || null : null,
        },
      })
      ingested++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][NICHOS] Error guardando fallo ${item.failureId}: ${message}`)
    }
  }

  // 8. Rebuild niches from the full non-FUERA set.
  const nichesUpdated = await recomputeNiches(company.id)

  console.log(
    `[CRIBAL][NICHOS] Run ${runId}: ${ingested} fallos guardados, ${nichesUpdated} nichos actualizados`
  )

  return { ingested, nichesUpdated }
}
