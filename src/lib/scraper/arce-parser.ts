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
  quantity: string | null
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

function extractAdjudicatedItems(html: string, pageCurrency: string): AdjudicatedItem[] {
  const items: AdjudicatedItem[] = []

  // Each adjudicated item is introduced by a heading carrying its article code
  // ("… (Cód. Artículo 13175)"). Anchor per-item blocks on those headings so the
  // article code stays aligned with the provider and price that follow it.
  const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi
  const headings: { index: number; text: string; code: string }[] = []
  let match: RegExpExecArray | null
  while ((match = headingRegex.exec(html)) !== null) {
    const text = stripTags(match[2])
    const codeMatch = text.match(/C[óo]d\.?\s*Art[íi]culo\s*(\d+)/i)
    if (codeMatch) headings.push({ index: match.index, text, code: codeMatch[1] })
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    const end = i + 1 < headings.length ? headings[i + 1].index : html.length
    const block = html.slice(heading.index, end)

    const providerName = extractProviderName(block)
    const blockText = stripTags(block)
    const rutMatch = blockText.match(/RUT\s*(\d{6,})/i)

    const unitRaw = extractLabeledValue(block, 'Precio unitario sin impuestos')
    const totalRaw =
      extractLabeledValue(block, 'Precio total con impuestos') ??
      extractLabeledValue(block, 'Precio total')

    // Currency comes from the amount's own prefix so mixed-currency pages don't
    // corrupt the statistics; fall back to the page currency only when neither
    // amount is present.
    const currency = unitRaw || totalRaw ? detectCurrency(unitRaw ?? totalRaw ?? '') : pageCurrency

    const name = heading.text
      .split(/\(?\s*C[óo]d\.?\s*Art[íi]culo/i)[0]
      .replace(/[-–—:]\s*$/, '')
      .trim()

    items.push({
      itemNumber: i + 1,
      name: name || `Ítem ${i + 1}`,
      articleCode: heading.code,
      providerName,
      providerRut: rutMatch ? rutMatch[1] : null,
      quantity: null,
      unitPriceNoTax: unitRaw ? parseUruguayanAmount(unitRaw) : null,
      totalWithTax: totalRaw ? parseUruguayanAmount(totalRaw) : null,
      currency,
    })
  }

  return items
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
    // Adjudications label the date "Fecha de Compra"; some show "Fecha
    // Resolución" instead, so both are tried.
    purchaseDate:
      findDateAfterLabel(html, 'Fecha de Compra') ??
      findDateAfterLabel(html, 'Fecha Resolución') ??
      findDateAfterLabel(html, 'Fecha de la compra'),
    totalAmount,
    currency,
    participants: extractParticipants(html),
    adjudicatedItems: extractAdjudicatedItems(html, currency),
    actaUrl,
  }
}
