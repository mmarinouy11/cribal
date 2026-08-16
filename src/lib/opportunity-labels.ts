import { truncate } from './format'

// Fields needed to render an opportunity's headline. The raw `title` is the call
// name (e.g. "Concurso de Precios 79/2026 - Ministerio…") which says nothing about
// what is being tendered; these helpers surface the real object instead.
interface OpportunityLabelFields {
  title: string
  organismo: string | null
  tenderType: string | null
  description: string | null
  objectDescription: string | null
}

/** Extract a call number like "79/2026" from the raw title. */
function extractCallNumber(title: string): string | null {
  const match = title.match(/\b(\d{1,6}\/\d{4})\b/)
  return match ? match[1] : null
}

/**
 * The real object of the tender: the buy-object one-liner when available, else the
 * first chars of the description, else the raw title. Truncated to `maxLength`.
 */
export function opportunityObjeto(opp: OpportunityLabelFields, maxLength = 80): string {
  const objeto = opp.objectDescription?.trim() || opp.description?.trim() || opp.title.trim()
  return truncate(objeto, maxLength)
}

/**
 * Secondary line "Organismo · Tipo Número" (e.g. "Ministerio del Interior ·
 * Concurso de Precios 79/2026"). With `shortType`, only the first word of the
 * tender type is used ("Concurso 79/2026").
 */
export function opportunitySubtitle(
  opp: OpportunityLabelFields,
  options: { shortType?: boolean } = {}
): string {
  const number = extractCallNumber(opp.title)
  const type = opp.tenderType
    ? options.shortType
      ? opp.tenderType.split(/\s+/)[0]
      : opp.tenderType
    : ''
  const call = [type, number].filter(Boolean).join(' ')
  return [opp.organismo?.trim(), call].filter(Boolean).join(' · ')
}
