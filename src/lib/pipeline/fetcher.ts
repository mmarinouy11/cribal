import Parser from 'rss-parser'
import { arceFetch } from '../scraper/arce-http'

export interface RssItem {
  title: string
  link: string
  guid: string
  pubDate: string
  content: string
  contentSnippet: string
  sourceFeed: string
}

// Per-feed outcome for a fetch pass. A feed that times out or errors on the
// network is `ok: false`; a feed that responds with 0 items is `ok: true`.
export interface FeedStatus {
  url: string
  ok: boolean
  attempts: number
  error?: string
  itemCount: number
}

export interface FetchResult {
  items: RssItem[]
  errors: { feed: string; error: string }[]
  feedStatuses: FeedStatus[]
}

const USER_AGENT = 'Mozilla/5.0 (compatible; Cribal/1.0)'
const ATTEMPT_TIMEOUT_MS = 30_000 // connection/response timeout per attempt
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000] // waits BEFORE attempts 2 and 3

// A single shared parser instance is enough — it holds no per-feed state.
const parser = new Parser({ timeout: ATTEMPT_TIMEOUT_MS })

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// An HTTP error carrying whether it is worth retrying (5xx/429 yes, 4xx no).
class FeedFetchError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'FeedFetchError'
    this.retryable = retryable
  }
}

/** Fetch a feed's XML once with a hard timeout. Throws on network/HTTP error. */
async function fetchFeedXml(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)
  try {
    const response = await arceFetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      // Retry only transient HTTP failures (5xx and 429), never 4xx.
      const retryable = response.status >= 500 || response.status === 429
      throw new FeedFetchError(`HTTP ${response.status}`, retryable)
    }
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch one feed with up to 3 attempts and growing backoff (5s, 20s, 60s).
 * Network errors, timeouts and HTTP 5xx/429 are retried; 4xx are not.
 */
async function fetchFeedWithRetries(
  url: string
): Promise<{ xml: string | null; attempts: number; error?: string }> {
  let lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await delay(RETRY_DELAYS_MS[attempt - 2])
    try {
      const xml = await fetchFeedXml(url)
      return { xml, attempts: attempt }
    } catch (error) {
      // Network errors and timeouts (AbortError) are retryable; FeedFetchError
      // carries its own verdict.
      const retryable = error instanceof FeedFetchError ? error.retryable : true
      lastError =
        error instanceof Error && error.name === 'AbortError'
          ? `Timeout tras ${ATTEMPT_TIMEOUT_MS / 1000}s`
          : error instanceof Error
            ? error.message
            : String(error)
      if (!retryable || attempt === MAX_ATTEMPTS) {
        return { xml: null, attempts: attempt, error: lastError }
      }
      console.warn(
        `[CRIBAL][FETCH] Reintentando ${url} — intento ${attempt} falló: ${lastError}`
      )
    }
  }
  return { xml: null, attempts: MAX_ATTEMPTS, error: lastError }
}

/**
 * Fetch multiple RSS feeds in parallel, each with retries and a per-attempt
 * timeout. If one feed fails, the others still return. Items are deduplicated by
 * guid (falling back to link) across feeds. `feedStatuses` reports the outcome
 * of every feed so the pipeline can tell "ARCE did not respond" from "no news".
 */
export async function fetchRssFeeds(feeds: string[]): Promise<FetchResult> {
  const fetched = await Promise.all(
    feeds.map(async (feed) => {
      const { xml, attempts, error } = await fetchFeedWithRetries(feed)
      if (xml === null) return { feed, ok: false as const, attempts, error, items: [] }
      try {
        const parsed = await parser.parseString(xml)
        return { feed, ok: true as const, attempts, items: parsed.items ?? [] }
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError)
        return { feed, ok: false as const, attempts, error: `Parseo: ${message}`, items: [] }
      }
    })
  )

  const items: RssItem[] = []
  const errors: { feed: string; error: string }[] = []
  const feedStatuses: FeedStatus[] = []
  const seen = new Set<string>()

  for (const result of fetched) {
    if (!result.ok) {
      feedStatuses.push({
        url: result.feed,
        ok: false,
        attempts: result.attempts,
        error: result.error,
        itemCount: 0,
      })
      errors.push({ feed: result.feed, error: result.error ?? 'desconocido' })
      console.error(
        `[CRIBAL][FETCH] Feed falló tras ${result.attempts} intento(s): ${result.feed} — ${result.error}`
      )
      continue
    }

    feedStatuses.push({
      url: result.feed,
      ok: true,
      attempts: result.attempts,
      itemCount: result.items.length,
    })

    for (const raw of result.items) {
      const link = raw.link ?? ''
      const guid = raw.guid ?? link
      const dedupKey = guid || link
      if (!dedupKey || seen.has(dedupKey)) continue
      seen.add(dedupKey)

      items.push({
        title: raw.title ?? '',
        link,
        guid,
        pubDate: raw.pubDate ?? '',
        content: raw.content ?? raw['content:encoded'] ?? '',
        contentSnippet: raw.contentSnippet ?? '',
        sourceFeed: result.feed,
      })
    }
  }

  const okCount = feedStatuses.filter((f) => f.ok).length
  console.log(
    `[CRIBAL][FETCH] ${okCount}/${feeds.length} feeds OK, ${items.length} items encontrados`
  )

  return { items, errors, feedStatuses }
}
