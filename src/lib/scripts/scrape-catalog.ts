import 'dotenv/config'
import fs from 'node:fs'
import he from 'he'
import type { Page } from 'playwright'
import { prisma } from '../db/prisma'
import { normalizeText } from '../text/normalize'
import { isArceProxyEnabled, maskedProxyUrl } from '../scraper/arce-http'

// Chromium is installed at build time under this persistent path (see the
// postinstall script). Point Playwright at it before the runtime import below.
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || '/app/.playwright-browsers'

/**
 * Scrape the complete ARCE article catalog with Playwright, iterating through
 * every family and subfamily, and upsert the results into CatalogArticle.
 *
 * ARCE quirks (confirmed by testing):
 * - Option values are Java-serialized Base64 blobs — they must be read from the
 *   DOM, never constructed.
 * - Selecting a family/subfamily triggers an ICEfaces AJAX partial submit; the
 *   updated options and the search results arrive in a `send-receive-updates`
 *   response, not in the main-page DOM.
 * - Search is submitted through the page's own `iceSubmit(...)` helper.
 *
 * Idempotent (upsert). Takes ~20-30 min for the whole catalog. Run with:
 *   npm run scrape:catalog
 * Chromium must be available to Playwright (PLAYWRIGHT_BROWSERS_PATH), and an
 * explicit binary can be forced with PLAYWRIGHT_EXECUTABLE_PATH.
 */

const CATALOG_URL =
  'https://www.comprasestatales.gub.uy/sicepublic/SearchCatalogPublic.iface?pSeleccion=S&returnUrl=aHR0cHM6Ly93d3cuY29tcHJhc2VzdGF0YWxlcy5ndWIudXkvY29uc3VsdGFzL2luZGV4L3Jlc2V0LzE='

const FAMILIA_SELECT = 'select[name="selectCatalogForm:familia"]'
const SUBFAMILIA_SELECT = 'select[name="selectCatalogForm:subfamilia"]'
const CLASE_SELECT = 'select[name="selectCatalogForm:clase"]'
const SUBCLASE_SELECT = 'select[name="selectCatalogForm:subClase"]'
const UPDATES_URL = 'send-receive-updates'

const RESULT_CAP = 1000 // ARCE caps each search at 1000 results
const TRUNCATION_MARKER = 'supera el tope máximo de registros permitidos'

// Longer poll (10 × 2s = 20s) when a dependent select MUST repopulate before we
// can select the required level — ICEfaces can be slow under load.
const SELECT_ATTEMPTS = 10
const GOTO_TIMEOUT = 60000 // page.goto can be slow; give it a minute
// Pauses before each retry of a failed search (fresh page each time).
const RETRY_DELAYS = [5000, 15000, 15000]
// Pauses before each retry when opening the catalog page (fresh page each time).
const CATALOG_OPEN_RETRIES = [5000, 15000, 30000]

// Be gentle with ARCE: at least 3s between searches (configurable, never below
// 3s), concurrency 1, and stop cleanly after 5 consecutive network failures.
const SCRAPE_DELAY_MS = Math.max(3000, Number(process.env.CATALOG_SCRAPE_DELAY_MS) || 3000)
const MAX_CONSECUTIVE_FAILURES = 5

// Legacy JSON progress (imported once into the DB if the table is empty).
const LEGACY_PROGRESS_FILE =
  process.env.CATALOG_PROGRESS_FILE || '/app/data/catalog/scrape-progress.json'

type SpecStatus = 'pending' | 'completed' | 'failed' | 'truncated'

interface CliOptions {
  report: boolean
  onlyOpen: boolean
  family: number | null
}

function parseCliOptions(argv: string[]): CliOptions {
  const familyArg = argv.indexOf('--family')
  const family =
    familyArg >= 0 && argv[familyArg + 1] ? Number(argv[familyArg + 1]) : null
  return {
    report: argv.includes('--report'),
    onlyOpen: argv.includes('--only-open'),
    family: family !== null && Number.isFinite(family) ? family : null,
  }
}

/** True when a search response hit ARCE's 1000-result cap. */
function isTruncated(body: string, collected: number): boolean {
  return collected >= RESULT_CAP || body.includes(TRUNCATION_MARKER)
}

interface Article {
  code: number
  name: string
  familyText: string
  subfamilyText: string
}

interface SelectOption {
  value: string
  text: string
}

/** Read a <select>'s options (skipping the first "Todas…" placeholder). */
function readOptions(page: Page, selector: string): Promise<SelectOption[]> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLSelectElement | null
    if (!el) return []
    return Array.from(el.options)
      .slice(1) // skip "Todas las Familias" / "Todas las SubFamilias"
      .map((o) => ({ value: o.value, text: o.text.trim() }))
      .filter((o) => o.text.length > 0)
  }, selector)
}

const PAGE_SIZE = 50 // articles per catalog page
const MAX_PAGES = 20 // ARCE caps a search at 1000 articles = 20 pages
const NEXT_BUTTON_ID = 'selectCatalogForm:dataTableScrollerpaginator1_dataTablenext'

/**
 * Extract articles from a send-receive-updates body. Different families return
 * the cells inside an ICEfaces CDATA block or as plain spans, so try CDATA first
 * and fall back to the plain-span pattern.
 */
function extractArticles(
  updateBody: string,
  familyText: string,
  subfamilyText: string
): Article[] {
  const cdataCodeMatches = [
    ...updateBody.matchAll(
      /address="selectCatalogForm:dataTable:\d+:j_id295"[^>]*>.*?<content><!\[CDATA\[(\d+)\]\]>/gs
    ),
  ]
  const oldCodeMatches = [...updateBody.matchAll(/dataTable:\d+:j_id295">(\d+)<\/span>/g)]
  const codes = cdataCodeMatches.length > 0 ? cdataCodeMatches : oldCodeMatches

  const cdataNameMatches = [
    ...updateBody.matchAll(
      /address="selectCatalogForm:dataTable:\d+:j_id300"[^>]*>.*?<content><!\[CDATA\[([^\]]+)\]\]>/gs
    ),
  ]
  const oldNameMatches = [...updateBody.matchAll(/dataTable:\d+:j_id300">([^<]+)<\/span>/g)]
  const names = cdataNameMatches.length > 0 ? cdataNameMatches : oldNameMatches

  return codes
    .map((c, i) => ({
      code: Number.parseInt(c[1], 10),
      name: he.decode(names[i]?.[1]?.trim() ?? '').trim(),
      familyText,
      subfamilyText,
    }))
    .filter((a) => Number.isFinite(a.code) && a.code > 0 && a.name.length > 0)
}

/**
 * Click the search button via iceSubmit and return the AJAX body, or null when
 * ARCE sent no send-receive-updates response (a failure, not an empty result).
 */
async function triggerSearch(page: Page): Promise<string | null> {
  const responsePromise = page.waitForResponse((r) => r.url().includes(UPDATES_URL), {
    timeout: 15000,
  })
  await page.evaluate(() => {
    const w = window as unknown as {
      iceSubmit: (form: Element | null, button: Element | null, event: MouseEvent) => void
    }
    w.iceSubmit(
      document.querySelector('form'),
      document.querySelector('input[name="selectCatalogForm:findButton"]'),
      new MouseEvent('click')
    )
  })
  try {
    const response = await responsePromise
    return await response.text()
  } catch {
    console.log('[CATALOG] Sin respuesta send-receive-updates para la búsqueda')
    return null
  }
}

/**
 * Run the search and page through all results, accumulating every article.
 * `gotResponse` is false only when the search itself got no AJAX response — that
 * is a failure the caller must retry, distinct from a genuine empty result.
 */
async function searchAndExtract(
  page: Page,
  familyText: string,
  subfamilyText: string
): Promise<{ articles: Article[]; truncated: boolean; gotResponse: boolean }> {
  const firstBody = await triggerSearch(page)
  if (firstBody === null) return { articles: [], truncated: false, gotResponse: false }
  let updateBody = firstBody
  await page.waitForTimeout(1000)

  const allArticles: Article[] = []
  let sawCapMessage = false

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    if (updateBody.includes(TRUNCATION_MARKER)) sawCapMessage = true
    const articles = extractArticles(updateBody, familyText, subfamilyText)
    allArticles.push(...articles)
    console.log(`[CATALOG]   Página ${pageNum}: ${articles.length} artículos`)

    if (articles.length === 0 && pageNum === 1 && updateBody.length > 0) {
      console.log(
        `[CATALOG] 0 artículos extraídos — muestra del body:\n${updateBody.slice(0, 500)}`
      )
    }

    // A short page means we've reached the end.
    if (articles.length < PAGE_SIZE) break

    // The "next" control is an <a> when enabled, a <span> when disabled.
    const nextEnabled = await page.evaluate((id: string) => {
      const el = document.getElementById(id)
      return el?.tagName === 'A'
    }, NEXT_BUTTON_ID)
    if (!nextEnabled) break

    const responsePromise = page.waitForResponse((r) => r.url().includes(UPDATES_URL), {
      timeout: 15000,
    })
    // Click the link directly so ICEfaces' own onclick handler runs (iceSubmit
    // with the link as the source does NOT trigger the paginator).
    await page.evaluate((id: string) => {
      const el = document.getElementById(id) as HTMLAnchorElement | null
      el?.click()
    }, NEXT_BUTTON_ID)

    try {
      const response = await responsePromise
      updateBody = await response.text()
      await page.waitForTimeout(500)
    } catch {
      break
    }
  }

  const truncated = sawCapMessage || isTruncated(updateBody, allArticles.length)
  return { articles: allArticles, truncated, gotResponse: true }
}

// A catalog search at some depth. Deeper levels are null until we refine into
// them: familia → subfamilia → clase → subClase.
interface Spec {
  familyText: string
  subfamilyText: string | null
  claseText: string | null
  subClaseText: string | null
}

function specKey(s: Spec): string {
  return `${s.familyText}||${s.subfamilyText ?? ''}||${s.claseText ?? ''}||${s.subClaseText ?? ''}`
}

function specLabel(s: Spec): string {
  return [s.familyText, s.subfamilyText, s.claseText, s.subClaseText].filter(Boolean).join(' / ')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// DB-backed progress (CatalogScrapeSpec) — survives redeploys and restarts.
// ---------------------------------------------------------------------------

function levelOf(spec: Spec): string {
  if (spec.subClaseText) return 'subClase'
  if (spec.claseText) return 'clase'
  if (spec.subfamilyText) return 'subfamilia'
  return 'familia'
}

function familyNumberOf(spec: Spec): number | null {
  const match = spec.familyText.match(/^(\d+)/)
  return match ? Number(match[1]) : null
}

function rowToSpec(row: {
  familyText: string
  subfamilyText: string | null
  claseText: string | null
  subClaseText: string | null
}): Spec {
  return {
    familyText: row.familyText,
    subfamilyText: row.subfamilyText,
    claseText: row.claseText,
    subClaseText: row.subClaseText,
  }
}

/** Insert specs as `pending`, skipping any key already in the table. */
async function enqueueSpecs(specs: Spec[]): Promise<void> {
  if (specs.length === 0) return
  await prisma.catalogScrapeSpec.createMany({
    data: specs.map((spec) => ({
      key: specKey(spec),
      label: specLabel(spec),
      level: levelOf(spec),
      status: 'pending',
      familyNumber: familyNumberOf(spec),
      familyText: spec.familyText,
      subfamilyText: spec.subfamilyText,
      claseText: spec.claseText,
      subClaseText: spec.subClaseText,
    })),
    skipDuplicates: true,
  })
}

/** Record the outcome of a processed spec. */
async function setSpecStatus(
  spec: Spec,
  status: SpecStatus,
  articleCount: number,
  reason: string | null
): Promise<void> {
  const key = specKey(spec)
  const base = {
    label: specLabel(spec),
    level: levelOf(spec),
    familyNumber: familyNumberOf(spec),
    familyText: spec.familyText,
    subfamilyText: spec.subfamilyText,
    claseText: spec.claseText,
    subClaseText: spec.subClaseText,
  }
  await prisma.catalogScrapeSpec.upsert({
    where: { key },
    create: { key, status, articleCount, reason, ...base },
    update: { status, articleCount, reason, ...base },
  })
}

/**
 * Import the legacy JSON progress into the DB once, only when the table is
 * empty. Completed/refined keys become `completed` rows, pending specs become
 * `pending`, failed specs become `failed`. Best-effort — a parse error is
 * ignored (a fresh enumeration then runs instead).
 */
async function importLegacyProgressIfEmpty(): Promise<void> {
  const count = await prisma.catalogScrapeSpec.count()
  if (count > 0) return

  let parsed: {
    completed?: string[]
    pending?: Spec[]
    failed?: { spec: Spec }[]
  }
  try {
    parsed = JSON.parse(fs.readFileSync(LEGACY_PROGRESS_FILE, 'utf8'))
  } catch {
    return // no legacy file — nothing to import
  }

  // Completed keys are 4-part spec keys; rebuild a Spec from each.
  const specFromKey = (key: string): Spec => {
    const [familyText, subfamilyText, claseText, subClaseText] = key.split('||')
    return {
      familyText,
      subfamilyText: subfamilyText || null,
      claseText: claseText || null,
      subClaseText: subClaseText || null,
    }
  }

  for (const key of parsed.completed ?? []) {
    if (key.split('||').length !== 4) continue
    await setSpecStatus(specFromKey(key), 'completed', 0, null)
  }
  await enqueueSpecs(parsed.pending ?? [])
  for (const entry of parsed.failed ?? []) {
    if (entry?.spec) await setSpecStatus(entry.spec, 'failed', 0, 'importado del progreso anterior')
  }

  const imported = await prisma.catalogScrapeSpec.count()
  if (imported > 0) {
    console.log(`[CATALOG] Progreso anterior importado del JSON: ${imported} specs`)
  }
}

/** Upsert a batch of articles (deduped by code). Returns how many were written. */
async function saveArticles(articles: Article[]): Promise<number> {
  const byCode = new Map<number, Article>()
  for (const article of articles) byCode.set(article.code, article)

  let saved = 0
  for (const article of byCode.values()) {
    const nameNorm = normalizeText(article.name)
    await prisma.catalogArticle.upsert({
      where: { id: article.code },
      create: {
        id: article.code,
        name: article.name,
        nameNorm,
        familyText: article.familyText || null,
        subfamilyText: article.subfamilyText || null,
        source: 'scraper',
      },
      // The scraper is authoritative: overwrite the real data and reclassify a
      // row that had been learned from a tender (source 'tender') to 'scraper'.
      update: {
        name: article.name,
        nameNorm,
        familyText: article.familyText || null,
        subfamilyText: article.subfamilyText || null,
        source: 'scraper',
      },
    })
    saved += 1
  }
  return saved
}

/**
 * Poll a dependent <select> (subfamily / clase / subClase) until it repopulates
 * — ICEfaces injects the options via innerHTML after the AJAX response, which a
 * waitForFunction on option count misses.
 */
async function readLevelOptions(
  page: Page,
  selector: string,
  label: string,
  maxAttempts = 5
): Promise<SelectOption[]> {
  let options: SelectOption[] = []
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await page.waitForTimeout(2000)
    const totalOptions = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLSelectElement | null
      return el ? el.options.length : 0
    }, selector)
    console.log(`[CATALOG] Select ${label} — opciones totales incluyendo placeholder: ${totalOptions}`)
    options = await readOptions(page, selector)
    if (options.length > 0) break
    console.log(`[CATALOG] Reintento ${attempt + 1} para ${label}...`)
  }
  return options
}

function readSubfamilies(page: Page): Promise<SelectOption[]> {
  return readLevelOptions(page, SUBFAMILIA_SELECT, 'subfamilia')
}

/**
 * Select an option by its (session-stable) visible text — the option `value`s
 * are session-specific Base64 blobs, so matching by text is what lets us reuse a
 * plan on a fresh page. Returns false if no option matches.
 */
async function selectOptionByText(page: Page, selector: string, text: string): Promise<boolean> {
  const match = (await readOptions(page, selector)).find((o) => o.text === text)
  if (!match) return false
  const responsePromise = page.waitForResponse((r) => r.url().includes(UPDATES_URL), {
    timeout: 15000,
  })
  await page.selectOption(selector, match.value)
  try {
    await responsePromise
  } catch {
    // No AJAX — proceed.
  }
  return true
}

/** Thrown when the catalog page cannot be opened after all retries. */
class CatalogUnavailableError extends Error {
  constructor() {
    super('ARCE no respondió al abrir el catálogo')
    this.name = 'CatalogUnavailableError'
  }
}

/**
 * Load the catalog on an existing page: a 60s navigation that resolves on
 * `domcontentloaded`, followed by an explicit wait for the family <select> — so
 * readiness is confirmed by the DOM, not by an arbitrary fixed delay. Throws on
 * navigation timeout or if the select never appears.
 */
async function loadCatalog(page: Page): Promise<void> {
  await page.goto(CATALOG_URL, { timeout: GOTO_TIMEOUT, waitUntil: 'domcontentloaded' })
  await page.waitForSelector(FAMILIA_SELECT, { timeout: GOTO_TIMEOUT })
}

/**
 * Open the catalog on a FRESH page, retrying up to 3 times (5s/15s/30s) — the
 * first access to ARCE can time out. Returns the loaded page (the caller closes
 * it) or throws CatalogUnavailableError once the retries are exhausted.
 */
async function openCatalogPage(browser: import('playwright').Browser): Promise<Page> {
  for (let attempt = 1; attempt <= CATALOG_OPEN_RETRIES.length + 1; attempt++) {
    const page = await browser.newPage()
    page.setDefaultTimeout(30000)
    try {
      await loadCatalog(page)
      return page
    } catch (error) {
      await page.close()
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[CATALOG] No se pudo abrir el catálogo (intento ${attempt}): ${message}`)
      if (attempt <= CATALOG_OPEN_RETRIES.length) {
        const waitMs = CATALOG_OPEN_RETRIES[attempt - 1]
        console.log(`[CATALOG] Reintentando abrir el catálogo en ${waitMs / 1000}s…`)
        await sleep(waitMs)
      }
    }
  }
  throw new CatalogUnavailableError()
}

/** Enumerate the initial family/subfamily specs on an already-loaded page. */
async function enumerateSpecs(page: Page): Promise<Spec[]> {
  await page.waitForTimeout(1000) // let ICEfaces finish wiring the selects

  const familyOptions = await readOptions(page, FAMILIA_SELECT)
  console.log(`[CATALOG] ${familyOptions.length} familias`)

  const specs: Spec[] = []
  for (const family of familyOptions) {
    const responsePromise = page.waitForResponse((r) => r.url().includes(UPDATES_URL), {
      timeout: 15000,
    })
    await page.selectOption(FAMILIA_SELECT, family.value)
    try {
      await responsePromise
    } catch {
      // No AJAX — proceed.
    }
    const subs = await readSubfamilies(page)
    console.log(`[CATALOG] Familia ${family.text}: ${subs.length} subfamilias`)

    if (subs.length === 0) {
      specs.push({ familyText: family.text, subfamilyText: null, claseText: null, subClaseText: null })
    } else {
      for (const sub of subs) {
        specs.push({ familyText: family.text, subfamilyText: sub.text, claseText: null, subClaseText: null })
      }
    }
  }
  return specs
}

interface SpecResult {
  status: 'ok' | 'failed'
  reason?: string // set only when status === 'failed'
  articles: Article[]
  truncated: boolean
  // The next-finer level to refine into when truncated, and its option texts.
  childField: 'claseText' | 'subClaseText' | null
  childOptions: string[]
}

/**
 * Run one catalog search on a fresh page: select the family and whatever deeper
 * levels the spec fixes, read the next-finer level's options (for refinement if
 * truncated), then search and paginate. Fresh page per spec because ICEfaces'
 * session expires under extended use.
 *
 * Returns status 'failed' (never counted as completed) when the page did not
 * load, a required level/option was missing on the fresh page, or the search
 * itself got no response — all distinct from a genuine empty result.
 */
async function runSpec(
  browser: import('playwright').Browser,
  spec: Spec
): Promise<SpecResult> {
  const fail = (reason: string): SpecResult => ({
    status: 'failed',
    reason,
    articles: [],
    truncated: false,
    childField: null,
    childOptions: [],
  })
  const page = await browser.newPage()
  page.setDefaultTimeout(30000)
  try {
    try {
      // Same hardened load as the enumeration: 60s, domcontentloaded + an
      // explicit wait for the family select. The main loop retries on failure.
      await loadCatalog(page)
    } catch {
      return fail('timeout cargando la página')
    }
    await page.waitForTimeout(2000) // let ICEfaces finish initializing

    if (!(await selectOptionByText(page, FAMILIA_SELECT, spec.familyText))) {
      return fail('familia no encontrada en página fresca')
    }
    if (spec.subfamilyText) {
      const subs = await readLevelOptions(page, SUBFAMILIA_SELECT, 'subfamilia', SELECT_ATTEMPTS)
      if (subs.length === 0) return fail('subfamilia se quedó sin opciones tras reintentos')
      if (!(await selectOptionByText(page, SUBFAMILIA_SELECT, spec.subfamilyText))) {
        return fail('subfamilia no encontrada')
      }
      await page.waitForTimeout(1000)
    }
    if (spec.claseText) {
      const clases = await readLevelOptions(page, CLASE_SELECT, 'clase', SELECT_ATTEMPTS)
      if (clases.length === 0) return fail('clase se quedó sin opciones tras reintentos')
      if (!(await selectOptionByText(page, CLASE_SELECT, spec.claseText))) {
        return fail('clase no encontrada')
      }
      await page.waitForTimeout(1000)
    }
    if (spec.subClaseText) {
      const subclases = await readLevelOptions(page, SUBCLASE_SELECT, 'subclase', SELECT_ATTEMPTS)
      if (subclases.length === 0) return fail('subclase se quedó sin opciones tras reintentos')
      if (!(await selectOptionByText(page, SUBCLASE_SELECT, spec.subClaseText))) {
        return fail('subclase no encontrada')
      }
      await page.waitForTimeout(1000)
    }

    // Decide which finer level exists for refinement, and read its options now
    // (before the search, since the result submit can disturb the filters). An
    // empty result here is fine — it just means there is no deeper level.
    let childField: SpecResult['childField'] = null
    let childSelector = ''
    let childLabel = ''
    if (spec.subfamilyText && !spec.claseText) {
      childField = 'claseText'
      childSelector = CLASE_SELECT
      childLabel = 'clase'
    } else if (spec.claseText && !spec.subClaseText) {
      childField = 'subClaseText'
      childSelector = SUBCLASE_SELECT
      childLabel = 'subclase'
    }
    const childOptions = childField
      ? (await readLevelOptions(page, childSelector, childLabel)).map((o) => o.text)
      : []

    const { articles, truncated, gotResponse } = await searchAndExtract(
      page,
      spec.familyText,
      spec.subfamilyText ?? ''
    )
    if (!gotResponse) return fail('sin respuesta a la búsqueda')

    return { status: 'ok', articles, truncated, childField, childOptions }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`error: ${message}`)
  } finally {
    await page.close()
  }
}

/**
 * One-off repair: decode HTML entities left in article names by earlier runs
 * (e.g. "DISE&Ntilde;O" → "DISEÑO"). Runs at startup before scraping.
 */
async function fixExistingNames(): Promise<void> {
  const rows = await prisma.catalogArticle.findMany({
    where: { name: { contains: '&' } },
    select: { id: true, name: true },
  })
  let fixed = 0
  for (const row of rows) {
    if (!/&[a-zA-Z0-9#]+;/.test(row.name)) continue
    const decoded = he.decode(row.name).trim()
    if (decoded && decoded !== row.name) {
      await prisma.catalogArticle.update({ where: { id: row.id }, data: { name: decoded } })
      fixed += 1
    }
  }
  if (fixed > 0) console.log(`[CATALOG] Nombres con entidades HTML corregidos: ${fixed}`)
}

/** Print the DB progress (by status, plus the truncated list). No Playwright. */
async function printReport(family: number | null): Promise<void> {
  const where = family !== null ? { familyNumber: family } : {}
  console.log(
    `[CATALOG] ===== Reporte de progreso${family !== null ? ` (familia ${family})` : ''} =====`
  )
  const grouped = await prisma.catalogScrapeSpec.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  })
  if (grouped.length === 0) {
    console.log('[CATALOG] Sin specs registradas todavía.')
    return
  }
  for (const group of [...grouped].sort((a, b) => a.status.localeCompare(b.status))) {
    console.log(`[CATALOG]   ${group.status}: ${group._count._all}`)
  }

  const truncated = await prisma.catalogScrapeSpec.findMany({
    where: { ...where, status: 'truncated' },
    orderBy: { articleCount: 'desc' },
    select: { label: true, articleCount: true },
  })
  if (truncated.length > 0) {
    console.log(`[CATALOG] ----- Truncadas (tope ${RESULT_CAP} en el nivel más fino) -----`)
    for (const spec of truncated) {
      console.log(`[CATALOG]   ${spec.label} — ${spec.articleCount} artículos`)
    }
  }
}

/** Build the Playwright launch options, adding the ARCE proxy when configured. */
function buildLaunchOptions(): import('playwright').LaunchOptions {
  const options: import('playwright').LaunchOptions = {
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  }
  if (isArceProxyEnabled()) {
    try {
      const url = new URL(process.env.ARCE_PROXY_URL as string)
      options.proxy = {
        server: `${url.protocol}//${url.host}`,
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      }
      console.log(`[CATALOG] Usando proxy para ARCE: ${maskedProxyUrl()}`)
    } catch {
      console.warn('[CATALOG] ARCE_PROXY_URL no es una URL válida; se ignora el proxy')
    }
  }
  return options
}

/** Enumerate initial family/subfamily specs when the DB has none for this scope. */
async function ensureEnumerated(
  browser: import('playwright').Browser,
  family: number | null
): Promise<void> {
  const where = family !== null ? { familyNumber: family } : {}
  if ((await prisma.catalogScrapeSpec.count({ where })) > 0) return

  // Hardened open with retries; throws CatalogUnavailableError if ARCE never
  // responds, which main() turns into a clean stop.
  const enumPage = await openCatalogPage(browser)
  let specs: Spec[]
  try {
    specs = await enumerateSpecs(enumPage)
  } finally {
    await enumPage.close()
  }
  if (family !== null) specs = specs.filter((s) => familyNumberOf(s) === family)
  await enqueueSpecs(specs)
  console.log(
    `[CATALOG] ${specs.length} búsquedas iniciales encoladas${family !== null ? ` (familia ${family})` : ''}`
  )
}

/** A failed search counts toward the ARCE-down safety cut only when it looks
 * like a network problem (timeout / no response), not a missing filter option. */
function isNetworkFailure(reason: string | undefined): boolean {
  return /timeout|sin respuesta|error:/i.test(reason ?? '')
}

async function main(): Promise<void> {
  const opts = parseCliOptions(process.argv)

  // Report mode: read-only, prints the DB state, never opens Chromium.
  if (opts.report) {
    await printReport(opts.family)
    return
  }

  // One-time import of the legacy JSON progress (no-op if the table has data).
  await importLegacyProgressIfEmpty()

  await fixExistingNames()

  const { chromium } = await import('playwright')
  const browser = await chromium.launch(buildLaunchOptions())

  let totalSaved = 0
  let aborted = false

  try {
    // Default mode enumerates a fresh scope; --only-open works on existing rows.
    // A catalog-open failure is a network failure: like the 5-consecutive-failure
    // safety cut, stop cleanly (no stack trace) without recording any progress.
    if (!opts.onlyOpen) {
      try {
        await ensureEnumerated(browser, opts.family)
      } catch (error) {
        if (error instanceof CatalogUnavailableError) {
          console.error(
            '[CATALOG] ARCE no respondió al abrir el catálogo; no se registró ningún avance. Reintentá más tarde con el mismo comando.'
          )
          return
        }
        throw error
      }
    }

    const familyWhere = opts.family !== null ? { familyNumber: opts.family } : {}
    const statuses: SpecStatus[] = opts.onlyOpen ? ['failed', 'truncated'] : ['pending', 'failed']

    // Estimate the work ahead.
    const [pendingN, failedN, truncatedN] = await Promise.all([
      prisma.catalogScrapeSpec.count({ where: { ...familyWhere, status: 'pending' } }),
      prisma.catalogScrapeSpec.count({ where: { ...familyWhere, status: 'failed' } }),
      prisma.catalogScrapeSpec.count({ where: { ...familyWhere, status: 'truncated' } }),
    ])
    console.log(
      `[CATALOG] Pendientes — sin procesar: ${pendingN}, fallidas: ${failedN}, truncadas: ${truncatedN}`
    )

    const openRows = await prisma.catalogScrapeSpec.findMany({
      where: { ...familyWhere, status: { in: statuses } },
    })
    const queue: Spec[] = openRows.map(rowToSpec)
    console.log(`[CATALOG] A procesar en esta corrida: ${queue.length}`)

    const completedRows = await prisma.catalogScrapeSpec.findMany({
      where: { status: 'completed' },
      select: { key: true },
    })
    const completedKeys = new Set(completedRows.map((r) => r.key))
    const seen = new Set(queue.map(specKey))
    let consecutiveNetFailures = 0

    while (queue.length > 0) {
      const spec = queue.shift() as Spec
      const key = specKey(spec)
      if (completedKeys.has(key)) continue

      console.log(`[CATALOG] Procesando: ${specLabel(spec)}`)
      let result = await runSpec(browser, spec)
      for (let i = 0; result.status === 'failed' && i < RETRY_DELAYS.length; i++) {
        console.log(
          `[CATALOG] Reintento ${i + 1}/${RETRY_DELAYS.length} de ${specLabel(spec)} — ${result.reason}`
        )
        await sleep(RETRY_DELAYS[i])
        result = await runSpec(browser, spec)
      }

      if (result.status === 'failed') {
        await setSpecStatus(spec, 'failed', 0, result.reason ?? 'desconocido')
        console.log(`[CATALOG] ✗ Falló: ${specLabel(spec)} — ${result.reason}`)
        // Safety cut: stop cleanly after too many consecutive network failures.
        consecutiveNetFailures = isNetworkFailure(result.reason) ? consecutiveNetFailures + 1 : 0
        if (consecutiveNetFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(
            '[CATALOG] ARCE dejó de responder; parando. Reintentá más tarde con el mismo comando.'
          )
          aborted = true
          break
        }
        await sleep(SCRAPE_DELAY_MS)
        continue
      }

      consecutiveNetFailures = 0 // a success clears the safety counter
      const savedNow = await saveArticles(result.articles)
      totalSaved += savedNow

      if (result.truncated && result.childField && result.childOptions.length > 0) {
        const levelName = result.childField === 'claseText' ? 'clase' : 'subclase'
        const children: Spec[] = result.childOptions.map((text) => ({
          ...spec,
          [result.childField as 'claseText' | 'subClaseText']: text,
        }))
        await enqueueSpecs(children) // persist children so a restart still has them
        for (const child of children) {
          const childKey = specKey(child)
          if (!seen.has(childKey) && !completedKeys.has(childKey)) {
            seen.add(childKey)
            queue.push(child)
          }
        }
        // The parent's first 1000 are saved; its children cover the rest.
        await setSpecStatus(spec, 'completed', result.articles.length, null)
        completedKeys.add(key)
        console.log(
          `[CATALOG] ${specLabel(spec)} truncada → refinando por ${levelName} (${children.length} ${levelName}s).`
        )
      } else if (result.truncated) {
        // Exactly at the 1000 cap with no finer level — record it as truncated.
        await setSpecStatus(spec, 'truncated', result.articles.length, `tope ${RESULT_CAP} sin nivel más fino`)
        console.log(`[CATALOG] ⚠ ${specLabel(spec)} truncada (${result.articles.length}) sin nivel más fino`)
      } else {
        await setSpecStatus(spec, 'completed', result.articles.length, null)
        completedKeys.add(key)
      }

      console.log(
        `[CATALOG]   → ${result.articles.length} scrapeados, ${savedNow} guardados (acumulado ${totalSaved})`
      )
      await sleep(SCRAPE_DELAY_MS)
    }
  } finally {
    await browser.close()
  }

  console.log(
    `[CATALOG] ${aborted ? 'Corrida interrumpida' : 'Corrida finalizada'} — ${totalSaved} artículos guardados`
  )
  await printReport(opts.family)
}

main()
  .catch((error) => {
    console.error('[CATALOG] Falló:', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
