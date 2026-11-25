import type { NormalizedTender } from './normalizer'
import { normalizeForMatch } from '@/lib/text/normalize'

export interface KeywordFilterResult {
  passed: NormalizedTender[]
  rejected: { tender: NormalizedTender; reason: string }[]
}

/**
 * Deterministic relevance filter driven ONLY by the company's own relevant
 * keywords. Cribal serves every industry, so there is no hardcoded base list:
 * when a company has no relevant keywords the filter is skipped entirely and all
 * items pass through to the AI classifier, which decides relevance from the
 * company profile.
 */
export function filterByKeywords(
  tenders: NormalizedTender[],
  relevantKeywords: string[],
  _additionalExcluded: string[]
): KeywordFilterResult {
  // Normalize keywords diacritic- and plural/singular-insensitively, so
  // "bicicleta electrica" matches "bicicleta eléctrica" and "etiquetas
  // autoadhesivas" matches "etiqueta autoadhesiva de vinilo". The same
  // normalization is applied to the text below, so both sides are stemmed alike.
  const relevant = relevantKeywords.map(normalizeForMatch).filter(Boolean)

  // No company keywords → do not filter; let the AI classifier decide.
  if (relevant.length === 0) {
    console.log(
      `[CRIBAL][KEYWORDS] Sin keywords de empresa — se omite el filtro (${tenders.length} items pasan a IA)`
    )
    return { passed: [...tenders], rejected: [] }
  }

  const passed: NormalizedTender[] = []
  const rejected: { tender: NormalizedTender; reason: string }[] = []

  for (const tender of tenders) {
    const haystack = normalizeForMatch(`${tender.title} ${tender.description}`)
    const matches = relevant.some((keyword) => haystack.includes(keyword))

    if (matches) {
      passed.push(tender)
    } else {
      rejected.push({
        tender,
        reason: `Sin keywords relevantes: revisado ${relevant.length} términos`,
      })
    }
  }

  console.log(
    `[CRIBAL][KEYWORDS] ${tenders.length} → ${passed.length} items con keywords relevantes`
  )

  return { passed, rejected }
}
