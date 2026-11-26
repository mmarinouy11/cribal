import type { NormalizedTender } from './normalizer'
import { normalizeForMatch } from '@/lib/text/normalize'

export interface KeywordFilterResult {
  passed: NormalizedTender[]
  rejected: { tender: NormalizedTender; reason: string }[]
}

/** Detail items of a generic tender, used to widen the keyword haystack. */
export interface TenderItemsForMatch {
  itemNames: string[]
  articleCodes: string[]
}

export interface KeywordFilterOptions {
  // Item names + article codes for GENERIC tenders only (keyed by tenderId). The
  // caller omits non-generic tenders, so existing behavior is unchanged for them.
  itemsByTenderId?: Map<string, TenderItemsForMatch>
  // The company's catalog article ids chosen in onboarding; an item whose article
  // code is in this set counts as a keyword hit (generic tenders with items only).
  catalogArticleIds?: number[]
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
  _additionalExcluded: string[],
  options: KeywordFilterOptions = {}
): KeywordFilterResult {
  const itemsByTenderId = options.itemsByTenderId ?? new Map<string, TenderItemsForMatch>()
  const catalogArticleIds = new Set((options.catalogArticleIds ?? []).map((id) => String(id)))
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
    // For generic tenders the second pass stored the real items; widen the
    // haystack with their names so "etiquetas autoadhesivas" matches a tender
    // whose RSS text only said "artículos de almacenes". Non-generic tenders have
    // no entry here, so their matching is unchanged.
    const extra = itemsByTenderId.get(tender.tenderId)
    const itemText = extra ? ` ${extra.itemNames.join(' ')}` : ''
    const haystack = normalizeForMatch(`${tender.title} ${tender.description}${itemText}`)

    let matches = relevant.some((keyword) => haystack.includes(keyword))

    // An article code the company picked in its catalog counts as a keyword hit
    // (generic tenders with items only).
    if (!matches && extra && catalogArticleIds.size > 0) {
      matches = extra.articleCodes.some((code) => catalogArticleIds.has(code))
    }

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
