import { normalizeText } from '@/lib/text/normalize'
import { isAlwaysGenericWord, isGenericWord, isStopword } from './generic-terms'
import type { AdjustmentSuggestion } from './types'

// A raw suggestion as returned by the AI (before validation).
export interface RawSuggestion {
  phrase: string
  reason: string
  evidenceIds: string[]
}

// A marked tender reduced to its clean object text, for validation.
export interface MarkedObject {
  id: string
  object: string // already cleaned (getTenderObjectText)
  relevant: boolean
}

const MAX_ADD = 5
const MAX_EXCLUDE = 3
const MAX_WORDS = 4

/** Phrase-level rules shared by add and exclude. Returns the normalized phrase or null. */
function normalizeAndCheck(
  rawPhrase: string,
  buyerTokens: Set<string>,
  existingKeywords: string[]
): string | null {
  // Reject phrases that cross punctuation (e.g. "rivera. recepcion") — the raw
  // phrase must be only letters/digits/spaces.
  if (/[^\p{L}\p{N}\s]/u.test(rawPhrase)) return null

  const phrase = normalizeText(rawPhrase)
  const words = phrase.split(' ').filter(Boolean)
  if (words.length === 0 || words.length > MAX_WORDS) return null

  // No single-letter words anywhere (fragments like "robotica e inteligencia").
  if (words.some((w) => w.length < 2)) return null
  // Boundary words must not be stopwords ("de licencias", "licencias de").
  if (isStopword(words[0]) || isStopword(words[words.length - 1])) return null
  // A single-word phrase must not be generic (including "renovacion" alone).
  if (words.length === 1 && isGenericWord(words[0])) return null
  // No place/institution/procedure/metadata/buyer word anywhere (but interior
  // stopwords and "renovacion"/"mantenimiento" inside a phrase are fine).
  if (words.some((w) => isAlwaysGenericWord(w) || buyerTokens.has(w))) return null

  // Drop anything already covered by an existing keyword.
  const keywords = existingKeywords.map(normalizeText).filter(Boolean)
  if (keywords.some((k) => k === phrase || phrase.includes(k) || k.includes(phrase))) return null

  return phrase
}

function objectsById(marked: MarkedObject[]): Map<string, MarkedObject> {
  return new Map(marked.map((m) => [m.id, m]))
}

/**
 * Validate "add" suggestions: the phrase must appear (normalized substring) in
 * the object of at least one cited tender, and that tender must be marked
 * relevant. Evidence is those relevant objects.
 */
export function validateAddPhrases(
  raw: RawSuggestion[],
  marked: MarkedObject[],
  buyerTokens: Set<string>,
  existingKeywords: string[]
): AdjustmentSuggestion[] {
  const byId = objectsById(marked)
  const out: AdjustmentSuggestion[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    const phrase = normalizeAndCheck(entry.phrase, buyerTokens, existingKeywords)
    if (!phrase || seen.has(phrase)) continue

    const evidence: string[] = []
    for (const id of entry.evidenceIds) {
      const item = byId.get(id)
      if (item && item.relevant && normalizeText(item.object).includes(phrase)) {
        evidence.push(item.object)
      }
    }
    if (evidence.length === 0) continue

    seen.add(phrase)
    out.push({ phrase, reason: entry.reason, evidence: evidence.slice(0, 3) })
    if (out.length >= MAX_ADD) break
  }
  return out
}

/**
 * Validate "exclude" suggestions: the phrase must NOT appear in the object of
 * any tender marked relevant. Evidence is the cited not-relevant objects.
 */
export function validateExcludePhrases(
  raw: RawSuggestion[],
  marked: MarkedObject[],
  buyerTokens: Set<string>,
  existingKeywords: string[]
): AdjustmentSuggestion[] {
  const byId = objectsById(marked)
  const relevantObjects = marked.filter((m) => m.relevant).map((m) => normalizeText(m.object))
  const out: AdjustmentSuggestion[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    const phrase = normalizeAndCheck(entry.phrase, buyerTokens, existingKeywords)
    if (!phrase || seen.has(phrase)) continue

    // Must not appear in any relevant object.
    if (relevantObjects.some((obj) => obj.includes(phrase))) continue

    const evidence: string[] = []
    for (const id of entry.evidenceIds) {
      const item = byId.get(id)
      if (item && !item.relevant && normalizeText(item.object).includes(phrase)) {
        evidence.push(item.object)
      }
    }
    if (evidence.length === 0) continue

    seen.add(phrase)
    out.push({ phrase, reason: entry.reason, evidence: evidence.slice(0, 3) })
    if (out.length >= MAX_EXCLUDE) break
  }
  return out
}
