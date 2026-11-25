/**
 * Canonical text normalization for search and keyword matching: lowercase,
 * strip diacritics (NFD + combining marks), collapse whitespace, trim.
 *
 * Using this on both sides of a comparison makes "bicicleta eléctrica" and
 * "bicicleta electrica" match. It is the single source of truth for the catalog
 * search index (`nameNorm`), the search endpoint, and the pipeline keyword
 * filters.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .replace(/\s+/g, ' ')
    .trim()
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

/**
 * Best-effort Spanish singularization for keyword matching: drop a trailing "s"
 * that follows a vowel, e.g. "etiquetas" → "etiqueta", "aires" → "aire",
 * "acondicionados" → "acondicionado". Expects an already diacritic-normalized,
 * lowercase token (see normalizeForMatch).
 *
 * Deliberately conservative — it only removes a vowel + "s" ending and leaves
 * tokens shorter than 4 characters alone — so precision barely changes. It does
 * NOT unify consonant + "es" plurals ("materiales" ↔ "material", "camiones" ↔
 * "camión"): no deterministic rule can also keep "aires" → "aire", so those pairs
 * stay distinct (a miss, never a false match). The only added false positives are
 * singular words that themselves end in a vowel + "s" (e.g. "país" → "pai",
 * "virus" → "viru"); they are stemmed as if plural, but since both sides of the
 * comparison are stemmed the same way this virtually never produces a wrong hit.
 */
export function singularizeToken(token: string): string {
  if (token.length < 4) return token
  const last = token[token.length - 1]
  const prev = token[token.length - 2]
  if (last === 's' && VOWELS.has(prev)) return token.slice(0, -1)
  return token
}

/**
 * normalizeText plus per-word singularization, for plural/singular-insensitive
 * matching. Apply it to BOTH sides of a comparison so a plural keyword matches a
 * singular mention and vice-versa.
 */
export function normalizeForMatch(s: string): string {
  return normalizeText(s).split(' ').map(singularizeToken).join(' ')
}
