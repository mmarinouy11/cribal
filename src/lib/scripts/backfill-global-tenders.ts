import 'dotenv/config'
import { prisma } from '../db/prisma'
import { FAILURE_FEED_URLS } from '../pipeline/failed-tenders'
import {
  completeNullTitleTenders,
  delay,
  fetchFeedConditional,
  INTER_REQUEST_DELAY_MS,
  type GlobalTenderRssRow,
} from '../pipeline/global-ingestion'
import { normalize } from '../pipeline/normalizer'

/**
 * One-off backfill: complete GlobalTender rows whose title is NULL. These rows
 * were first created by detail enrichment (objectDescription/tenderItems/detailHtml
 * populated) and never got their RSS-level columns, because the daily ingestion
 * upserts with createMany + skipDuplicates, which skips existing rows.
 *
 * It reads every configured feed (company feeds + failure feeds) through
 * fetchFeedConditional, so a fresh feed_cache entry is reused without any request
 * and all real traffic goes via arceFetch. Requests are sequential with a delay
 * between network hits, so ARCE is never hit in bursts. Only still-NULL RSS
 * columns are filled; detail data already downloaded is never overwritten.
 * Idempotent — safe to re-run.
 */
async function main(): Promise<void> {
  const now = new Date()

  const incompleteBefore = await prisma.globalTender.count({ where: { title: null } })
  if (incompleteBefore === 0) {
    console.log('[CRIBAL][INGEST] Backfill: no hay filas con title NULL — nada que hacer')
    return
  }
  console.log(`[CRIBAL][INGEST] Backfill: ${incompleteBefore} fila(s) con title NULL`)

  // Every feed URL currently in use, deduped: company feeds + failure feeds.
  const companies = await prisma.companyConfig.findMany({ select: { rssFeeds: true } })
  const feedUrls = [...new Set([...companies.flatMap((c) => c.rssFeeds), ...FAILURE_FEED_URLS])].filter(
    Boolean
  )
  console.log(`[CRIBAL][INGEST] Backfill: leyendo ${feedUrls.length} feed(s)`)

  const familiaOf = (url: string): string | null => url.match(/\/familia\/(\d+)/)?.[1] ?? null

  // Build the RSS-level rows from the feeds (first feed wins per tenderId).
  const tenderRows = new Map<string, GlobalTenderRssRow>()
  for (let i = 0; i < feedUrls.length; i++) {
    const url = feedUrls[i]
    const outcome = await fetchFeedConditional(url, now)
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
    const label = outcome.fromCache ? 'cache' : `HTTP ${outcome.status}`
    console.log(`[CRIBAL][INGEST] Backfill: ${url} → ${outcome.items.length} ítems (${label})`)
    // Only pause between real network hits, never after a cache-served feed.
    if (i < feedUrls.length - 1 && !outcome.fromCache) await delay(INTER_REQUEST_DELAY_MS)
  }

  const completed = await completeNullTitleTenders(tenderRows)
  const incompleteAfter = await prisma.globalTender.count({ where: { title: null } })
  console.log(
    `[CRIBAL][INGEST] Backfill completado: ${completed} fila(s) completada(s), ${incompleteAfter} siguen con title NULL (no aparecen en los feeds actuales)`
  )
}

main()
  .catch((error) => {
    console.error('[CRIBAL][INGEST] Backfill falló:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
