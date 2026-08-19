'use server'

// Session-free server actions for the onboarding validation step. These run
// during registration, BEFORE a user/company exists, so they never call auth().
// fetchAndClassifyValidationSample fetches the historical sample, keyword-filters
// it and classifies it with Claude in a single call.

import Parser from 'rss-parser'
import Anthropic from '@anthropic-ai/sdk'
import { feedToAdjudicationUrl } from '@/lib/arce/catalog'
import { BASE_RELEVANT_KEYWORDS } from '@/lib/pipeline/keywordFilter'
import type {
  ValidationItem,
  ClassifiedValidationItem,
  AiClassification,
  CompanyProfileInput,
} from '@/lib/register/validation'

const MODEL = 'claude-sonnet-4-6'
const SAMPLE_SIZE = 15
const MIN_FILTERED = 5 // below this, fall back to the unfiltered sample

const parser = new Parser({ timeout: 30000 })

/** Organismo is the text after the last "|" in an ARCE RSS title. */
function organismoFromTitle(title: string): string {
  const parts = title.split('|')
  return parts.length > 1 ? parts[parts.length - 1].trim() : ''
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/**
 * Fetch every feed's adjudications (ADJ) variant in parallel and return the
 * deduplicated items, most recent first. Feeds that fail are skipped.
 */
async function fetchSampleItems(feeds: string[]): Promise<ValidationItem[]> {
  const settled = await Promise.all(
    feeds.map(async (feed): Promise<ValidationItem[]> => {
      try {
        const parsed = await parser.parseURL(feedToAdjudicationUrl(feed))
        return (parsed.items ?? []).map((raw) => {
          const title = raw.title ?? ''
          const link = raw.link ?? ''
          return {
            id: raw.guid ?? link,
            title,
            object: (raw.contentSnippet ?? raw.content ?? '').trim(),
            organismo: organismoFromTitle(title),
            url: link,
            feedSource: feed,
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[CRIBAL][VALIDACION] Feed ${feed} falló: ${message}`)
        return []
      }
    })
  )

  const seen = new Set<string>()
  const items: ValidationItem[] = []
  for (const feedItems of settled) {
    for (const item of feedItems) {
      if (!item.id || seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }
  return items
}

const AI_SYSTEM_PROMPT = `Clasificá estas licitaciones adjudicadas como relevantes o no para la empresa indicada.
Para cada una, retorná SOLO un array JSON:
[{ "id": string, "relevant": boolean, "reason": string (una oración en español) }]`

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
  companyProfile: CompanyProfileInput
): Promise<AiClassification[]> {
  if (items.length === 0) return []

  const itemsBlock = items
    .map(
      (item) =>
        `- id: ${item.id}\n  Título: ${item.title}\n  Objeto: ${item.object || 'No disponible'}\n  Organismo: ${item.organismo || 'No especificado'}`
    )
    .join('\n')

  const userMessage = `Empresa: ${companyProfile.name}
Descripción: ${companyProfile.description || 'No disponible'}
Capacidades: ${companyProfile.capabilities.join(', ') || 'No disponible'}

Licitaciones adjudicadas a clasificar:
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
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][VALIDACION] Clasificación IA falló: ${message}`)
      return []
    }
  }
}

/**
 * Load a historical sample for the selected categories, pre-filter it by the
 * company's relevant keywords (base list + custom), and classify it with Claude
 * in a single call. When the keyword filter yields fewer than MIN_FILTERED
 * items it falls back to the unfiltered sample and flags `usedFallback`.
 */
export async function fetchAndClassifyValidationSample(
  feeds: string[],
  additionalKeywords: string[],
  companyProfile: CompanyProfileInput
): Promise<{ items: ClassifiedValidationItem[]; usedFallback: boolean }> {
  if (feeds.length === 0) return { items: [], usedFallback: false }

  const allItems = await fetchSampleItems(feeds)

  // Keyword pre-filter — same logic as filterByKeywords in the pipeline.
  const keywordsToMatch = [...BASE_RELEVANT_KEYWORDS, ...additionalKeywords].map((k) =>
    k.toLowerCase()
  )
  const filtered = allItems.filter((item) => {
    const text = `${item.title} ${item.object}`.toLowerCase()
    return keywordsToMatch.some((kw) => text.includes(kw))
  })

  const usedFallback = filtered.length < MIN_FILTERED
  const sample = (usedFallback ? allItems : filtered).slice(0, SAMPLE_SIZE)

  const classifications = await classifyItems(sample, companyProfile)
  const byId = new Map(classifications.map((c) => [c.id, c]))

  const items: ClassifiedValidationItem[] = sample.map((item) => {
    const c = byId.get(item.id)
    return {
      ...item,
      aiRelevant: c?.relevant ?? false,
      aiReason: c?.reason ?? '',
    }
  })

  return { items, usedFallback }
}
