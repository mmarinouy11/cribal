import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright'
import { prisma } from '../db/prisma'

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
const UPDATES_URL = 'send-receive-updates'

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
      name: names[i]?.[1]?.trim() ?? '',
      familyText,
      subfamilyText,
    }))
    .filter((a) => Number.isFinite(a.code) && a.code > 0 && a.name.length > 0)
}

/** Click the search button via iceSubmit and return the AJAX body (empty on failure). */
async function triggerSearch(page: Page): Promise<string> {
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
    return ''
  }
}

/** Run the search and page through all results, accumulating every article. */
async function searchAndExtract(
  page: Page,
  familyText: string,
  subfamilyText: string
): Promise<Article[]> {
  let updateBody = await triggerSearch(page)
  if (!updateBody) return []
  await page.waitForTimeout(1000)

  const allArticles: Article[] = []

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
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

    // Diagnostic: ICEfaces <a> paginators carry their own onclick handler.
    const nextInfo = await page.evaluate((id: string) => {
      const el = document.getElementById(id)
      return { onclick: el?.getAttribute('onclick') ?? null, tagName: el?.tagName ?? null }
    }, NEXT_BUTTON_ID)
    console.log('[CATALOG] Next button:', JSON.stringify(nextInfo))

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
      const firstArticle = extractArticles(updateBody, familyText, subfamilyText)[0]
      console.log(
        `[CATALOG] Tras click — body: ${updateBody.length} chars | primer artículo: ${
          firstArticle ? `${firstArticle.code} ${firstArticle.name}` : '(ninguno)'
        }`
      )
    } catch {
      break
    }
  }

  return allArticles
}

// One family/subfamily search to perform. subfamilyText is null for families
// that have no subfamilies (a family-level search).
interface CatalogTask {
  familyText: string
  subfamilyText: string | null
}

const PROGRESS_FILE =
  process.env.CATALOG_PROGRESS_FILE || '/app/data/catalog/scrape-progress.json'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function taskKey(familyText: string, subfamilyText: string | null): string {
  return `${familyText}||${subfamilyText ?? ''}`
}

/** Load resume progress: the set of completed task keys and the running total. */
function loadProgress(): { completed: Set<string>; totalSaved: number } {
  try {
    const raw = fs.readFileSync(PROGRESS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { completed?: string[]; totalSaved?: number }
    return { completed: new Set(parsed.completed ?? []), totalSaved: parsed.totalSaved ?? 0 }
  } catch {
    return { completed: new Set(), totalSaved: 0 }
  }
}

function saveProgress(
  completed: Set<string>,
  lastFamily: string,
  lastSubfamily: string,
  totalSaved: number
): void {
  try {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true })
    fs.writeFileSync(
      PROGRESS_FILE,
      JSON.stringify({ lastFamily, lastSubfamily, totalSaved, completed: [...completed] }, null, 2)
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
    await prisma.catalogArticle.upsert({
      where: { id: article.code },
      create: {
        id: article.code,
        name: article.name,
        familyText: article.familyText || null,
        subfamilyText: article.subfamilyText || null,
      },
      update: {
        name: article.name,
        familyText: article.familyText || null,
        subfamilyText: article.subfamilyText || null,
      },
    })
    saved += 1
  }
  return saved
}

/**
 * Poll the subfamily <select> until it repopulates (ICEfaces injects options via
 * innerHTML after the AJAX response, which a waitForFunction misses).
 */
async function readSubfamilies(page: Page): Promise<SelectOption[]> {
  let options: SelectOption[] = []
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.waitForTimeout(2000)
    const totalOptions = await page.evaluate(() => {
      const sel = document.querySelector(
        'select[name="selectCatalogForm:subfamilia"]'
      ) as HTMLSelectElement | null
      return sel ? sel.options.length : 0
    })
    console.log(
      `[CATALOG] Select subfamilia — opciones totales incluyendo placeholder: ${totalOptions}`
    )
    options = await readOptions(page, SUBFAMILIA_SELECT)
    if (options.length > 0) break
    console.log(`[CATALOG] Reintento ${attempt + 1} para subfamilias...`)
  }
  return options
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

/** Enumerate every family/subfamily search to run (one lightweight session). */
async function enumerateTasks(page: Page): Promise<CatalogTask[]> {
  await page.goto(CATALOG_URL)
  await page.waitForTimeout(3000)

  const familyOptions = await readOptions(page, FAMILIA_SELECT)
  console.log(`[CATALOG] ${familyOptions.length} familias`)

  const tasks: CatalogTask[] = []
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
      tasks.push({ familyText: family.text, subfamilyText: null })
    } else {
      for (const sub of subs) tasks.push({ familyText: family.text, subfamilyText: sub.text })
    }
  }
  return tasks
}

async function main(): Promise<void> {
  const { completed, totalSaved: resumedTotal } = loadProgress()
  let totalSaved = resumedTotal
  if (completed.size > 0) {
    console.log(`[CATALOG] Reanudando — ${completed.size} búsquedas ya completadas`)
  }

  const { chromium } = await import('playwright')
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined
  const browser = await chromium.launch({ headless: true, executablePath })

  try {
    // Enumerate all tasks first (light session use, one page).
    const enumPage = await browser.newPage()
    enumPage.setDefaultTimeout(30000)
    let tasks: CatalogTask[]
    try {
      tasks = await enumerateTasks(enumPage)
    } finally {
      await enumPage.close()
    }
    console.log(`[CATALOG] ${tasks.length} búsquedas (familia/subfamilia) a procesar`)

    for (const task of tasks) {
      const key = taskKey(task.familyText, task.subfamilyText)
      if (completed.has(key)) {
        console.log(`[CATALOG] Saltando (ya hecho): ${key}`)
        continue
      }

      const label = task.subfamilyText
        ? `${task.familyText} / ${task.subfamilyText}`
        : `${task.familyText} (familia completa)`
      console.log(`[CATALOG] Procesando: ${label}`)

      // Fresh page per task: ICEfaces' session expires under extended use, so a
      // clean context per subfamily avoids getting stuck mid-run.
      const page = await browser.newPage()
      page.setDefaultTimeout(30000)
      let articles: Article[] = []
      try {
        await page.goto(CATALOG_URL)
        await page.waitForTimeout(3000)

        const famOk = await selectOptionByText(page, FAMILIA_SELECT, task.familyText)
        if (!famOk) {
          console.warn(`[CATALOG] Familia no encontrada en página fresca: ${task.familyText}`)
        } else {
          if (task.subfamilyText) {
            await readSubfamilies(page) // wait for repopulation
            const sfOk = await selectOptionByText(page, SUBFAMILIA_SELECT, task.subfamilyText)
            if (!sfOk) {
              console.warn(`[CATALOG] Subfamilia no encontrada: ${task.subfamilyText}`)
            }
            await page.waitForTimeout(1000)
          }
          articles = await searchAndExtract(page, task.familyText, task.subfamilyText ?? '')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[CATALOG] Error en ${key}: ${message}`)
      } finally {
        await page.close()
      }

      const savedNow = await saveArticles(articles)
      totalSaved += savedNow
      completed.add(key)
      saveProgress(completed, task.familyText, task.subfamilyText ?? '', totalSaved)
      console.log(
        `[CATALOG]   → ${articles.length} scrapeados, ${savedNow} guardados (acumulado ${totalSaved})`
      )

      // Pause between subfamilies to be respectful to ARCE.
      await sleep(1000)
    }
  } finally {
    await browser.close()
  }

  console.log(`[CATALOG] Completado — ${totalSaved} artículos guardados en total`)
}

main()
  .catch((error) => {
    console.error('[CATALOG] Falló:', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
