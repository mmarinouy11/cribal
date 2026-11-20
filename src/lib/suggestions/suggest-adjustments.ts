import { normalizeText } from '@/lib/text/normalize'
import type { ValidationItem } from '@/lib/register/validation'
import { isGenericCandidate, isHardGenericWord, isStopword } from './generic-terms'

// One suggested keyword/phrase plus up to 3 tender titles that motivated it.
export interface AdjustmentSuggestion {
  value: string // normalized keyword or phrase
  titles: string[] // "por qué" — up to 3 motivating tender titles
}

export interface AdjustmentSuggestions {
  include: AdjustmentSuggestion[] // checked by default, max 6
  exclude: AdjustmentSuggestion[] // unchecked by default, max 4
}

const MAX_INCLUDE = 6
const MAX_EXCLUDE = 4
const MAX_PHRASE_WORDS = 3
const MAX_TITLES = 3
const EXCLUDE_SAMPLE_SHARE_CAP = 0.3 // drop exclusions present in >30% of the sample

interface Candidate {
  value: string
  words: string[]
}

/** Normalized searchable text for an item (title + object). */
function itemText(item: ValidationItem): string {
  return normalizeText(`${item.title} ${item.object}`)
}

/** Generate 1–3 word candidate phrases whose boundary words are meaningful. */
function candidatesFromText(text: string): Candidate[] {
  const words = text.split(' ').filter(Boolean)
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= MAX_PHRASE_WORDS && i + n <= words.length; n++) {
      const slice = words.slice(i, i + n)
      // Boundary words must be meaningful: no stopwords/always-generic/numbers
      // at the edges, but "renovacion"/"mantenimiento" may open a phrase, and
      // interior connectors ("de") are fine ("renovacion de licencias").
      if (isHardGenericWord(slice[0]) || isHardGenericWord(slice[n - 1])) continue
      if (slice[0].length < 3 || slice[n - 1].length < 3) continue
      const value = slice.join(' ')
      if (seen.has(value)) continue
      seen.add(value)
      out.push({ value, words: slice })
    }
  }
  return out
}

/** Map every candidate to the set of items (by index) it appears in. */
function candidateItemSets(items: ValidationItem[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>()
  items.forEach((item, index) => {
    const text = itemText(item)
    const seenHere = new Set<string>()
    for (const candidate of candidatesFromText(text)) {
      if (seenHere.has(candidate.value)) continue
      seenHere.add(candidate.value)
      const set = map.get(candidate.value) ?? new Set<number>()
      set.add(index)
      map.set(candidate.value, set)
    }
  })
  return map
}

function titlesFor(items: ValidationItem[], indices: Set<number>): string[] {
  return [...indices].slice(0, MAX_TITLES).map((i) => items[i].title)
}

/** Does the phrase appear (as a substring) in any of the given normalized texts? */
function appearsIn(value: string, texts: string[]): boolean {
  return texts.some((t) => t.includes(value))
}

/**
 * Suggest keywords to INCLUDE (from the relevant marks) and exclusions (from the
 * not-relevant marks) that the user can review before applying. Pure and
 * network-free. See the task spec for the exact criteria.
 */
export function suggestAdjustments(
  relevant: ValidationItem[],
  notRelevant: ValidationItem[],
  currentKeywords: string[],
  currentExclusions: string[],
  nicheTerms: string[] = []
): AdjustmentSuggestions {
  const relTexts = relevant.map(itemText)
  const relSets = candidateItemSets(relevant)
  const notSets = candidateItemSets(notRelevant)

  const keywordsNorm = currentKeywords.map(normalizeText).filter(Boolean)
  const nicheNorm = nicheTerms.map(normalizeText).filter(Boolean)
  const exclusionsNorm = currentExclusions.map(normalizeText).filter(Boolean)

  const coveredBy = (value: string, list: string[]): boolean =>
    list.some((term) => term === value || term.includes(value) || value.includes(term))

  // --- Includes: recurrent, R-dominant, discriminative phrases. ---
  const relThreshold = relevant.length < 4 ? 1 : 2
  const includeScored: { cand: AdjustmentSuggestion; score: number; words: string[] }[] = []
  for (const [value, relIdx] of relSets) {
    if (relIdx.size < relThreshold) continue
    if (isGenericCandidate(value)) continue
    if (coveredBy(value, keywordsNorm)) continue

    // Not similarly frequent in the not-relevant group.
    const freqR = relIdx.size / Math.max(1, relevant.length)
    const freqN = (notSets.get(value)?.size ?? 0) / Math.max(1, notRelevant.length)
    if (notRelevant.length > 0 && freqN >= 0.5 * freqR) continue

    includeScored.push({
      cand: { value, titles: titlesFor(relevant, relIdx) },
      score: relIdx.size + value.split(' ').length * 0.5, // favor recurrence, then phrases
      words: value.split(' '),
    })
  }
  const include = dedupeContained(
    includeScored.sort((a, b) => b.score - a.score),
    MAX_INCLUDE
  )

  // --- Exclusions: strict. Absent from R/keywords/niches, recurrent in N. ---
  const sampleSize = relevant.length + notRelevant.length
  const excludeScored: { cand: AdjustmentSuggestion; score: number; words: string[] }[] = []
  for (const [value, notIdx] of notSets) {
    if (notIdx.size < 2) continue
    if (isGenericCandidate(value)) continue
    if (appearsIn(value, relTexts)) continue
    if (coveredBy(value, keywordsNorm) || coveredBy(value, nicheNorm)) continue
    if (coveredBy(value, exclusionsNorm)) continue

    // Not too common across the whole sample (R ∪ N).
    const inRel = relSets.get(value)?.size ?? 0
    const share = sampleSize > 0 ? (notIdx.size + inRel) / sampleSize : 0
    if (share > EXCLUDE_SAMPLE_SHARE_CAP) continue

    const words = value.split(' ')
    // Prefer phrases; a single word only if it is long/specific.
    if (words.length === 1 && value.length < 8) continue

    excludeScored.push({
      cand: { value, titles: titlesFor(notRelevant, notIdx) },
      score: notIdx.size + words.length * 0.5, // favor recurrence, then phrases
      words,
    })
  }
  const exclude = dedupeContained(
    excludeScored.sort((a, b) => b.score - a.score),
    MAX_EXCLUDE
  )

  return { include, exclude }
}

/**
 * Keep the strongest suggestions, dropping a shorter candidate whose words are
 * fully contained in an already-kept phrase (so "inteligencia artificial" wins
 * over a bare "inteligencia"). Also drops single stopword-ish leftovers.
 */
function dedupeContained(
  scored: { cand: AdjustmentSuggestion; score: number; words: string[] }[],
  max: number
): AdjustmentSuggestion[] {
  const kept: { cand: AdjustmentSuggestion; words: string[] }[] = []
  for (const entry of scored) {
    if (kept.length >= max) break
    if (entry.words.length === 1 && isStopword(entry.words[0])) continue
    const contained = kept.some((k) =>
      entry.words.length < k.words.length && entry.words.every((w) => k.words.includes(w))
    )
    if (contained) continue
    kept.push({ cand: entry.cand, words: entry.words })
  }
  return kept.map((k) => k.cand)
}
