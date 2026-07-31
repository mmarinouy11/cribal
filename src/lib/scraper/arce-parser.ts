// Pure parsing functions for ARCE (comprasestatales.gub.uy) detail pages.
// No network calls here — only string/regex parsing on raw HTML. The HTML is
// consistent enough across tender types that regex extraction is reliable, and
// every function is defensive: on anything unexpected it returns null/empty
// rather than throwing.

const ARCE_BASE = 'https://www.comprasestatales.gub.uy'

export interface TenderItem {
  itemNumber: number
  name: string
  articleCode: string | null // e.g. "13175" from "(Cód. Artículo 13175)"
  quantity: string | null // e.g. "1,00 UNIDAD"
  unit: string | null
}

export interface TenderDetail {
  closingDate: Date | null // "Recepción de ofertas hasta"
  openingDate: Date | null // "Acto de Apertura"
  prorrogasDate: Date | null // "Prórrogas hasta el"
  clarificationsDate: Date | null // "Aclaraciones hasta el"
  publicationDate: Date | null // "Fecha Publicación"
  contactEmail: string | null
  contactPhone: string | null
  contactName: string | null
  pliegoUrl: string | null
  isElectronic: boolean
  items: TenderItem[]
}

export interface Participant {
  type: string // "RUT" | "CI"
  documentNumber: string
  name: string
}

export interface AdjudicatedItem {
  itemNumber: number
  name: string
  articleCode: string | null
  providerName: string
  providerRut: string | null
  quantity: number | null // e.g. 1.00 from "1,00 UNIDAD"
  unit: string | null // e.g. "UNIDAD", "HORA", "MENSUAL"
  unitPriceNoTax: number | null
  totalWithTax: number | null
  currency: string
}

export interface AdjudicationDetail {
  resolution: string | null // "Adjudicada totalmente" / "Adjudicada parcialmente"
  organismo: string | null // buying entity read from the page, e.g. "Unidad ejecutora"
  purchaseDate: Date | null
  totalAmount: number | null // parsed from "$ 644.160,00"
  currency: string // "UYU" or "USD"
  participants: Participant[]
  adjudicatedItems: AdjudicatedItem[]
  actaUrl: string | null
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function decodeEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&sol;/gi, '/')
    .replace(/&ordm;/gi, 'º')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detect the currency of an amount from its prefix. ARCE prints "$" for pesos,
 * "U$S" for dollars and "€"/"EUR" for euros. Mixing currencies would corrupt the
 * price statistics downstream, so we always read the prefix rather than assume
 * pesos. "U$S" contains "$", so dollars/euros are tested before the UYU default.
 */
function detectCurrency(text: string): string {
  if (/U\$S|US\$|USD|d[óo]lar/i.test(text)) return 'USD'
  if (/€|EUR|euro/i.test(text)) return 'EUR'
  return 'UYU'
}

/**
 * Read a value from ARCE's "<li>Label:</li><li><strong>VALUE</strong></li>"
 * layout. Tolerant of attributes, whitespace and a missing <strong>. Returns the
 * raw text (e.g. "$ 88.000,00", "22/05/2026") or null.
 */
function extractLabeledValue(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `${escaped}\\s*:?\\s*<\\/li>\\s*<li[^>]*>\\s*(?:<strong[^>]*>\\s*)?([^<]+)`,
    'i'
  )
  const match = html.match(re)
  return match ? decodeEntities(match[1]).trim() : null
}

/**
 * "$ 644.160,00" → 644160.00. Uruguayan format uses "." for thousands and ","
 * for decimals.
 */
export function parseUruguayanAmount(text: string): number | null {
  if (!text) return null

  // Prefer a value with explicit decimals: 644.160,00 or 88000,00
  const withDecimals = text.match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{1,2})/)
  if (withDecimals) {
    const normalized = `${withDecimals[1].replace(/\./g, '')}.${withDecimals[2]}`
    const value = Number(normalized)
    return Number.isNaN(value) ? null : value
  }

  // Fallback: grouped integer like 644.160
  const grouped = text.match(/\d{1,3}(?:\.\d{3})+/)
  if (grouped) {
    const value = Number(grouped[0].replace(/\./g, ''))
    return Number.isNaN(value) ? null : value
  }

  return null
}

/**
 * Parse a bare Uruguayan-formatted number: "1,00" → 1, "1.234,50" → 1234.5,
 * "10" → 10. Unlike parseUruguayanAmount this accepts plain integers with no
 * grouping (used for quantities like "10 UNIDAD").
 */
export function parseUruguayanNumber(text: string): number | null {
  if (!text) return null
  const t = text.trim()
  const withDecimals = t.match(/^(\d{1,3}(?:\.\d{3})*|\d+),(\d+)$/)
  if (withDecimals) {
    return Number(`${withDecimals[1].replace(/\./g, '')}.${withDecimals[2]}`)
  }
  const grouped = t.match(/^\d{1,3}(?:\.\d{3})+$/)
  if (grouped) return Number(grouped[0].replace(/\./g, ''))
  const plain = t.match(/^\d+$/)
  if (plain) return Number(plain[0])
  return null
}

/**
 * Split a quantity string like "1,00 UNIDAD" / "10 HORA" into its numeric value
 * and unit of measure (everything after the number).
 */
export function splitQuantityUnit(text: string): {
  quantity: number | null
  unit: string | null
} {
  if (!text) return { quantity: null, unit: null }
  const match = text.trim().match(/^([\d.]*\d(?:,\d+)?)\s+(.+)$/)
  if (!match) return { quantity: null, unit: text.trim() || null }
  return { quantity: parseUruguayanNumber(match[1]), unit: match[2].trim() || null }
}

/** "27/08/2026 12:00hs" or "27/08/2026" → Date (local time). */
export function parseUruguayanDate(text: string): Date | null {
  if (!text) return null
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})(?:[^\d]{0,4}(\d{1,2}):(\d{2}))?/)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2]) - 1
  const year = Number(match[3])
  const hour = match[4] ? Number(match[4]) : 0
  const minute = match[5] ? Number(match[5]) : 0

  const date = new Date(year, month, day, hour, minute)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Find the first date appearing shortly after a label in the HTML. */
function findDateAfterLabel(html: string, label: string): Date | null {
  const text = stripTags(html)
  const idx = text.toLowerCase().indexOf(label.toLowerCase())
  if (idx === -1) return null
  const window = text.slice(idx + label.length, idx + label.length + 60)
  return parseUruguayanDate(window)
}

// ---------------------------------------------------------------------------
// Active tender detail
// ---------------------------------------------------------------------------

function extractPliegoUrl(html: string): string | null {
  const match = html.match(/href="([^"]*\/Pliegos\/[^"]+\.pdf)"/i)
  if (!match) return null
  const href = decodeEntities(match[1])
  return href.startsWith('http') ? href : `${ARCE_BASE}${href.startsWith('/') ? '' : '/'}${href}`
}

function extractContact(html: string): {
  email: string | null
  phone: string | null
  name: string | null
} {
  const addressMatch = html.match(/<address[^>]*>([\s\S]*?)<\/address>/i)
  const scope = addressMatch ? addressMatch[1] : html
  const scopeText = stripTags(scope)

  const emailMatch = scopeText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  const email = emailMatch ? emailMatch[0] : null

  const phoneMatch = scopeText.match(/(?:tel[eé]fono|tel\.?)[:\s]*([\d\s()+-]{6,})/i)
  const phone = phoneMatch ? phoneMatch[1].trim() : null

  const nameMatch = scopeText.match(/(?:contacto|responsable)[:\s]*([^,.\n]{3,60})/i)
  const name = nameMatch ? nameMatch[1].trim() : null

  return { email, phone, name }
}

function extractTenderItems(html: string): TenderItem[] {
  const items: TenderItem[] = []
  // Each item's title lives in a heading that carries "(Cód. Artículo NNNNN)".
  const headingRegex = /<(h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  let counter = 0

  while ((match = headingRegex.exec(html)) !== null) {
    const text = stripTags(match[2])
    const codeMatch = text.match(/C[óo]d\.?\s*Art[íi]culo\s*(\d+)/i)
    if (!codeMatch) continue

    counter += 1
    const articleCode = codeMatch[1]
    const name = text.split(/\(?\s*C[óo]d\.?\s*Art[íi]culo/i)[0].replace(/[-–—:]\s*$/, '').trim()

    // Quantity like "1,00 UNIDAD" / "10 UNIDAD", best-effort within the heading.
    const qtyMatch = text.match(/(\d+(?:[.,]\d+)?)\s+([A-Za-zÁÉÍÓÚñÑ]+)/)
    const quantity = qtyMatch ? `${qtyMatch[1]} ${qtyMatch[2]}` : null
    const unit = qtyMatch ? qtyMatch[2] : null

    const itemNumberMatch = text.match(/[íi]tem\s*(\d+)/i)
    const itemNumber = itemNumberMatch ? Number(itemNumberMatch[1]) : counter

    items.push({ itemNumber, name: name || `Ítem ${itemNumber}`, articleCode, quantity, unit })
  }

  return items
}

export function parseTenderDetail(html: string): TenderDetail {
  const contact = extractContact(html)
  return {
    closingDate: findDateAfterLabel(html, 'Recepción de ofertas hasta'),
    openingDate: findDateAfterLabel(html, 'Acto de Apertura'),
    prorrogasDate: findDateAfterLabel(html, 'Prórrogas hasta'),
    clarificationsDate: findDateAfterLabel(html, 'Aclaraciones hasta'),
    publicationDate: findDateAfterLabel(html, 'Fecha Publicación'),
    contactEmail: contact.email,
    contactPhone: contact.phone,
    contactName: contact.name,
    pliegoUrl: extractPliegoUrl(html),
    isElectronic: /apertura\s+electr[óo]nica/i.test(stripTags(html)),
    items: extractTenderItems(html),
  }
}

// ---------------------------------------------------------------------------
// Adjudication detail
// ---------------------------------------------------------------------------

export function isAdjudication(html: string): boolean {
  const text = stripTags(html)
  return /adjudicad[oa]/i.test(text) || /[íi]tems?\s+adjudicados/i.test(text)
}

/**
 * Read the buying entity from an adjudication page. ARCE renders it inside the
 * page heading as `<h2>… <span class="small">ORGANISMO</span></h2>`. Best-effort
 * and defensive: returns null when the span is absent so callers can fall back to
 * the feed title instead of picking up page-footer text.
 */
function extractOrganismo(html: string): string | null {
  const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
  if (!h2Match) return null
  const spanMatch = h2Match[1].match(
    /<span[^>]*class="[^"]*\bsmall\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i
  )
  if (!spanMatch) return null
  const value = stripTags(spanMatch[1])
  return value.length >= 3 ? value.slice(0, 100) : null
}

function extractParticipants(html: string): Participant[] {
  const participants: Participant[] = []
  // Locate the "Proveedores participantes" table and read its rows.
  const idx = html.toLowerCase().indexOf('proveedores participantes')
  if (idx === -1) return participants

  const after = html.slice(idx)
  const tableMatch = after.match(/<table[\s\S]*?<\/table>/i)
  if (!tableMatch) return participants

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let row: RegExpExecArray | null
  while ((row = rowRegex.exec(tableMatch[0])) !== null) {
    const cells = Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) =>
      stripTags(c[1])
    )
    if (cells.length < 2) continue
    const typeMatch = cells.join(' ').match(/\b(RUT|CI)\b/i)
    const docMatch = cells.join(' ').match(/\b(\d{6,})\b/)
    participants.push({
      type: typeMatch ? typeMatch[1].toUpperCase() : 'RUT',
      documentNumber: docMatch ? docMatch[1] : '',
      name: cells[cells.length - 1] || cells[0],
    })
  }

  return participants
}

/** Read the provider name from `<h4 class="provider-name">Proveedor: <strong>NAME</strong></h4>`. */
function extractProviderName(block: string): string {
  const h4 = block.match(/<h4[^>]*class="[^"]*provider-name[^"]*"[^>]*>([\s\S]*?)<\/h4>/i)
  if (!h4) return ''
  const strong = h4[1].match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)
  const raw = strong ? strong[1] : h4[1].replace(/proveedor\s*:?/i, '')
  return stripTags(raw)
}

/**
 * Read a `<ul class="list-inline">` where labels and values alternate as sibling
 * `<li>` elements — "<li>Cantidad:</li><li><strong>1,00 UNIDAD</strong></li>" —
 * into a label→value map. Labels are lowercased with the trailing colon stripped.
 */
function extractLiPairs(block: string): Map<string, string> {
  const ul = block.match(/<ul[^>]*class="[^"]*list-inline[^"]*"[^>]*>([\s\S]*?)<\/ul>/i)
  const scope = ul ? ul[1] : ''
  const cells = Array.from(scope.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)).map((m) =>
    stripTags(m[1])
  )
  const map = new Map<string, string>()
  for (let i = 0; i + 1 < cells.length; i += 2) {
    const label = cells[i].replace(/\s*:\s*$/, '').trim().toLowerCase()
    if (label) map.set(label, cells[i + 1].trim())
  }
  return map
}

function extractAdjudicatedItems(html: string, pageCurrency: string): AdjudicatedItem[] {
  const items: AdjudicatedItem[] = []

  // Each adjudicated item is a `<div class="desc-item">` block. Slice from one
  // desc-item to the next so each block's own heading, provider and price stay
  // together (the divs nest, so we can't rely on the closing </div>).
  const starts: number[] = []
  const descRegex = /class="[^"]*\bdesc-item\b[^"]*"/gi
  let match: RegExpExecArray | null
  while ((match = descRegex.exec(html)) !== null) starts.push(match.index)

  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : html.length)

    // Heading: "<span class="buy-item-title-small">Ítem Nº 1</span> NAME <span
    // class="cod-art">(Cód. Artículo 13175)</span>". Strip the two spans to get
    // the clean item name.
    const h3 = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    const h3html = h3 ? h3[1] : ''
    const h3text = stripTags(h3html)
    const codeMatch = h3text.match(/C[óo]d\.?\s*Art[íi]culo\s*(\d+)/i)
    const numberMatch = h3text.match(/[íi]tem\s*N[ºo°]?\s*(\d+)/i)
    const name = stripTags(
      h3html
        .replace(/<span[^>]*buy-item-title-small[^>]*>[\s\S]*?<\/span>/i, '')
        .replace(/<span[^>]*cod-art[^>]*>[\s\S]*?<\/span>/i, '')
    ).trim()

    // Provider: "<h4 class="provider-name">Proveedor: <strong>NAME</strong>
    // <span>(RUT 213453280018)</span></h4>".
    const providerH4 = block.match(
      /<h4[^>]*class="[^"]*provider-name[^"]*"[^>]*>([\s\S]*?)<\/h4>/i
    )
    const providerName = extractProviderName(block)
    const rutMatch = providerH4 ? stripTags(providerH4[1]).match(/RUT\s*(\d+)/i) : null

    const pairs = extractLiPairs(block)
    const quantityRaw = pairs.get('cantidad') ?? ''
    const unitPriceRaw = pairs.get('precio unitario sin impuestos') ?? ''
    const totalRaw =
      pairs.get('monto total con impuestos') ?? pairs.get('precio total con impuestos') ?? ''

    const { quantity, unit } = splitQuantityUnit(quantityRaw)

    // Currency from the amount's own prefix so mixed-currency pages don't corrupt
    // the statistics; fall back to the page currency only when absent.
    const currency =
      unitPriceRaw || totalRaw ? detectCurrency(unitPriceRaw || totalRaw) : pageCurrency

    items.push({
      itemNumber: numberMatch ? Number(numberMatch[1]) : i + 1,
      name: name || `Ítem ${i + 1}`,
      articleCode: codeMatch ? codeMatch[1] : null,
      providerName,
      providerRut: rutMatch ? rutMatch[1] : null,
      quantity,
      unit,
      unitPriceNoTax: unitPriceRaw ? parseUruguayanAmount(unitPriceRaw) : null,
      totalWithTax: totalRaw ? parseUruguayanAmount(totalRaw) : null,
      currency,
    })
  }

  return items
}

/**
 * Read the purchase date from the left summary column. ARCE uses the same
 * label/value sibling-`<li>` pattern as the items, labelled "Fecha de Compra"
 * (some adjudications show "Fecha Resolución" instead). Falls back to a whole-page
 * label scan.
 */
function extractPurchaseDate(html: string): Date | null {
  const labels = ['Fecha de Compra', 'Fecha Resolución', 'Fecha de la compra']
  for (const label of labels) {
    const raw = extractLabeledValue(html, label)
    const date = raw ? parseUruguayanDate(raw) : null
    if (date) return date
  }
  for (const label of labels) {
    const date = findDateAfterLabel(html, label)
    if (date) return date
  }
  return null
}

export function parseAdjudicationDetail(html: string): AdjudicationDetail {
  const text = stripTags(html)

  const resolutionMatch = text.match(/Adjudicada\s+(totalmente|parcialmente)/i)
  const resolution = resolutionMatch ? `Adjudicada ${resolutionMatch[1].toLowerCase()}` : null

  // Total amount is labelled "Monto Total de la Compra:". Read the currency from
  // its own prefix; only fall back to a whole-page scan when the label is absent.
  const totalRaw = extractLabeledValue(html, 'Monto Total de la Compra')
  const totalAmount = totalRaw ? parseUruguayanAmount(totalRaw) : parseUruguayanAmount(text)
  const currency = totalRaw ? detectCurrency(totalRaw) : detectCurrency(text)

  const actaMatch = html.match(/href="([^"]*\.pdf)"[^>]*>[^<]*acta/i)
  const actaUrl = actaMatch
    ? actaMatch[1].startsWith('http')
      ? actaMatch[1]
      : `${ARCE_BASE}${actaMatch[1].startsWith('/') ? '' : '/'}${actaMatch[1]}`
    : null

  return {
    resolution,
    organismo: extractOrganismo(html),
    purchaseDate: extractPurchaseDate(html),
    totalAmount,
    currency,
    participants: extractParticipants(html),
    adjudicatedItems: extractAdjudicatedItems(html, currency),
    actaUrl,
  }
}
