import { normalizeText } from '@/lib/text/normalize'

// The minimal fields needed to derive a tender's object text.
export interface TenderTextLike {
  title: string
  object: string // stripped RSS content (may carry page metadata)
}

const MIN_OBJECT_LENGTH = 6 // below this, there is no usable object text

// "Licitación Abreviada 104219/2026 - " style header: anything up to and
// including the "N/AAAA -" procedure number.
const PROCEDURE_HEADER = /^[^|]*?\d+\s*\/\s*\d+\s*-\s*/

/**
 * Strip the "Recepción de ofertas hasta: 11:00hs 12:40hs" trailing clause and
 * any opening/closing date-time remnants (e.g. "13:00hs | 15:40hs"). ARCE often
 * appends these to titles; they are noise both on screen and for the AI.
 */
export function stripClosingMetadata(text: string): string {
  return text
    // Cut everything from the reception-of-offers clause to the end.
    .replace(/\s*recepci[oó]n\s+de\s+ofertas\s+hasta\b.*$/is, '')
    // Cut an opening/closing clause when it is followed by a time or date.
    .replace(/\s*(apertura|cierre)(?:\s+electr[oó]nica)?\s*:?\s*(?=\d{1,2}[:/]).*$/is, '')
    // Remove stray time tokens such as "11:00hs" / "13:15 hs" / "10:00".
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*hs\b/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    // Tidy leftover separators and the lone "hs" unit.
    .replace(/\|/g, ' ')
    .replace(/\bhs\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip page metadata (dates, times, URLs, procedure numbers, labels). */
function stripMetadata(raw: string): string {
  return stripClosingMetadata(raw)
    .replace(/publicad[oa]\s*:/gi, ' ')
    .replace(/[uú]ltima\s+modificaci[oó]n\s*:/gi, ' ')
    .replace(/fecha\s+de\s+(publicaci[oó]n|apertura|modificaci[oó]n)\s*:/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ') // dates
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ') // times
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ') // N/AAAA procedure numbers
    .replace(/\b\d{3,}\b/g, ' ') // long numbers (amounts, ids)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The clean "object" of a tender — what is being bought — with no procedure
 * header, buyer or page metadata. Reads the RSS content (never the title, which
 * is only procedure + number + buyer). Returns '' when the RSS carried no usable
 * object (then the real object is only on the detail page, which we do NOT fetch
 * during onboarding); such items are not valid evidence for suggestions.
 *
 * This is the single source of truth for the text shown as "Ej.:" in the
 * suggestions and in the sample list, so the user sees the object, not the buyer.
 */
export function getTenderObjectText(item: TenderTextLike): string {
  const cleaned = stripMetadata(item.object ?? '')
  return cleaned.length >= MIN_OBJECT_LENGTH ? cleaned : ''
}

/** Whether a tender has a usable object text (valid as suggestion evidence). */
export function hasTenderObject(item: TenderTextLike): boolean {
  return getTenderObjectText(item).length > 0
}

/** Title with the procedure/number header and any closing-time clause removed. */
export function cleanTitle(title: string): string {
  return stripClosingMetadata(title.replace(PROCEDURE_HEADER, '')).trim()
}

/** Best text to display for a tender: its object, or a header-less title. */
export function getTenderDisplayText(item: TenderTextLike): string {
  return getTenderObjectText(item) || cleanTitle(item.title) || item.title
}

/**
 * Buyer terms (Organismo | Unidad) derived from the sample titles, to exclude
 * them as suggestion candidates. The buyer is everything after the "N/AAAA -"
 * header; both the organismo and the unidad after "|" are buyer text.
 */
export function buyerTokensFromTitles(titles: string[]): Set<string> {
  const tokens = new Set<string>()
  for (const title of titles) {
    const header = title.match(PROCEDURE_HEADER)
    const buyerText = header ? title.slice(header[0].length) : title
    for (const word of normalizeText(buyerText).split(/[^a-z0-9ñ]+/).filter(Boolean)) {
      if (word.length >= 3) tokens.add(word)
    }
  }
  return tokens
}
