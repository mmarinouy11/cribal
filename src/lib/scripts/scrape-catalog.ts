import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import he from 'he'
import type { Page } from 'playwright'
import { prisma } from '../db/prisma'
import { normalizeText } from '../text/normalize'

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

const PROGRESS_FILE =
  process.env.CATALOG_PROGRESS_FILE || '/app/data/catalog/scrape-progress.json'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A search that could not complete (no response, timeout, missing option, …).
// Kept out of `completed` so it is retried, and carries the spec for re-enqueue.
interface FailedEntry {
  key: string
  label: string
  reason: string
  spec: Spec
}

interface Progress {
  completed: Set<string> // spec keys fully handled (searched; children enqueued if truncated)
  refined: Set<string> // subfamily/clase keys already expanded into children
  pending: Spec[] // remaining work queue (incl. generated child specs) for mid-DFS resume
  failed: FailedEntry[] // searches that failed after retries, to retry next run
  totalSaved: number
}

/** Load resume progress. */
function loadProgress(): Progress {
  try {
    const raw = fs.readFileSync(PROGRESS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as {
      completed?: string[]
      refined?: string[]
      pending?: Spec[]
      failed?: FailedEntry[]
      totalSaved?: number
    }
    return {
      completed: new Set(parsed.completed ?? []),
      refined: new Set(parsed.refined ?? []),
      pending: parsed.pending ?? [],
      failed: parsed.failed ?? [],
      totalSaved: parsed.totalSaved ?? 0,
    }
  } catch {
    return { completed: new Set(), refined: new Set(), pending: [], failed: [], totalSaved: 0 }
  }
}

function saveProgress(progress: Progress, queue: Spec[], lastSpecLabel: string): void {
  try {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true })
    fs.writeFileSync(
      PROGRESS_FILE,
      JSON.stringify(
        {
          lastSpec: lastSpecLabel,
          totalSaved: progress.totalSaved,
          completed: [...progress.completed],
          refined: [...progress.refined],
          pending: queue,
          failed: progress.failed,
        },
        null,
        2
      )
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CATALOG] No se pudo guardar el progreso: ${message}`)
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
      },
      update: {
        name: article.name,
        nameNorm,
        familyText: article.familyText || null,
        subfamilyText: article.subfamilyText || null,
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

/** Enumerate the initial family/subfamily specs (one lightweight session). */
async function enumerateSpecs(page: Page): Promise<Spec[]> {
  await page.goto(CATALOG_URL)
  await page.waitForTimeout(3000)

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
      await page.goto(CATALOG_URL, { timeout: GOTO_TIMEOUT })
    } catch {
      return fail('timeout cargando la página')
    }
    await page.waitForTimeout(3000)

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

/**
 * Clean the progress file at startup:
 * - Migrate pre-refinement 2-part keys (familia||subfamilia) to the 4-part spec
 *   form.
 * - Re-open any subfamily entry that the DB shows is incomplete so it reruns:
 *   0 articles (a past failure wrongly marked complete) or still at the 1000 cap
 *   (truncated). Refined subfamilies are left alone — their classes cover them.
 */
async function migrateAndPrune(progress: Progress): Promise<void> {
  const migrated = new Set<string>()
  for (const key of progress.completed) {
    const parts = key.split('||')
    migrated.add(parts.length === 2 ? `${parts[0]}||${parts[1]}||||` : key)
  }
  progress.completed = migrated

  for (const key of [...progress.completed]) {
    const [family, subfamily, clase, subclase] = key.split('||')
    const isSubfamilyLevel = Boolean(subfamily) && !clase && !subclase
    if (!isSubfamilyLevel || progress.refined.has(key)) continue
    const count = await prisma.catalogArticle.count({
      where: { familyText: family, subfamilyText: subfamily },
    })
    if (count === 0) {
      progress.completed.delete(key)
      console.log(`[CATALOG] Re-scrape por 0 artículos: ${family} / ${subfamily}`)
    } else if (count >= RESULT_CAP) {
      progress.completed.delete(key)
      console.log(`[CATALOG] Re-scrape por tope (${count}≥${RESULT_CAP}): ${family} / ${subfamily}`)
    }
  }
}

async function main(): Promise<void> {
  const progress = loadProgress()
  if (progress.completed.size > 0) {
    console.log(
      `[CATALOG] Reanudando — ${progress.completed.size} búsquedas completadas, ${progress.refined.size} refinadas`
    )
  }

  // Previous run's failures are retried this run; reset the list so it reflects
  // only what fails now.
  const previousFailures = progress.failed
  progress.failed = []

  await fixExistingNames()
  await migrateAndPrune(progress)

  const { chromium } = await import('playwright')
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined
  const browser = await chromium.launch({ headless: true, executablePath })

  const stillTruncated: string[] = []

  try {
    // Resume a mid-DFS run from the persisted queue; otherwise enumerate fresh.
    let queue: Spec[]
    if (progress.pending.length > 0) {
      queue = progress.pending
      console.log(`[CATALOG] Reanudando cola — ${queue.length} búsquedas pendientes`)
    } else {
      const enumPage = await browser.newPage()
      enumPage.setDefaultTimeout(30000)
      try {
        queue = await enumerateSpecs(enumPage)
      } finally {
        await enumPage.close()
      }
      console.log(`[CATALOG] ${queue.length} búsquedas iniciales (familia/subfamilia)`)
    }

    // Re-enqueue specs that failed on an earlier run (deduped against the queue
    // and anything already completed).
    const queueKeys = new Set(queue.map(specKey))
    let reEnqueued = 0
    for (const f of previousFailures) {
      if (queueKeys.has(f.key) || progress.completed.has(f.key)) continue
      queue.push(f.spec)
      queueKeys.add(f.key)
      reEnqueued += 1
    }
    if (reEnqueued > 0) {
      console.log(`[CATALOG] ${reEnqueued} búsqueda(s) fallida(s) previa(s) reencoladas para reintentar`)
    }

    while (queue.length > 0) {
      const spec = queue.shift() as Spec
      const key = specKey(spec)
      if (progress.completed.has(key)) {
        saveProgress(progress, queue, specLabel(spec))
        continue
      }

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
        // Never mark a failure as completed — record it for the summary and for
        // retry on the next run.
        progress.failed.push({ key, label: specLabel(spec), reason: result.reason ?? 'desconocido', spec })
        console.log(`[CATALOG] ✗ Falló tras reintentos: ${specLabel(spec)} — ${result.reason}`)
        saveProgress(progress, queue, specLabel(spec))
        await sleep(1000)
        continue
      }

      const savedNow = await saveArticles(result.articles)
      progress.totalSaved += savedNow

      if (result.truncated && result.childField && result.childOptions.length > 0) {
        const levelName = result.childField === 'claseText' ? 'clase' : 'subclase'
        console.log(
          `[CATALOG] Subfamilia ${specLabel(spec)} truncada → refinando por ${levelName} (${result.childOptions.length} ${levelName}s).`
        )
        const children: Spec[] = result.childOptions.map((text) => ({
          ...spec,
          [result.childField as 'claseText' | 'subClaseText']: text,
        }))
        // Process children next (DFS) so a truncated branch is fully refined
        // before moving on — keeps progress/logs coherent.
        queue.unshift(...children)
        progress.refined.add(key)
        progress.completed.add(key)
      } else {
        progress.completed.add(key)
        if (result.truncated) {
          // Truncated with no finer level left — a genuine coverage gap.
          stillTruncated.push(specLabel(spec))
          console.log(`[CATALOG] ⚠ ${specLabel(spec)} sigue truncada y no hay nivel más fino`)
        }
      }

      saveProgress(progress, queue, specLabel(spec))
      console.log(
        `[CATALOG]   → ${result.articles.length} scrapeados, ${savedNow} guardados (acumulado ${progress.totalSaved})`
      )

      // Pause between searches to be respectful to ARCE.
      await sleep(1000)
    }
  } finally {
    await browser.close()
  }

  console.log(`[CATALOG] Completado — ${progress.totalSaved} artículos guardados en total`)

  if (progress.failed.length > 0) {
    console.log(
      `[CATALOG] ✗ ${progress.failed.length} búsqueda(s) fallaron (se reintentarán en la próxima corrida):`
    )
    for (const f of progress.failed) console.log(`[CATALOG]   - ${f.label} — ${f.reason}`)
  } else {
    console.log('[CATALOG] Sin búsquedas fallidas')
  }

  if (stillTruncated.length > 0) {
    console.log(
      `[CATALOG] ⚠ ${stillTruncated.length} búsqueda(s) siguieron truncadas tras agotar los niveles:`
    )
    for (const label of stillTruncated) console.log(`[CATALOG]   - ${label}`)
  } else {
    console.log('[CATALOG] Sin búsquedas truncadas pendientes — cobertura completa')
  }
}

main()
  .catch((error) => {
    console.error('[CATALOG] Falló:', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
