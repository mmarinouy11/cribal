// Types and pure (network-free, session-free) helpers for the onboarding
// validation step. Kept in a plain module so the client component and the
// server action share the same shapes, and so inferExclusionKeywords can run
// entirely on the client.

export interface ValidationItem {
  id: string // guid del RSS
  title: string // título del llamado
  object: string // descripción/objeto (del contentSnippet)
  organismo: string // extraído del título
  url: string // link al detalle
  feedSource: string // qué feed lo trajo
}

export type Mark = 'relevant' | 'not_relevant' | null

export interface AiClassification {
  id: string
  relevant: boolean
  reason: string
}

export interface CompanyProfileInput {
  name: string
  description: string
  capabilities: string[]
}

// Common Spanish stopwords plus procurement boilerplate that carries no signal.
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a',
  'en', 'y', 'o', 'u', 'para', 'por', 'con', 'sin', 'sobre', 'entre', 'segun',
  'que', 'como', 'mas', 'menos', 'su', 'sus', 'se', 'es', 'son', 'ser', 'este',
  'esta', 'estos', 'estas', 'ese', 'esa', 'lo', 'le', 'les', 'no', 'si', 'ya',
  'compra', 'directa', 'licitacion', 'llamado', 'adjudicacion', 'adjudicada',
  'servicio', 'servicios', 'suministro', 'suministros', 'varios', 'varias',
])

/** Lowercase, strip accents, split into alphabetic tokens ≥ 4 chars. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\u00f1\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

function countTokens(items: ValidationItem[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    // Count each token once per item so a repeated word in one title is not overweighted.
    const seen = new Set(tokenize(`${item.title} ${item.object}`))
    for (const token of seen) counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

/**
 * Suggest exclusion keywords from the user's marks: words that recur (≥ 2) in
 * the "not relevant" items and are absent or much rarer in the relevant ones.
 * Pure client-side JS; returns at most 5 suggestions ordered by strength.
 */
export function inferExclusionKeywords(
  relevant: ValidationItem[],
  notRelevant: ValidationItem[]
): string[] {
  if (notRelevant.length === 0) return []
  const notCounts = countTokens(notRelevant)
  const relCounts = countTokens(relevant)

  const scored: { token: string; score: number }[] = []
  for (const [token, notCount] of notCounts) {
    if (notCount < 2) continue
    const relCount = relCounts.get(token) ?? 0
    // Keep words that are exclusive to (or dominated by) the not-relevant group.
    if (relCount === 0 || notCount / relCount >= 2) {
      scored.push({ token, score: notCount - relCount })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.token)
}

export interface CategoryStat {
  feedSource: string
  total: number
  notRelevant: number
  ratio: number
}

/**
 * Per-category relevance stats from the marks, used to suggest dropping a
 * category whose sample is mostly not relevant. Only categories with enough
 * marked items and a majority of "not relevant" are returned.
 */
export function categoriesToDrop(
  items: ValidationItem[],
  marks: Record<string, Mark>,
  { minMarked = 3, threshold = 0.6 }: { minMarked?: number; threshold?: number } = {}
): CategoryStat[] {
  const byFeed = new Map<string, { total: number; notRelevant: number }>()
  for (const item of items) {
    const mark = marks[item.id]
    if (mark !== 'relevant' && mark !== 'not_relevant') continue
    const entry = byFeed.get(item.feedSource) ?? { total: 0, notRelevant: 0 }
    entry.total += 1
    if (mark === 'not_relevant') entry.notRelevant += 1
    byFeed.set(item.feedSource, entry)
  }

  const stats: CategoryStat[] = []
  for (const [feedSource, { total, notRelevant }] of byFeed) {
    if (total < minMarked) continue
    const ratio = notRelevant / total
    if (ratio >= threshold) stats.push({ feedSource, total, notRelevant, ratio })
  }
  return stats.sort((a, b) => b.ratio - a.ratio)
}
