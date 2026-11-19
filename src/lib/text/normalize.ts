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
