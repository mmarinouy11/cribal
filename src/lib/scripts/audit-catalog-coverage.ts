import 'dotenv/config'
import { prisma } from '../db/prisma'
import { fetchArceHtml, delay } from '../scraper/fetch-arce'
import { isAdjudication, parseTenderDetail, parseAdjudicationDetail } from '../scraper/arce-parser'
import { fetchRssFeeds } from '../pipeline/fetcher'
import { familyFeedUrl } from '../arce/catalog'
import { learnCatalogFromTenders } from '../catalog/learn-from-tenders'

/**
 * Audit how much of the ARCE article catalog (catalog_articles) actually covers
 * the article codes that real tenders use. Read-only: it never writes to the DB
 * and never persists fetched pages.
 *
 * Article codes are stored per opportunity in `Opportunity.tenderItems` (a JSON
 * array of { itemNumber, name, articleCode, quantity, unit }), extracted on the
 * detail page from the "(Cód. Artículo NNNNN)" item headings by
 * `extractTenderItems` in arce-parser. So this runs in Case A. If no opportunity
 * has stored codes, it falls back to Case B: fetch the last 100 detail pages and
 * extract codes in memory.
 *
 * Run with: npm run audit:catalog-coverage
 */

const ARCE_DETAIL_BASE = 'https://www.comprasestatales.gub.uy/consultas/detalle/id'
const CASE_B_SAMPLE = 100
const MISSING_PRINT_CAP = 100
const IN_CHUNK = 1000

// Wide mode: the active ARCE families and how many recent calls to sample each.
const WIDE_FAMILIES = [2, 3, 4, 5, 6, 10, 12]
const WIDE_SAMPLE_PER_FAMILY = 30
const DETAIL_FETCH_ATTEMPTS = 2 // minimal retries on a failed detail fetch

interface OppCodes {
  title: string
  codes: number[]
}

/** Extract positive integer article codes from a tenderItems JSON value. */
function codesFromJson(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const codes: number[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || !('articleCode' in item)) continue
    const raw = (item as { articleCode: unknown }).articleCode
    const code =
      typeof raw === 'string'
        ? Number.parseInt(raw, 10)
        : typeof raw === 'number'
          ? raw
          : Number.NaN
    if (Number.isInteger(code) && code > 0) codes.push(code)
  }
  return codes
}

/** String article codes (from a parsed detail) → positive integers. */
function toCodeNumbers(raw: (string | null)[]): number[] {
  const codes: number[] = []
  for (const value of raw) {
    const code = value ? Number.parseInt(value, 10) : Number.NaN
    if (Number.isInteger(code) && code > 0) codes.push(code)
  }
  return codes
}

// A catalog article code found on a detail page, with the item name if present.
interface DetailCode {
  code: number
  name: string
}

/** Extract article codes (with item names) from a tender/adjudication detail page. */
function codesWithNamesFromHtml(html: string): DetailCode[] {
  const items = isAdjudication(html)
    ? parseAdjudicationDetail(html).adjudicatedItems
    : parseTenderDetail(html).items
  const out: DetailCode[] = []
  for (const item of items) {
    const code = item.articleCode ? Number.parseInt(item.articleCode, 10) : Number.NaN
    if (Number.isInteger(code) && code > 0) out.push({ code, name: item.name })
  }
  return out
}

/** Fetch a detail page by tender id, with minimal retries. Null when unavailable. */
async function fetchDetailHtml(tenderId: string): Promise<string | null> {
  for (let attempt = 1; attempt <= DETAIL_FETCH_ATTEMPTS; attempt++) {
    const html = await fetchArceHtml(`${ARCE_DETAIL_BASE}/${tenderId}`)
    if (html) return html
    if (attempt < DETAIL_FETCH_ATTEMPTS) await delay(1000)
  }
  return null
}

/** The ARCE tender id embedded in an RSS item link (".../id/<id>"). */
function tenderIdFromLink(link: string): string {
  return link.match(/\/id\/(\d+)/)?.[1] ?? ''
}

/** Which of the given codes exist in catalog_articles (chunked `in` queries). */
async function existingCatalogCodes(codes: number[]): Promise<Set<number>> {
  const set = new Set<number>()
  for (let i = 0; i < codes.length; i += IN_CHUNK) {
    const rows = await prisma.catalogArticle.findMany({
      where: { id: { in: codes.slice(i, i + IN_CHUNK) } },
      select: { id: true },
    })
    for (const row of rows) set.add(row.id)
  }
  return set
}

/** Case A: read stored codes from every opportunity that has them. */
async function gatherFromStored(): Promise<OppCodes[]> {
  const opps = await prisma.opportunity.findMany({ select: { title: true, tenderItems: true } })
  const result: OppCodes[] = []
  for (const opp of opps) {
    const codes = codesFromJson(opp.tenderItems)
    if (codes.length > 0) result.push({ title: opp.title, codes })
  }
  return result
}

/** Case B: fetch the last N detail pages and extract codes in memory. */
async function gatherFromDetailPages(): Promise<OppCodes[]> {
  const recent = await prisma.opportunity.findMany({
    orderBy: { detectedAt: 'desc' },
    take: CASE_B_SAMPLE,
    select: { title: true, externalId: true },
  })
  console.log(`[CRIBAL][AUDIT] Caso B: descargando ${recent.length} páginas de detalle (1s entre cada una)…`)

  const result: OppCodes[] = []
  for (const opp of recent) {
    const html = await fetchArceHtml(`${ARCE_DETAIL_BASE}/${opp.externalId}`)
    await delay(1000)
    if (!html) continue
    const rawCodes = isAdjudication(html)
      ? parseAdjudicationDetail(html).adjudicatedItems.map((i) => i.articleCode)
      : parseTenderDetail(html).items.map((i) => i.articleCode)
    const codes = toCodeNumbers(rawCodes)
    if (codes.length > 0) result.push({ title: opp.title, codes })
  }
  return result
}

// Per-family tally for wide mode.
interface FamilyStat {
  familia: number
  read: number // calls whose detail page was read
  withoutCodes: number // of those, how many had no catalog code
  distinctCodes: Set<number>
}

// Where a missing code first appeared.
interface CodeMeta {
  title: string
  familia: number
  itemName: string
}

/**
 * Wide mode (`--wide`): sample the most recent calls of every active family's
 * RSS feed, read each detail page in memory, and measure catalog coverage of the
 * article codes they use. Read-only unless `apply` is set, in which case it also
 * teaches the catalog the new codes it finds (`learnCatalogFromTenders`).
 */
async function runWide(apply: boolean): Promise<void> {
  console.log(
    `[CRIBAL][AUDIT] ===== Cobertura ampliada (--wide${apply ? ' --apply' : ''}) =====`
  )

  const stats: FamilyStat[] = []
  const allCodes = new Set<number>()
  const firstMetaByCode = new Map<number, CodeMeta>()
  let totalRead = 0
  let totalWithoutCodes = 0
  let totalAdded = 0

  for (const familia of WIDE_FAMILIES) {
    const stat: FamilyStat = { familia, read: 0, withoutCodes: 0, distinctCodes: new Set() }
    stats.push(stat)

    const { items } = await fetchRssFeeds([familyFeedUrl(familia)])
    const recent = items.slice(0, WIDE_SAMPLE_PER_FAMILY)
    console.log(
      `[CRIBAL][AUDIT] Familia ${familia}: ${recent.length} licitaciones recientes a leer…`
    )

    for (const item of recent) {
      const tenderId = tenderIdFromLink(item.link)
      if (!tenderId) continue

      const html = await fetchDetailHtml(tenderId)
      await delay(1000)
      if (!html) continue

      stat.read += 1
      totalRead += 1

      const detailCodes = codesWithNamesFromHtml(html)
      if (detailCodes.length === 0) {
        stat.withoutCodes += 1
        totalWithoutCodes += 1
        continue
      }

      // With --apply, teach the catalog this tender's new codes (per family).
      if (apply) {
        const { added } = await learnCatalogFromTenders(detailCodes, familia)
        totalAdded += added
      }

      for (const { code, name } of detailCodes) {
        stat.distinctCodes.add(code)
        allCodes.add(code)
        if (!firstMetaByCode.has(code)) {
          firstMetaByCode.set(code, { title: item.title, familia, itemName: name })
        }
      }
    }
  }

  if (allCodes.size === 0 && totalRead === 0) {
    console.log('[CRIBAL][AUDIT] No se pudo leer ninguna licitación.')
    return
  }

  const existing = await existingCatalogCodes([...allCodes])

  // Per-family coverage.
  console.log('[CRIBAL][AUDIT] ----- Por familia -----')
  for (const stat of stats) {
    const present = [...stat.distinctCodes].filter((c) => existing.has(c)).length
    const pct = stat.distinctCodes.size > 0 ? (present / stat.distinctCodes.size) * 100 : 0
    console.log(
      `[CRIBAL][AUDIT]   Familia ${stat.familia}: leídas ${stat.read}, códigos distintos ${stat.distinctCodes.size}, en catálogo ${present} (${pct.toFixed(1)}%)`
    )
  }

  // Total coverage.
  const coveragePct = allCodes.size > 0 ? (existing.size / allCodes.size) * 100 : 0
  console.log('[CRIBAL][AUDIT] ----- Total -----')
  console.log(
    `[CRIBAL][AUDIT] Códigos distintos: ${allCodes.size} | en catálogo: ${existing.size} (${coveragePct.toFixed(1)}%)`
  )

  // Missing codes with title, family and item name.
  const missing = [...allCodes].filter((c) => !existing.has(c)).sort((a, b) => a - b)
  console.log(`[CRIBAL][AUDIT] Faltantes: ${missing.length}`)
  if (missing.length > 0) {
    console.log('[CRIBAL][AUDIT] ----- Códigos faltantes -----')
    for (const code of missing.slice(0, MISSING_PRINT_CAP)) {
      const meta = firstMetaByCode.get(code)
      const itemName = meta?.itemName ? ` | ítem: "${meta.itemName}"` : ''
      console.log(
        `[CRIBAL][AUDIT]   ${code} — familia ${meta?.familia ?? '?'} — "${meta?.title ?? '(sin título)'}"${itemName}`
      )
    }
    if (missing.length > MISSING_PRINT_CAP) {
      console.log(`[CRIBAL][AUDIT]   … y ${missing.length - MISSING_PRINT_CAP} más`)
    }

    // Distribution of missing codes by 10,000-code band.
    console.log('[CRIBAL][AUDIT] ----- Distribución de faltantes por tramo de 10.000 -----')
    const buckets = new Map<number, number>()
    for (const code of missing) {
      const bucket = Math.floor(code / 10000) * 10000
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
    }
    for (const [bucket, count] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`[CRIBAL][AUDIT]   ${bucket}–${bucket + 9999}: ${count}`)
    }
  }

  // Calls that use no catalog code at all (free text / no items).
  console.log('[CRIBAL][AUDIT] ----- Sin código de catálogo -----')
  console.log(`[CRIBAL][AUDIT] Licitaciones sin código de catálogo: ${totalWithoutCodes} de ${totalRead}`)

  if (apply) {
    console.log(`[CRIBAL][AUDIT] Artículos agregados al catálogo: ${totalAdded}`)
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--wide')) {
    await runWide(process.argv.includes('--apply'))
    return
  }

  // Case A when any opportunity already has stored codes; otherwise Case B.
  let oppCodes = await gatherFromStored()
  const caseUsed: 'A' | 'B' = oppCodes.length > 0 ? 'A' : 'B'
  if (caseUsed === 'B') oppCodes = await gatherFromDetailPages()

  if (oppCodes.length === 0) {
    console.log('[CRIBAL][AUDIT] No se encontraron códigos de artículo en ninguna oportunidad.')
    console.log(`[CRIBAL][AUDIT] Caso: ${caseUsed}`)
    return
  }

  // Distinct codes + the first opportunity title where each appeared.
  const allCodes = new Set<number>()
  const firstTitleByCode = new Map<number, string>()
  for (const oc of oppCodes) {
    for (const code of oc.codes) {
      allCodes.add(code)
      if (!firstTitleByCode.has(code)) firstTitleByCode.set(code, oc.title)
    }
  }

  const existing = await existingCatalogCodes([...allCodes])
  const missing = [...allCodes].filter((c) => !existing.has(c)).sort((a, b) => a - b)
  const coveragePct = allCodes.size > 0 ? (existing.size / allCodes.size) * 100 : 0

  // 1. Distinct codes and catalog coverage.
  console.log('[CRIBAL][AUDIT] ===== Cobertura del catálogo =====')
  console.log(`[CRIBAL][AUDIT] Oportunidades con códigos: ${oppCodes.length}`)
  console.log(`[CRIBAL][AUDIT] Códigos distintos encontrados: ${allCodes.size}`)
  console.log(
    `[CRIBAL][AUDIT] Presentes en el catálogo: ${existing.size} (${coveragePct.toFixed(1)}%)`
  )
  console.log(`[CRIBAL][AUDIT] Faltantes: ${missing.length}`)

  // 2. Missing codes with the opportunity title (family unknown — not in catalog).
  if (missing.length > 0) {
    console.log('[CRIBAL][AUDIT] ----- Códigos faltantes -----')
    for (const code of missing.slice(0, MISSING_PRINT_CAP)) {
      const title = firstTitleByCode.get(code) ?? '(sin título)'
      console.log(`[CRIBAL][AUDIT]   ${code} — "${title}" (familia desconocida: no está en el catálogo)`)
    }
    if (missing.length > MISSING_PRINT_CAP) {
      console.log(`[CRIBAL][AUDIT]   … y ${missing.length - MISSING_PRINT_CAP} más`)
    }

    // 3. Distribution of missing codes by 10,000-code band.
    console.log('[CRIBAL][AUDIT] ----- Distribución de faltantes por tramo de 10.000 -----')
    const buckets = new Map<number, number>()
    for (const code of missing) {
      const bucket = Math.floor(code / 10000) * 10000
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
    }
    for (const [bucket, count] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`[CRIBAL][AUDIT]   ${bucket}–${bucket + 9999}: ${count}`)
    }
  }

  // 4. Opportunities whose codes are all in the catalog.
  const fullyCovered = oppCodes.filter((oc) => oc.codes.every((c) => existing.has(c))).length
  const oppPct = (fullyCovered / oppCodes.length) * 100
  console.log('[CRIBAL][AUDIT] ----- Resumen -----')
  console.log(
    `[CRIBAL][AUDIT] Oportunidades con todos sus códigos en el catálogo: ${fullyCovered}/${oppCodes.length} (${oppPct.toFixed(1)}%)`
  )
  console.log(`[CRIBAL][AUDIT] Caso: ${caseUsed} (${caseUsed === 'A' ? 'códigos ya guardados' : 'descargados en memoria'})`)
}

main()
  .catch((error) => {
    console.error('[CRIBAL][AUDIT] Falló:', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
