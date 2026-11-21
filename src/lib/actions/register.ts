'use server'

// Session-free server actions for the onboarding validation step. These run
// during registration, BEFORE a user/company exists, so they never call auth().
// fetchAndClassifyValidationSample fetches a sample from the selected feeds
// (tipo-pub/ALL — the same universe the pipeline monitors), keyword-filters it
// and classifies it with Claude in a single call.

import Parser from 'rss-parser'
import Anthropic from '@anthropic-ai/sdk'
import { normalizeFeedToFamily } from '@/lib/arce/catalog'
import { normalizeText } from '@/lib/text/normalize'
import { logAiError } from '@/lib/ai/errors'
import { getTenderObjectText } from '@/lib/tenders/object-text'
import type {
  ValidationItem,
  ClassifiedValidationItem,
  AiClassification,
  CompanyProfileInput,
  UserExample,
} from '@/lib/register/validation'

const MODEL = 'claude-sonnet-4-6'
const SAMPLE_SIZE = 25 // classify/show up to this many matches
const FALLBACK_SIZE = 15 // unfiltered items shown only when there are zero matches

// ARCE puts the object description in content:encoded, not the title. Expose
// those fields so contentSnippet/content are actually populated.
interface CustomRssItem {
  'content:encoded'?: string
  'content:encodedSnippet'?: string
}

const parser = new Parser<Record<string, never>, CustomRssItem>({
  timeout: 30000,
  customFields: { item: ['content:encoded', 'content:encodedSnippet'] },
})

// A sample item plus the full (untruncated) text used for keyword matching.
type SampleItem = ValidationItem & { contentSnippet: string; searchText: string }

/** Organismo is the text after the last "|" in an ARCE RSS title. */
function organismoFromTitle(title: string): string {
  const parts = title.split('|')
  return parts.length > 1 ? parts[parts.length - 1].trim() : ''
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A tender is "open" when its content shows no adjudication/close signals. */
function isOpenTender(content: string): boolean {
  const lower = content.toLowerCase()
  return (
    !lower.includes('adjudicad') &&
    !lower.includes('declarada desierta') &&
    !lower.includes('resolución')
  )
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/**
 * Fetch the given family feeds in parallel and return the deduplicated items.
 * ARCE only filters the RSS by family, so these feeds return the whole family;
 * the fine-grained relevance filter happens in code (keywords). Feeds that fail
 * are skipped.
 */
async function fetchSampleItems(familyFeeds: string[]): Promise<SampleItem[]> {
  const settled = await Promise.allSettled(familyFeeds.map((feed) => parser.parseURL(feed)))

  const seen = new Set<string>()
  const items: SampleItem[] = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'rejected') {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.error(`[CRIBAL][VALIDACION] Feed ${familyFeeds[i]} falló: ${message}`)
      continue
    }
    for (const raw of result.value.items ?? []) {
      const title = raw.title ?? ''
      const link = raw.link ?? ''
      const id = raw.guid ?? link
      if (!id || seen.has(id)) continue
      seen.add(id)

      // The object description lives in the content fields, never the title.
      const contentSnippet = raw.contentSnippet ?? raw['content:encodedSnippet'] ?? ''
      const content = raw.content ?? raw['content:encoded'] ?? ''
      const bestContent = contentSnippet || content

      items.push({
        id,
        title,
        object: stripHtml(bestContent).slice(0, 500),
        organismo: organismoFromTitle(title),
        url: link,
        feedSource: familyFeeds[i],
        isOpen: isOpenTender(bestContent),
        contentSnippet,
        // Full, untruncated text for keyword matching (diacritic-insensitive):
        // title + both content fields.
        searchText: normalizeText(`${title} ${contentSnippet} ${content}`),
      })
    }
  }
  return items
}

const AI_SYSTEM_PROMPT = `Clasificá estas licitaciones como relevantes o no para la empresa indicada.
Tené en cuenta las palabras clave y exclusiones de la empresa, y seguí el criterio del usuario para licitaciones similares a los ejemplos que marcó.
Para cada una, retorná SOLO un array JSON:
[{ "id": string, "relevant": boolean, "reason": string (una oración en español) }]`

const MAX_USER_EXAMPLES = 10

function parseClassifications(text: string, validIds: Set<string>): AiClassification[] {
  const parsed: unknown = JSON.parse(stripMarkdownFences(text))
  if (!Array.isArray(parsed)) throw new Error('La respuesta no es un array JSON')
  const result: AiClassification[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id : ''
    if (!id || !validIds.has(id)) continue
    result.push({
      id,
      relevant: obj.relevant === true,
      reason: typeof obj.reason === 'string' ? obj.reason : '',
    })
  }
  return result
}

/** Classify sample items in a single Claude call. Empty array on failure. */
async function classifyItems(
  items: ValidationItem[],
  companyProfile: CompanyProfileInput,
  config: { keywords: string[]; exclusions: string[]; userExamples: UserExample[] }
): Promise<AiClassification[]> {
  if (items.length === 0) return []

  const itemsBlock = items
    .map(
      (item) =>
        `- id: ${item.id}\n  Objeto: ${getTenderObjectText(item) || item.object || 'No disponible'}\n  Organismo: ${item.organismo || 'No especificado'}`
    )
    .join('\n')

  // Up to 10 of the user's own marks, balanced, so the AI follows their criterion.
  const examplesBlock = config.userExamples.slice(0, MAX_USER_EXAMPLES).length
    ? `\nEjemplos marcados por el usuario (seguí este criterio para licitaciones similares):\n${config.userExamples
        .slice(0, MAX_USER_EXAMPLES)
        .map((e) => `- ${e.relevant ? 'RELEVANTE' : 'NO RELEVANTE'}: ${e.object}`)
        .join('\n')}\n`
    : ''

  const userMessage = `Empresa: ${companyProfile.name}
Descripción: ${companyProfile.description || 'No disponible'}
Capacidades: ${companyProfile.capabilities.join(', ') || 'No disponible'}
Palabras clave: ${config.keywords.join(', ') || 'ninguna'}
Exclusiones: ${config.exclusions.join(', ') || 'ninguna'}
${examplesBlock}
Licitaciones a clasificar:
${itemsBlock}`

  const validIds = new Set(items.map((i) => i.id))

  const callModel = async (): Promise<string> => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  try {
    return parseClassifications(await callModel(), validIds)
  } catch {
    try {
      // Retry once on malformed JSON.
      return parseClassifications(await callModel(), validIds)
    } catch (error) {
      logAiError('muestra de validación del onboarding', error)
      return []
    }
  }
}

/**
 * Load a sample for the validation step and classify it with Claude in a single
 * call. ARCE's RSS endpoint ONLY filters by family (subfamily and free-text
 * params are ignored and return the whole family / the 1000 most recent items),
 * so we normalize every feed to its family form, fetch those, and do the
 * fine-grained relevance filtering in code with the company's keywords.
 */
export async function fetchAndClassifyValidationSample(
  feeds: string[],
  relevantKeywords: string[],
  companyProfile: CompanyProfileInput,
  extra: { exclusions?: string[]; userExamples?: UserExample[] } = {}
): Promise<{ items: ClassifiedValidationItem[]; usedFallback: boolean }> {
  // Diagnostic: confirm exactly which keywords reached the server action.
  console.log(
    '[CRIBAL][VALIDACION] Keywords recibidos:',
    relevantKeywords.length,
    '(mostrando primeros 10):',
    JSON.stringify(relevantKeywords.slice(0, 10))
  )

  // 1. Normalize to family-level feeds only (dedupe, drop non-family feeds).
  const familyFeeds = [
    ...new Set(feeds.map(normalizeFeedToFamily).filter((f) => f.includes('/familia/'))),
  ]
  if (familyFeeds.length === 0) return { items: [], usedFallback: false }

  // 2-4. Fetch, normalize and deduplicate.
  const allItems = await fetchSampleItems(familyFeeds)

  // Diagnostic: confirm the content fields are actually read from the RSS.
  if (allItems.length > 0) {
    const first = allItems[0]
    console.log(
      `[CRIBAL][VALIDACION] Primer item — title: "${first.title}" | contentSnippet: "${first.contentSnippet.slice(0, 120)}" | object: "${first.object}"`
    )
  }

  // 5. Apply the company's keyword filter in code (the real fine-grained filter).
  // Match against the full normalized text: title + contentSnippet + content.
  const keywordsToMatch = relevantKeywords.map(normalizeText).filter(Boolean)
  const filtered =
    keywordsToMatch.length > 0
      ? allItems.filter((item) => keywordsToMatch.some((kw) => item.searchText.includes(kw)))
      : []

  // Only fall back to an unfiltered sample when there are ZERO matches — even 1
  // or 2 real matches are far more useful than 25 unrelated items.
  const usedFallback = filtered.length === 0
  const sample = usedFallback ? allItems.slice(0, FALLBACK_SIZE) : filtered.slice(0, SAMPLE_SIZE)

  // 6. Log.
  const familyNumbers = familyFeeds.map((f) => f.match(/\/familia\/(\d+)/)?.[1] ?? '?')
  console.log(
    `[CRIBAL][VALIDACION] Familias consultadas: [${familyNumbers.join(', ')}] | Total items: ${allItems.length} | Tras filtro keywords: ${filtered.length}`
  )
  console.log(
    `[CRIBAL][VALIDACION] Matches: ${filtered.length} | Fallback: ${usedFallback} | Muestra: ${sample.length} items`
  )

  // 7. Classify with Claude, passing keywords/exclusions and the user's own
  // marked examples so it follows the user's criterion.
  const classifications = await classifyItems(sample, companyProfile, {
    keywords: relevantKeywords,
    exclusions: extra.exclusions ?? [],
    userExamples: extra.userExamples ?? [],
  })
  const byId = new Map(classifications.map((c) => [c.id, c]))

  const items: ClassifiedValidationItem[] = sample.map((item) => {
    const c = byId.get(item.id)
    // Drop the internal-only fields (contentSnippet/searchText) from the payload.
    const { contentSnippet: _cs, searchText: _st, ...base } = item
    return {
      ...base,
      aiRelevant: c?.relevant ?? false,
      aiReason: c?.reason ?? '',
    }
  })

  return { items, usedFallback }
}
