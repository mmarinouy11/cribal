import { normalizeText } from '@/lib/text/normalize'

/**
 * Terms too generic to ever suggest as an include keyword or an exclusion:
 * Uruguayan places, institutional words, procurement boilerplate, project
 * stopwords. All compared normalized (lowercase, no accents). Kept here as the
 * single source of truth for the suggestion engine.
 */

// Uruguayan country / departments / main cities.
const PLACES = [
  'uruguay', 'montevideo', 'canelones', 'maldonado', 'rocha', 'treinta y tres',
  'cerro largo', 'rivera', 'artigas', 'salto', 'paysandu', 'rio negro',
  'soriano', 'colonia', 'flores', 'florida', 'durazno', 'lavalleja',
  'tacuarembo', 'san jose', 'minas', 'melo', 'mercedes', 'rivera',
]

// Institutional words that appear in buyer names, not in what is being bought.
const INSTITUTIONAL = [
  'universidad', 'ministerio', 'administracion', 'nacional', 'intendencia',
  'direccion', 'general', 'instituto', 'institucion', 'institucional',
  'servicio', 'servicios', 'empresa', 'estado', 'publico', 'publica',
  'departamental', 'municipal', 'comision', 'tecnologica', 'tecnologico',
  'tecnologia', 'republica', 'oriental', 'organismo',
]

// Procurement procedure vocabulary + RSS page metadata labels.
const PROCEDURE = [
  'compra', 'compras', 'directa', 'licitacion', 'abreviada', 'concurso',
  'precios', 'adquisicion', 'contratacion', 'suministro', 'suministros',
  'provision', 'llamado', 'adjudicacion', 'adjudicada', 'pliego',
  'excepcion', 'pregon', 'convenio', 'marco',
  // RSS page metadata ("Publicado:", "Última modificación:")
  'publicado', 'publicada', 'modificacion', 'ultima', 'fecha', 'hora',
]

// Words generic ONLY when they stand alone (fine inside a phrase, e.g.
// "renovacion de licencias", "mantenimiento de software").
const GENERIC_WHEN_ALONE = ['renovacion', 'mantenimiento']

// Spanish stopwords already used across the project.
const STOPWORDS = [
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a',
  'en', 'y', 'o', 'u', 'para', 'por', 'con', 'sin', 'sobre', 'entre', 'segun',
  'que', 'como', 'mas', 'menos', 'su', 'sus', 'se', 'es', 'son', 'ser', 'este',
  'esta', 'estos', 'estas', 'ese', 'esa', 'lo', 'le', 'les', 'no', 'si', 'ya',
  'varios', 'varias', 'otros', 'otras',
]

const STOPWORD_SET = new Set(STOPWORDS.map(normalizeText))
const GENERIC_ALWAYS = new Set([...PLACES, ...INSTITUTIONAL, ...PROCEDURE].map(normalizeText))
const GENERIC_ALONE = new Set(GENERIC_WHEN_ALONE.map(normalizeText))

/** True for a stopword (always, even inside a phrase). */
export function isStopword(word: string): boolean {
  return STOPWORD_SET.has(normalizeText(word))
}

/**
 * True when a single word is too generic to ever appear as a standalone
 * candidate, including the "generic only when alone" words.
 */
export function isGenericWord(word: string): boolean {
  const w = normalizeText(word)
  return (
    STOPWORD_SET.has(w) ||
    GENERIC_ALWAYS.has(w) ||
    GENERIC_ALONE.has(w) ||
    /^\d+$/.test(w) // pure numbers / years
  )
}

/**
 * True when a word may not sit at a phrase boundary: stopwords, always-generic
 * terms and numbers — but NOT the "generic only when alone" words, so phrases
 * like "renovacion de licencias" or "mantenimiento de software" are allowed.
 */
export function isHardGenericWord(word: string): boolean {
  const w = normalizeText(word)
  return STOPWORD_SET.has(w) || GENERIC_ALWAYS.has(w) || /^\d+$/.test(w)
}

/**
 * True for a place / institution / procedure / metadata word or a pure number —
 * terms that may never appear ANYWHERE in a phrase. Unlike isHardGenericWord it
 * ignores stopwords (fine as interior connectors) and the "generic only when
 * alone" words (fine inside a phrase).
 */
export function isAlwaysGenericWord(word: string): boolean {
  const w = normalizeText(word)
  return GENERIC_ALWAYS.has(w) || /^\d+$/.test(w)
}

/** True when a whole candidate (word or phrase) is too generic to suggest. */
export function isGenericCandidate(candidate: string): boolean {
  const words = normalizeText(candidate).split(' ').filter(Boolean)
  if (words.length === 0) return true
  if (words.length === 1) return isGenericWord(words[0])
  // A phrase is generic only if every word is generic/stopword. "Generic when
  // alone" words (renovacion, mantenimiento) do NOT make a phrase generic.
  return words.every((w) => STOPWORD_SET.has(w) || GENERIC_ALWAYS.has(w) || /^\d+$/.test(w))
}
