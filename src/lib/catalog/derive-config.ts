import { familyFeedUrl } from '@/lib/arce/catalog'
import { normalizeText } from '@/lib/text/normalize'

// An article the user picked in the catalog search.
export interface SelectedArticle {
  id: number
  name: string
  familyNumber: number
}

// A proposed keyword the user reviews (and can untick) before applying.
export interface KeywordOption {
  value: string
  checked: boolean
}

export interface DerivedConfig {
  feeds: string[] // family-level RSS feeds (one per distinct family), deduped
  keywords: {
    searched: KeywordOption[] // group 1 — the user's own search terms
    frequent: KeywordOption[] // group 2 — frequent meaningful words + service specializations
    exact: KeywordOption[] // group 3 — full normalized article names
  }
}

// Words too generic to be useful as a single keyword: Spanish function words,
// plus ARCE's generic catalog prefixes, which would match almost any tender.
// "mantenimiento" is here only as a standalone word — "mantenimiento de
// software" survives as an exact phrase in group 3.
const STOPWORDS = new Set<string>([
  // generic catalog prefixes
  'servicio', 'servicios', 'arrendamiento', 'alquiler', 'suministro', 'suministros',
  'provision', 'compra', 'compras', 'adquisicion', 'mantenimiento',
  // common Spanish function words
  'para', 'con', 'del', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'por', 'que',
  'este', 'esta', 'estos', 'estas', 'como', 'sobre', 'entre', 'desde', 'hasta',
  'uso', 'otros', 'otras', 'otro', 'otra', 'sus', 'sin', 'mas', 'muy', 'son',
  'tipo', 'tipos', 'varios', 'varias', 'general', 'generales',
])

const SERVICE_PREFIXES = ['servicio de ', 'servicio para ', 'servicios de ']
const MIN_REMAINDER_LENGTH = 5 // "servicio de X" → keep X only if it's this long

/**
 * Derive feeds and reviewable keyword suggestions from the catalog articles the
 * user selected. Pure: no I/O, no `any`. The caller merges whatever the user
 * leaves ticked into the company config.
 *
 * Feeds: one family-level feed per distinct family in the selection (ARCE's RSS
 * only filters by family), skipping feeds the company already has.
 *
 * Keywords come in three reviewable groups, deduped against each other and
 * against the company's existing keywords (all compared normalized):
 *  1. searched  — the terms the user typed (checked).
 *  2. frequent  — words in ≥2 selected names, >4 letters, not stopwords, plus
 *                 the specialization left after stripping a "servicio de …"
 *                 prefix (checked).
 *  3. exact     — the full normalized article names (unchecked; very specific).
 */
export function deriveConfigFromArticles(
  selected: SelectedArticle[],
  searchTerms: string[],
  existingKeywords: string[] = [],
  existingFeeds: string[] = []
): DerivedConfig {
  // --- Feeds: one family-level feed per distinct family, deduped. ---
  const existingFeedSet = new Set(existingFeeds)
  const feeds: string[] = []
  const seenFamilies = new Set<number>()
  for (const article of selected) {
    if (!Number.isFinite(article.familyNumber) || seenFamilies.has(article.familyNumber)) continue
    seenFamilies.add(article.familyNumber)
    const feed = familyFeedUrl(article.familyNumber)
    if (!existingFeedSet.has(feed) && !feeds.includes(feed)) feeds.push(feed)
  }

  // Dedupe across all groups and against existing keywords (normalized).
  const seen = new Set<string>(existingKeywords.map(normalizeText).filter(Boolean))
  const take = (value: string): boolean => {
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  }

  // --- Group 1: the user's own search terms. ---
  const searched: KeywordOption[] = []
  for (const term of searchTerms) {
    const value = normalizeText(term)
    if (take(value)) searched.push({ value, checked: true })
  }

  // --- Group 2: frequent meaningful words + service specializations. ---
  // Count words across selected names (once per name).
  const wordCounts = new Map<string, number>()
  const remainders: string[] = []
  for (const article of selected) {
    const norm = normalizeText(article.name)

    // Service specialization: "servicio de consultoria" → "consultoria".
    for (const prefix of SERVICE_PREFIXES) {
      if (norm.startsWith(prefix)) {
        const remainder = norm.slice(prefix.length).trim()
        if (remainder.length >= MIN_REMAINDER_LENGTH) remainders.push(remainder)
        break
      }
    }

    const uniqueWords = new Set(norm.split(/[^a-z0-9]+/).filter(Boolean))
    for (const word of uniqueWords) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1)
    }
  }

  const frequentWords = [...wordCounts.entries()]
    .filter(([word, count]) => count >= 2 && word.length > 4 && !STOPWORDS.has(word))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word)

  const frequent: KeywordOption[] = []
  for (const value of [...remainders, ...frequentWords]) {
    if (take(value)) frequent.push({ value, checked: true })
  }

  // --- Group 3: full normalized article names (very specific). ---
  const exact: KeywordOption[] = []
  for (const article of selected) {
    const value = normalizeText(article.name)
    if (take(value)) exact.push({ value, checked: false })
  }

  return { feeds, keywords: { searched, frequent, exact } }
}
