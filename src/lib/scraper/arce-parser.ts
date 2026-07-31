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

/** Detect the currency mentioned in a fragment. Defaults to UYU. */
function detectCurrency(text: string): string {
  if (/U\$S|USD|d[óo]lar/i.test(text)) return 'USD'
  return 'UYU'
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
 * Read the buying entity from an adjudication page. ARCE labels it as "Unidad
 * ejecutora" (sometimes "Unidad de Compra" / "Inciso" / "Organismo"). Best-effort
 * and defensive: returns null when no label is found so callers never rely on the
 * RSS title for the organismo.
 */
function extractOrganismo(html: string): string | null {
  const text = stripTags(html)
  const labels = [
    'Unidad ejecutora',
    'Unidad Ejecutora',
    'Unidad de Compra',
    'Unidad Compradora',
    'Inciso',
    'Organismo',
  ]
  for (const label of labels) {
    const idx = text.toLowerCase().indexOf(label.toLowerCase())
    if (idx === -1) continue
    const scope = text.slice(idx + label.length, idx + label.length + 120)
    const cleaned = scope
      .replace(/^[\s:.\-–—]+/, '')
      .split(/\s{2,}|\||·|;/)[0]
      .trim()
    if (cleaned.length >= 3) return cleaned.slice(0, 100)
  }
  return null
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

function extractAdjudicatedItems(html: string, currency: string): AdjudicatedItem[] {
  const items: AdjudicatedItem[] = []
  const blockRegex = /<div[^>]*class="[^"]*\bitem\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  let match: RegExpExecArray | null
  let counter = 0

  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[1]
    const providerMatch = block.match(
      /<h4[^>]*class="[^"]*provider-name[^"]*"[^>]*>([\s\S]*?)<\/h4>/i
    )
    if (!providerMatch) continue

    counter += 1
    const providerName = stripTags(providerMatch[1])
    const blockText = stripTags(block)
    const codeMatch = blockText.match(/C[óo]d\.?\s*Art[íi]culo\s*(\d+)/i)
    const rutMatch = blockText.match(/RUT\s*(\d{6,})/i)
    const amounts = Array.from(blockText.matchAll(/\$\s*[\d.]+,\d{2}/g)).map((m) =>
      parseUruguayanAmount(m[0])
    )

    items.push({
      itemNumber: counter,
      name: blockText.split(/\(?\s*C[óo]d/i)[0].slice(0, 120).trim(),
      articleCode: codeMatch ? codeMatch[1] : null,
      providerName,
      providerRut: rutMatch ? rutMatch[1] : null,
      quantity: null,
      unitPriceNoTax: amounts[0] ?? null,
      totalWithTax: amounts.length > 1 ? amounts[amounts.length - 1] : null,
      currency,
    })
  }

  return items
}

export function parseAdjudicationDetail(html: string): AdjudicationDetail {
  const text = stripTags(html)
  const currency = detectCurrency(text)

  const resolutionMatch = text.match(/Adjudicada\s+(totalmente|parcialmente)/i)
  const resolution = resolutionMatch ? `Adjudicada ${resolutionMatch[1].toLowerCase()}` : null

  // Total amount: prefer a value near "total".
  const totalIdx = text.toLowerCase().indexOf('total')
  const totalScope = totalIdx !== -1 ? text.slice(totalIdx, totalIdx + 80) : text
  const totalAmount = parseUruguayanAmount(totalScope)

  const actaMatch = html.match(/href="([^"]*\.pdf)"[^>]*>[^<]*acta/i)
  const actaUrl = actaMatch
    ? actaMatch[1].startsWith('http')
      ? actaMatch[1]
      : `${ARCE_BASE}${actaMatch[1].startsWith('/') ? '' : '/'}${actaMatch[1]}`
    : null

  return {
    resolution,
    organismo: extractOrganismo(html),
    purchaseDate: findDateAfterLabel(html, 'Fecha de la compra') ?? findDateAfterLabel(html, 'Fecha'),
    totalAmount,
    currency,
    participants: extractParticipants(html),
    adjudicatedItems: extractAdjudicatedItems(html, currency),
    actaUrl,
  }
}
