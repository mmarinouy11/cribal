import Parser from 'rss-parser'

export interface RssItem {
  title: string
  link: string
  guid: string
  pubDate: string
  content: string
  contentSnippet: string
  sourceFeed: string
}

export interface FetchResult {
  items: RssItem[]
  errors: { feed: string; error: string }[]
}

// A single shared parser instance is enough — it holds no per-feed state.
const parser = new Parser({ timeout: 30000 })

/**
 * Fetch multiple RSS feeds in parallel. If one feed fails, the others still
 * return. Items are deduplicated by guid (falling back to link) across feeds.
 */
export async function fetchRssFeeds(feeds: string[]): Promise<FetchResult> {
  const settled = await Promise.allSettled(
    feeds.map((feed) => parser.parseURL(feed).then((parsed) => ({ feed, parsed })))
  )

  const items: RssItem[] = []
  const errors: { feed: string; error: string }[] = []
  const seen = new Set<string>()

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    const feed = feeds[i]

    if (result.status === 'rejected') {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      errors.push({ feed, error: message })
      console.error(`[CRIBAL][FETCH] Error en feed ${feed}: ${message}`)
      continue
    }

    for (const raw of result.value.parsed.items ?? []) {
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
        sourceFeed: feed,
      })
    }
  }

  const feedsProcessed = settled.filter((r) => r.status === 'fulfilled').length
  console.log(
    `[CRIBAL][FETCH] ${feedsProcessed} feeds procesados, ${items.length} items encontrados`
  )

  return { items, errors }
}
