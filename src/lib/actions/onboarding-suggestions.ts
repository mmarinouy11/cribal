'use server'

// Session-free server action for the onboarding "Analizar mis marcaciones"
// step: a single economical Claude call proposes keyword/exclusion phrases from
// the tenders the user marked, and code then validates every phrase before it
// reaches the UI. Runs during registration, before a user/company exists.

import Anthropic from '@anthropic-ai/sdk'
import { logAiError } from '@/lib/ai/errors'
import { getTenderObjectText, buyerTokensFromTitles } from '@/lib/tenders/object-text'
import {
  validateAddPhrases,
  validateExcludePhrases,
  type RawSuggestion,
  type MarkedObject,
} from '@/lib/suggestions/validate'
import type { AdjustmentSuggestions, MarkedTenderInput, SuggestResult } from '@/lib/suggestions/types'

const MODEL = 'claude-sonnet-4-6'
const MAX_PER_SIDE = 15 // up to 15 relevant + 15 not relevant
const OBJECT_CHARS = 300

export interface SuggestionCompanyInput {
  name: string
  description: string
  keywords: string[]
  exclusions: string[]
}

const SYSTEM_PROMPT = `Ayudás a afinar los filtros de una empresa que busca licitaciones del Estado uruguayo (ARCE).

A partir de licitaciones que el usuario marcó como relevantes o no relevantes, proponé frases que describan QUÉ se compra (el producto o servicio), nunca el comprador, la institución, el tipo de procedimiento, fechas, lugares ni texto de la página.

Reglas:
- Frases de 1 a 4 palabras, en minúsculas, sin puntuación.
- "add": hasta 5 frases a AGREGAR como palabras clave. Cada una debe estar sustentada por al menos 1 licitación marcada relevante (mejor 2). Incluí los ids de esas licitaciones como evidencia.
- "exclude": hasta 3 frases a EXCLUIR, solo si NO aparecen en ninguna licitación relevante y describen claramente un tema no deseado. Incluí los ids de evidencia.
- Preferí devolver menos frases, o ninguna, antes que sugerencias dudosas.

Respondé SOLO con un objeto JSON válido, sin markdown ni texto extra:
{ "add": [{ "phrase": string, "reason": string (una oración en español), "evidenceIds": string[] }], "exclude": [{ "phrase": string, "reason": string, "evidenceIds": string[] }] }`

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function parseRawSuggestions(text: string): { add: RawSuggestion[]; exclude: RawSuggestion[] } {
  const parsed: unknown = JSON.parse(stripMarkdownFences(text))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Respuesta de IA no es un objeto')
  const obj = parsed as Record<string, unknown>
  return { add: toRawList(obj.add), exclude: toRawList(obj.exclude) }
}

function toRawList(value: unknown): RawSuggestion[] {
  if (!Array.isArray(value)) return []
  const out: RawSuggestion[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const phrase = typeof e.phrase === 'string' ? e.phrase : ''
    if (!phrase) continue
    out.push({
      phrase,
      reason: typeof e.reason === 'string' ? e.reason : '',
      evidenceIds: Array.isArray(e.evidenceIds)
        ? e.evidenceIds.filter((id): id is string => typeof id === 'string')
        : [],
    })
  }
  return out
}

/** Produce validated adjustment suggestions from the user's marks (one AI call). */
export async function suggestAdjustmentsFromMarks(
  company: SuggestionCompanyInput,
  marked: MarkedTenderInput[]
): Promise<SuggestResult> {
  // Reduce to clean object text; only items with a usable object are evidence.
  const withObject: MarkedObject[] = marked
    .map((m) => ({
      id: m.id,
      object: getTenderObjectText({ title: m.title, object: m.object }),
      relevant: m.relevant,
    }))
    .filter((m) => m.object.length > 0)

  const relevant = withObject.filter((m) => m.relevant).slice(0, MAX_PER_SIDE)
  const notRelevant = withObject.filter((m) => !m.relevant).slice(0, MAX_PER_SIDE)
  if (relevant.length === 0 && notRelevant.length === 0) return { status: 'empty' }

  const buyerTokens = buyerTokensFromTitles(marked.map((m) => m.title))

  const renderBlock = (items: MarkedObject[]): string =>
    items.map((m) => `- id: ${m.id} | objeto: ${m.object.slice(0, OBJECT_CHARS)}`).join('\n')

  const userMessage = `Empresa: ${company.name}
Descripción: ${company.description || 'No disponible'}
Palabras clave actuales: ${company.keywords.join(', ') || 'ninguna'}
Exclusiones actuales: ${company.exclusions.join(', ') || 'ninguna'}

Licitaciones marcadas RELEVANTES:
${renderBlock(relevant) || '(ninguna)'}

Licitaciones marcadas NO RELEVANTES:
${renderBlock(notRelevant) || '(ninguna)'}`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    console.log(
      `[CRIBAL][AI] Sugerencias de ajuste — tokens entrada=${response.usage.input_tokens} salida=${response.usage.output_tokens}`
    )

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    const raw = parseRawSuggestions(text)
    const suggestions: AdjustmentSuggestions = {
      add: validateAddPhrases(raw.add, withObject, buyerTokens, company.keywords),
      exclude: validateExcludePhrases(raw.exclude, withObject, buyerTokens, company.keywords),
    }
    if (suggestions.add.length === 0 && suggestions.exclude.length === 0) return { status: 'empty' }
    return { status: 'ok', suggestions }
  } catch (error) {
    logAiError('sugerencias de ajuste del onboarding', error)
    return { status: 'error' }
  }
}
