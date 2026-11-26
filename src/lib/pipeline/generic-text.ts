import { normalizeText } from '../text/normalize'
import { parseUruguayanDate } from '../scraper/arce-parser'

// Detect tenders whose RSS text does not describe what is actually being bought,
// so the real signal lives only in the detail-page items (e.g. 1787/2026, titled
// "ADQUISICIÓN ARTÍCULOS DE ALMACENES - PAPELERIA", whose real object was
// "etiquetas autoadhesivas"). Pure and network-free — used to pick second-pass
// candidates in the shared ingestion and to gate the item-aware matching.

// Phrases (diacritic-normalized) that mark a generic text: it points at an
// attachment instead of describing the object, or it names a broad procurement
// umbrella rather than the specific article.
const GENERIC_TRIGGERS: string[] = [
  // References to attached documentation instead of a description.
  'adjunto',
  'anexo',
  'pliego',
  'memoria descriptiva',
  'especificaciones tecnicas',
  'ver detalle',
  'segun detalle',
  'segun pliego',
  'segun anexo',
  'segun especificaciones',
  // Broad umbrella categories whose real items are only in the detail page.
  'articulos varios',
  'materiales varios',
  'insumos varios',
  'utiles varios',
  'suministros varios',
  'articulos de almacen',
  'articulos de libreria',
  'articulos de papeleria',
  'papeleria',
]

/** Escape a string so it can be embedded literally in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Each trigger is matched as whole word(s): not flanked by a letter or digit, with
// an optional plural suffix ("s"/"es") on the last word — so "adjunto" also matches
// "adjuntos" and "articulos de almacen" matches "articulos de almacenes", while
// "almacen" still never matches "almacenamiento" (the extra letters are not "s"/"es"
// followed by a boundary). normalizeText has already lowercased and stripped accents,
// so the boundary only needs to exclude [a-z0-9].
const GENERIC_TRIGGER_PATTERNS: RegExp[] = GENERIC_TRIGGERS.map(
  (trigger) => new RegExp(`(?<![a-z0-9])${escapeRegExp(trigger)}(?:s|es)?(?![a-z0-9])`)
)

const SHORT_DESC_MIN_CHARS = 40
const SHORT_DESC_MIN_WORDS = 4

/**
 * Whether a tender's RSS text is "generic": it mentions attached documentation /
 * a broad umbrella category, OR its description is too short to carry the real
 * object. Both title and description are considered for the trigger phrases; the
 * length check looks at the description only.
 */
export function isGenericText(title: string, description: string): boolean {
  const combined = normalizeText(`${title} ${description}`)
  if (GENERIC_TRIGGER_PATTERNS.some((pattern) => pattern.test(combined))) return true

  const desc = normalizeText(description)
  const words = desc.split(' ').filter(Boolean)
  return desc.length < SHORT_DESC_MIN_CHARS || words.length < SHORT_DESC_MIN_WORDS
}

/**
 * Best-effort closing date read from a tender's RSS text, no network. ARCE feeds
 * sometimes carry "Recepción de ofertas hasta DD/MM/YYYY[ HH:MM]". Returns null
 * when the label or a date is absent (caller then treats the tender as open).
 */
export function parseClosingFromText(text: string): Date | null {
  const normalized = normalizeText(text)
  const label = 'recepcion de ofertas hasta'
  const idx = normalized.indexOf(label)
  if (idx === -1) return null
  const window = normalized.slice(idx + label.length, idx + label.length + 40)
  return parseUruguayanDate(window)
}
