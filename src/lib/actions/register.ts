'use server'

// Session-free server actions for the onboarding validation step. These run
// during registration, BEFORE a user/company exists, so they never call auth().
// fetchAndClassifyValidationSample fetches a sample from the selected feeds
// (tipo-pub/ALL — the same universe the pipeline monitors), keyword-filters it
// and classifies it with Claude in a single call.

import Parser from 'rss-parser'
import Anthropic from '@anthropic-ai/sdk'
import { textFeedUrl } from '@/lib/arce/catalog'
import type {
  ValidationItem,
  ClassifiedValidationItem,
  AiClassification,
  CompanyProfileInput,
} from '@/lib/register/validation'

const MODEL = 'claude-sonnet-4-6'
const SAMPLE_SIZE = 25 // classify/show up to this many (before keyword filter)
const MIN_FILTERED = 3 // below this, fall back to the unfiltered sample

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
 * Fetch every feed in parallel and return the deduplicated items, most recent
 * first. Uses the feeds as-is (tipo-pub/ALL — the same universe the pipeline
 * monitors: open, closed and adjudicated), which gives a much larger and more
 * representative sample than adjudications alone, especially for niche
 * industries. Feeds that fail are skipped.
 */
async function fetchSampleItems(feeds: string[]): Promise<ValidationItem[]> {
  const settled = await Promise.all(
    feeds.map(async (feed): Promise<ValidationItem[]> => {
      try {
        const parsed = await parser.parseURL(feed)
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

const AI_SYSTEM_PROMPT = `Clasificá estas licitaciones como relevantes o no para la empresa indicada.
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
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][VALIDACION] Clasificación IA falló: ${message}`)
      return []
    }
  }
}

/**
 * Load a sample for the validation step and classify it with Claude in a single
 * call. ARCE's RSS endpoint ignores family/subfamily params (a subfamily URL
 * returns the same ~1000 unrelated items as the whole family), so only
 * `/texto/{keyword}` feeds actually filter by content. We therefore build the
 * sample from text-search feeds derived from the company's relevant keywords,
 * guaranteeing the items actually contain what the company configured. Only when
 * there are no keywords do we fall back to the configured feeds.
 */
export async function fetchAndClassifyValidationSample(
  feeds: string[],
  additionalKeywords: string[],
  companyProfile: CompanyProfileInput
): Promise<{ items: ClassifiedValidationItem[]; usedFallback: boolean }> {
  // Build text-search feeds from the top (most specific = longest) keywords.
  const topKeywords = additionalKeywords
    .filter((kw) => kw.length > 4) // skip very short terms
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)

  const textFeeds = topKeywords.map((kw) => textFeedUrl(kw))
  const sampleFeeds = textFeeds.length > 0 ? textFeeds : feeds

  console.log('[CRIBAL][VALIDACION] Keywords para muestra:', JSON.stringify(topKeywords))
  console.log('[CRIBAL][VALIDACION] Feeds de texto:', JSON.stringify(sampleFeeds))

  if (sampleFeeds.length === 0) return { items: [], usedFallback: false }

  const allItems = await fetchSampleItems(sampleFeeds)

  // Pre-filter only by the company-specific keywords Claude inferred — NOT the
  // pipeline's TI base list, which would wipe out non-TI companies (bicicletas,
  // obras, alimentos, etc.). With no company keywords, skip filtering entirely
  // and let Claude classify the raw sample.
  const keywordsToMatch = additionalKeywords.map((k) => k.toLowerCase()).filter(Boolean)

  let sample: ValidationItem[]
  let usedFallback: boolean
  if (keywordsToMatch.length === 0) {
    sample = allItems.slice(0, SAMPLE_SIZE)
    usedFallback = false
  } else {
    const filtered = allItems.filter((item) => {
      const text = `${item.title} ${item.object}`.toLowerCase()
      return keywordsToMatch.some((kw) => text.includes(kw))
    })
    // A small filtered set is still valid; only fall back when it's very thin.
    usedFallback = filtered.length < MIN_FILTERED
    sample = (usedFallback ? allItems : filtered).slice(0, SAMPLE_SIZE)
  }

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
