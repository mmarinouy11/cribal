'use server'

// Session-free server actions for the onboarding validation step. These run
// during registration, BEFORE a user/company exists, so they never call auth().
// fetchValidationSample uses no Claude tokens; validateSampleWithAI makes a
// single Claude call on demand.

import Parser from 'rss-parser'
import Anthropic from '@anthropic-ai/sdk'
import { feedToAdjudicationUrl } from '@/lib/arce/catalog'
import type {
  ValidationItem,
  AiClassification,
  CompanyProfileInput,
} from '@/lib/register/validation'

const MODEL = 'claude-sonnet-4-6'
const SAMPLE_SIZE = 15
const FETCH_DELAY_MS = 300 // stagger feed fetches so ARCE is not hit all at once

const parser = new Parser({ timeout: 30000 })

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
 * Load a sample of recently adjudicated tenders for the given active-call feeds.
 * Each feed is mapped to its adjudications (ADJ) variant, fetched with a small
 * stagger, then normalized, deduplicated by guid and trimmed to the most recent.
 */
export async function fetchValidationSample(feeds: string[]): Promise<ValidationItem[]> {
  if (feeds.length === 0) return []

  const settled = await Promise.allSettled(
    feeds.map(async (feed, index): Promise<{ feed: string; items: ValidationItem[] }> => {
      await sleep(index * FETCH_DELAY_MS)
      const adjUrl = feedToAdjudicationUrl(feed)
      const parsed = await parser.parseURL(adjUrl)
      const items: ValidationItem[] = (parsed.items ?? []).map((raw) => {
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
      return { feed, items }
    })
  )

  const seen = new Set<string>()
  const collected: { item: ValidationItem; pubDate: number }[] = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'rejected') {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.error(`[CRIBAL][VALIDACION] Feed ${feeds[i]} falló: ${message}`)
      continue
    }
    // rss-parser exposes isoDate; fall back to pubDate for ordering.
    const parsedForDate = result.value.items
    for (let j = 0; j < parsedForDate.length; j++) {
      const item = parsedForDate[j]
      if (!item.id || seen.has(item.id)) continue
      seen.add(item.id)
      // Preserve feed order as a stable proxy when no date is available.
      collected.push({ item, pubDate: -(i * 1000 + j) })
    }
  }

  return collected
    .sort((a, b) => b.pubDate - a.pubDate)
    .slice(0, SAMPLE_SIZE)
    .map((c) => c.item)
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

/**
 * Classify the given sample items as relevant/not for the company in a single
 * Claude call. Returns one classification per item Claude recognized; the caller
 * pre-fills the marks and can still override them.
 */
export async function validateSampleWithAI(
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
    // Retry once on malformed JSON.
    return parseClassifications(await callModel(), validIds)
  }
}
