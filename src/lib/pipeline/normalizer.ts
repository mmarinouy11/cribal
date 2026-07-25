import type { RssItem } from './fetcher'

export interface NormalizedTender {
  tenderId: string        // Extracted from /id/<id> in the URL
  opportunityId: string   // "arce|<tenderId>"
  title: string
  description: string     // HTML stripped, max 800 chars
  url: string
  publicationDate: Date | null
  organismo: string
  tenderType: string
  source: string          // "ARCE"
}

// Ordered on purpose: the first match wins, so more specific labels come first.
const TENDER_TYPES = [
  'Licitación Pública',
  'Licitación Abreviada',
  'Compra Directa',
  'Concurso de Precios',
  'Compra por Excepción',
  'Convenio Marco',
  'Llamado a Expresiones de Interés',
  'Pregón',
  'Arrendamiento de Obra',
]

function stripHtml(str: string): string {
  return str
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTenderId(url: string): string {
  // Matches ".../id/<id>" and ".../mostrar-llamado/1/id/<id>".
  const match = url.match(/\/id\/(\d+)/)
  return match ? match[1] : ''
}

function extractOrganismo(title: string): string {
  const parts = title.split('|')
  return parts.length > 1 ? parts[parts.length - 1].trim() : ''
}

function inferTenderType(title: string): string {
  const lower = title.toLowerCase()
  for (const type of TENDER_TYPES) {
    if (lower.includes(type.toLowerCase())) return type
  }
  return 'Otro'
}

function parseDate(pubDate: string): Date | null {
  if (!pubDate) return null
  const date = new Date(pubDate)
  return isNaN(date.getTime()) ? null : date
}

export function normalize(item: RssItem): NormalizedTender {
  const url = item.link
  const tenderId = extractTenderId(url)
  const rawDescription = item.content || item.contentSnippet || ''
  const description = stripHtml(rawDescription).slice(0, 800)

  return {
    tenderId,
    opportunityId: `arce|${tenderId}`,
    title: stripHtml(item.title),
    description,
    url,
    publicationDate: parseDate(item.pubDate),
    organismo: extractOrganismo(item.title),
    tenderType: inferTenderType(item.title),
    source: 'ARCE',
  }
}
