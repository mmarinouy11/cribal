import 'dotenv/config'
import { chromium, type Page } from 'playwright'
import { prisma } from '../db/prisma'

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
const SUBFAMILIA_SELECT = 'select[name="selectCatalogForm:subFamilia"]'
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
  }, selector)
}

/** Trigger the catalog search and pull the articles from the AJAX response. */
async function searchAndExtract(
  page: Page,
  familyText: string,
  subfamilyText: string
): Promise<Article[]> {
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

  let updateBody = ''
  try {
    const response = await responsePromise
    updateBody = await response.text()
  } catch {
    console.log('[CATALOG] Sin respuesta send-receive-updates para la búsqueda')
    return []
  }

  await page.waitForTimeout(1000)

  console.log(`[CATALOG] Response body length: ${updateBody.length}`)

  const codes = [...updateBody.matchAll(/dataTable:\d+:j_id295">(\d+)<\/span>/g)]
  const names = [...updateBody.matchAll(/dataTable:\d+:j_id300">([^<]+)<\/span>/g)]

  const articles = codes
    .map((c, i) => ({
      code: Number.parseInt(c[1], 10),
      name: names[i]?.[1]?.trim() ?? '',
      familyText,
      subfamilyText,
    }))
    .filter((a) => Number.isFinite(a.code) && a.code > 0 && a.name.length > 0)

  // The ICEfaces j_id numbers can change between deploys; when the known
  // patterns match nothing, dump a sample so we can see the real structure.
  if (articles.length === 0 && updateBody.length > 0) {
    console.log(`[CATALOG] 0 artículos extraídos — muestra del body:\n${updateBody.slice(0, 500)}`)
  }

  return articles
}

async function scrapeCatalog(): Promise<Article[]> {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage()
  page.setDefaultTimeout(30000)

  const allArticles: Article[] = []

  try {
    await page.goto(CATALOG_URL)
    await page.waitForTimeout(3000)

    const familyOptions = await readOptions(page, FAMILIA_SELECT)
    console.log(`[CATALOG] ${familyOptions.length} familias`)

    for (const family of familyOptions) {
      console.log(`[CATALOG] Familia: ${family.text}`)

      // Selecting a family reloads the subfamily options via AJAX.
      const responsePromise = page.waitForResponse((r) => r.url().includes(UPDATES_URL), {
        timeout: 15000,
      })
      await page.selectOption(FAMILIA_SELECT, family.value)
      try {
        await responsePromise
      } catch {
        // No AJAX (rare) — proceed with whatever the DOM has.
      }

      // The subfamily <select> is repopulated by ICEfaces AFTER the AJAX
      // response; wait until it actually has options before reading them.
      await page
        .waitForFunction(
          () => {
            const sel = document.querySelector(
              'select[name="selectCatalogForm:subFamilia"]'
            ) as HTMLSelectElement | null
            return sel !== null && sel.options.length > 1
          },
          { timeout: 10000 }
        )
        .catch(() => null) // null on timeout — family genuinely has no subfamilies
      await page.waitForTimeout(1000)

      const subfamilyOptions = await readOptions(page, SUBFAMILIA_SELECT)
      console.log(`[CATALOG] Familia ${family.text}: ${subfamilyOptions.length} subfamilias`)

      if (subfamilyOptions.length === 0) {
        const articles = await searchAndExtract(page, family.text, '')
        allArticles.push(...articles)
        console.log(`[CATALOG]   → ${articles.length} artículos (familia completa)`)
        continue
      }

      for (const subfamily of subfamilyOptions) {
        console.log(`[CATALOG]   Subfamilia: ${subfamily.text}`)

        const sfResponsePromise = page.waitForResponse((r) => r.url().includes(UPDATES_URL), {
          timeout: 15000,
        })
        await page.selectOption(SUBFAMILIA_SELECT, subfamily.value)
        try {
          await sfResponsePromise
        } catch {
          // No AJAX — continue.
        }
        await page.waitForTimeout(1000)

        const articles = await searchAndExtract(page, family.text, subfamily.text)
        allArticles.push(...articles)
        console.log(`[CATALOG]   → ${articles.length} artículos`)

        // Be respectful to ARCE between searches.
        await page.waitForTimeout(500)
      }
    }
  } finally {
    await browser.close()
  }

  return allArticles
}

async function main(): Promise<void> {
  const articles = await scrapeCatalog()

  // Deduplicate by code before saving (the same code can appear across searches).
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

  console.log(`[CATALOG] ${saved} artículos únicos guardados (de ${articles.length} scrapeados)`)
}

main()
  .catch((error) => {
    console.error('[CATALOG] Falló:', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
