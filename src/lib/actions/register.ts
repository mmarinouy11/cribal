'use server'

// Session-free server actions for the onboarding validation step. These run
// during registration, BEFORE a user/company exists, so they never call auth().
// fetchAndClassifyValidationSample fetches a sample from the selected feeds
// (tipo-pub/ALL — the same universe the pipeline monitors), keyword-filters it
// and classifies it with Claude in a single call.

import Parser from 'rss-parser'
import type Anthropic from '@anthropic-ai/sdk'
import { normalizeFeedToFamily } from '@/lib/arce/catalog'
import { normalizeText } from '@/lib/text/normalize'
import { batchClassify, type IdentifiedResult } from '@/lib/ai/batch-classify'
import { getTenderObjectText } from '@/lib/tenders/object-text'
import { fetchFeedWithRetries, type RssItem } from '@/lib/pipeline/fetcher'
import { getCachedFeedItems } from '@/lib/pipeline/global-ingestion'
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
// Recency window for the sample's date stage. Generous on purpose: ARCE feeds
// carry recent items anyway, so this mainly drops genuinely stale entries while
// keeping recently-closed tenders (useful for validation). Undated items pass.
const SAMPLE_DATE_WINDOW_DAYS = 90

// Outcome of loading the sample, so the UI can tell "ARCE did not respond" from
// "nothing matched" instead of always showing an empty list.
export type ValidationSampleStatus = 'ok' | 'empty' | 'arce_error'

export interface ValidationSampleResult {
  status: ValidationSampleStatus
  items: ClassifiedValidationItem[]
  usedFallback: boolean // broad (unfiltered) sample shown because nothing matched the keywords
  source: 'arce' | 'db'
  fromCache: boolean // served from the global tables after an ARCE read failure
  message?: string // Spanish message for the empty / error / fallback cases
}

// A raw feed item, from a live ARCE read or from the global cache.
interface RawFeedItem {
  title: string
  link: string
  guid: string
  pubDate: string
  contentSnippet: string
  content: string
  feedSource: string
}

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

interface FeedFetchResult {
  items: RawFeedItem[]
  feedsTotal: number
  feedsFailed: number
  allFailed: boolean
}

/**
 * Fetch the given family feeds in parallel, each with the SAME retries/backoff
 * as the pipeline (via fetchFeedWithRetries, proxy-aware), and return the
 * deduplicated raw items plus per-feed stats. ARCE only filters the RSS by
 * family, so these feeds return the whole family; the fine-grained relevance
 * filter happens later in code. A feed that still fails after retries is counted
 * so the caller can tell a transient ARCE failure from a genuinely empty read.
 */
async function fetchFamilyFeeds(familyFeeds: string[]): Promise<FeedFetchResult> {
  const results = await Promise.all(
    familyFeeds.map(async (feed) => {
      const { xml, attempts, error } = await fetchFeedWithRetries(feed)
      if (xml === null) {
        console.error(`[CRIBAL][SAMPLE] Feed falló tras ${attempts} intento(s): ${feed} — ${error}`)
        return { feed, ok: false as const, items: [] as RawFeedItem[] }
      }
      try {
        const parsed = await parser.parseString(xml)
        const items: RawFeedItem[] = (parsed.items ?? []).map((raw) => ({
          title: raw.title ?? '',
          link: raw.link ?? '',
          guid: raw.guid ?? raw.link ?? '',
          pubDate: raw.pubDate ?? '',
          contentSnippet: raw.contentSnippet ?? raw['content:encodedSnippet'] ?? '',
          content: raw.content ?? raw['content:encoded'] ?? '',
          feedSource: feed,
        }))
        return { feed, ok: true as const, items }
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError)
        console.error(`[CRIBAL][SAMPLE] Parseo falló para ${feed}: ${message}`)
        return { feed, ok: false as const, items: [] as RawFeedItem[] }
      }
    })
  )

  const seen = new Set<string>()
  const items: RawFeedItem[] = []
  let feedsFailed = 0
  for (const result of results) {
    if (!result.ok) {
      feedsFailed++
      continue
    }
    for (const raw of result.items) {
      if (!raw.guid || seen.has(raw.guid)) continue
      seen.add(raw.guid)
      items.push(raw)
    }
  }

  return {
    items,
    feedsTotal: familyFeeds.length,
    feedsFailed,
    allFailed: familyFeeds.length > 0 && feedsFailed === familyFeeds.length,
  }
}

/** Raw items from the global feed cache (last successful read) for these feeds. */
async function loadFromCache(familyFeeds: string[]): Promise<RawFeedItem[]> {
  const seen = new Set<string>()
  const items: RawFeedItem[] = []
  for (const feed of familyFeeds) {
    const cached = await getCachedFeedItems(feed)
    if (!cached) continue
    for (const raw of cached as RssItem[]) {
      const guid = raw.guid || raw.link
      if (!guid || seen.has(guid)) continue
      seen.add(guid)
      items.push({
        title: raw.title,
        link: raw.link,
        guid,
        pubDate: raw.pubDate,
        contentSnippet: raw.contentSnippet,
        content: raw.content,
        feedSource: feed,
      })
    }
  }
  return items
}

/** Keep items published within the recency window; undated items are kept. */
function withinRecencyWindow(raw: RawFeedItem, cutoff: Date): boolean {
  if (!raw.pubDate) return true
  const date = new Date(raw.pubDate)
  if (Number.isNaN(date.getTime())) return true
  return date >= cutoff
}

/** Build a sample item (with the internal matching fields) from a raw feed item. */
function toSampleItem(raw: RawFeedItem): SampleItem {
  const bestContent = raw.contentSnippet || raw.content
  return {
    id: raw.guid,
    title: raw.title,
    object: stripHtml(bestContent).slice(0, 500),
    organismo: organismoFromTitle(raw.title),
    url: raw.link,
    feedSource: raw.feedSource,
    isOpen: isOpenTender(bestContent),
    contentSnippet: raw.contentSnippet,
    // Full, untruncated text for keyword matching (diacritic-insensitive).
    searchText: normalizeText(`${raw.title} ${raw.contentSnippet} ${raw.content}`),
  }
}

const MAX_REASON_CHARS = 120

const AI_SYSTEM_PROMPT = `Clasificá estas licitaciones como relevantes o no para la empresa indicada.
Tené en cuenta las palabras clave y exclusiones de la empresa, y seguí el criterio del usuario para licitaciones similares a los ejemplos que marcó.
Usá la herramienta \`classify_sample\` para devolver una clasificación por licitación, copiando cada "id" exactamente. "reason" es una oración en español de máximo ${MAX_REASON_CHARS} caracteres.`

const MAX_USER_EXAMPLES = 10

const SAMPLE_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          relevant: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['id', 'relevant', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['classifications'],
  additionalProperties: false,
}

function extractSampleClassifications(input: unknown): IdentifiedResult<AiClassification>[] {
  if (!input || typeof input !== 'object') return []
  const arr = (input as { classifications?: unknown }).classifications
  if (!Array.isArray(arr)) return []
  const out: IdentifiedResult<AiClassification>[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id) continue
    out.push({
      id,
      result: {
        id,
        relevant: o.relevant === true,
        reason: typeof o.reason === 'string' ? o.reason.slice(0, MAX_REASON_CHARS) : '',
      },
    })
  }
  return out
}

/**
 * Classify sample items with Claude using small tool-based batches run in
 * parallel. Returns the classification per id plus the ids that could not be
 * classified (truncated / unparseable), so the UI can show them as pending.
 */
async function classifyItems(
  items: ValidationItem[],
  companyProfile: CompanyProfileInput,
  config: { keywords: string[]; exclusions: string[]; userExamples: UserExample[] }
): Promise<{ byId: Map<string, AiClassification>; unclassifiedIds: string[] }> {
  if (items.length === 0) return { byId: new Map(), unclassifiedIds: [] }

  // Up to 10 of the user's own marks, balanced, so the AI follows their criterion.
  const examplesBlock = config.userExamples.slice(0, MAX_USER_EXAMPLES).length
    ? `\nEjemplos marcados por el usuario (seguí este criterio para licitaciones similares):\n${config.userExamples
        .slice(0, MAX_USER_EXAMPLES)
        .map((e) => `- ${e.relevant ? 'RELEVANTE' : 'NO RELEVANTE'}: ${e.object}`)
        .join('\n')}\n`
    : ''

  const buildUserMessage = (batch: ValidationItem[]): string => {
    const itemsBlock = batch
      .map(
        (item) =>
          `- id: ${item.id}\n  Objeto: ${getTenderObjectText(item) || item.object || 'No disponible'}\n  Organismo: ${item.organismo || 'No especificado'}`
      )
      .join('\n')
    return `Empresa: ${companyProfile.name}
Descripción: ${companyProfile.description || 'No disponible'}
Capacidades: ${companyProfile.capabilities.join(', ') || 'No disponible'}
Palabras clave: ${config.keywords.join(', ') || 'ninguna'}
Exclusiones: ${config.exclusions.join(', ') || 'ninguna'}
${examplesBlock}
Licitaciones a clasificar:
${itemsBlock}`
  }

  return batchClassify<ValidationItem, AiClassification>({
    context: 'muestra de validación del onboarding',
    model: MODEL,
    system: AI_SYSTEM_PROMPT,
    items,
    idOf: (item) => item.id,
    buildUserMessage,
    tool: {
      name: 'classify_sample',
      description: 'Return the relevance classification for every tender in the batch.',
      inputSchema: SAMPLE_TOOL_SCHEMA,
    },
    extractResults: extractSampleClassifications,
  })
}

/**
 * Re-classify a specific set of sample items — the UI's "Reintentar
 * clasificación" button for items the first pass left unclassified. Returns a
 * plain, serializable payload the client merges into its state.
 */
export async function reclassifyValidationItems(
  items: ValidationItem[],
  companyProfile: CompanyProfileInput,
  extra: { keywords: string[]; exclusions?: string[]; userExamples?: UserExample[] }
): Promise<{ classifications: AiClassification[]; unclassifiedIds: string[] }> {
  if (items.length === 0) return { classifications: [], unclassifiedIds: [] }
  try {
    const { byId, unclassifiedIds } = await classifyItems(items, companyProfile, {
      keywords: extra.keywords,
      exclusions: extra.exclusions ?? [],
      userExamples: extra.userExamples ?? [],
    })
    return { classifications: [...byId.values()], unclassifiedIds }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][SAMPLE] reintento de clasificación falló: ${message}`)
    return { classifications: [], unclassifiedIds: items.map((i) => i.id) }
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
): Promise<ValidationSampleResult> {
  // 1. Normalize to family-level feeds only (dedupe, drop non-family feeds).
  const familyFeeds = [
    ...new Set(feeds.map(normalizeFeedToFamily).filter((f) => f.includes('/familia/'))),
  ]
  if (familyFeeds.length === 0) {
    return {
      status: 'empty',
      items: [],
      usedFallback: false,
      source: 'arce',
      fromCache: false,
      message: 'No hay categorías configuradas para buscar licitaciones.',
    }
  }

  const familyNumbers = familyFeeds.map((f) => f.match(/\/familia\/(\d+)/)?.[1] ?? '?')

  // 2. Read the feeds from ARCE (with pipeline retries). On a TOTAL failure, fall
  // back to the last successful read saved in the global tables.
  const fetchResult = await fetchFamilyFeeds(familyFeeds)
  let rawItems = fetchResult.items
  let source: 'arce' | 'db' = 'arce'
  let fromCache = false

  if (fetchResult.allFailed) {
    const cached = await loadFromCache(familyFeeds)
    if (cached.length === 0) {
      // ARCE is unreachable and nothing is saved — this is an error, NOT "no
      // results". The UI must offer a retry, not an empty "no matches" list.
      console.log(
        `[CRIBAL][SAMPLE] fuente=arce familias=[${familyNumbers.join(', ')}] feeds=${fetchResult.feedsTotal} fallidos=${fetchResult.feedsFailed} — ARCE no respondió y sin respaldo en DB`
      )
      return {
        status: 'arce_error',
        items: [],
        usedFallback: false,
        source: 'arce',
        fromCache: false,
        message: 'No pudimos leer ARCE en este momento.',
      }
    }
    rawItems = cached
    source = 'db'
    fromCache = true
  }

  // 3. Staged logs.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - SAMPLE_DATE_WINDOW_DAYS)
  const afterDate = rawItems.filter((raw) => withinRecencyWindow(raw, cutoff))
  const allItems = afterDate.map(toSampleItem)

  const keywordsToMatch = relevantKeywords.map(normalizeText).filter(Boolean)
  const exclusionsToMatch = (extra.exclusions ?? []).map(normalizeText).filter(Boolean)
  const filtered =
    keywordsToMatch.length > 0
      ? allItems.filter(
          (item) =>
            keywordsToMatch.some((kw) => item.searchText.includes(kw)) &&
            !exclusionsToMatch.some((ex) => item.searchText.includes(ex))
        )
      : []

  // Only fall back to an unfiltered sample when there are ZERO matches — even 1
  // or 2 real matches are far more useful than 25 unrelated items.
  const usedFallback = filtered.length === 0
  const sample = usedFallback ? allItems.slice(0, FALLBACK_SIZE) : filtered.slice(0, SAMPLE_SIZE)

  console.log(
    `[CRIBAL][SAMPLE] fuente=${source}${fromCache ? ' (respaldo)' : ''} familias=[${familyNumbers.join(', ')}] crudos=${rawItems.length} tras_fecha=${afterDate.length} tras_keywords_exclusiones=${filtered.length} a_clasificar=${sample.length}`
  )

  // 4. Truly empty read (feeds answered but had nothing recent to show): this is
  // "no results", with a message that names the stage that discarded everything.
  if (sample.length === 0) {
    const message =
      rawItems.length === 0
        ? 'No hay licitaciones recientes en estas categorías. Probá agregar más categorías.'
        : 'No hay licitaciones recientes en estas categorías dentro del período analizado.'
    return { status: 'empty', items: [], usedFallback: false, source, fromCache, message }
  }

  // 5. Classify with Claude, passing keywords/exclusions and the user's own
  // marked examples so it follows the user's criterion. A fatal AI failure
  // leaves every item unclassified rather than crashing the sample.
  let byId = new Map<string, AiClassification>()
  let unclassifiedIds: string[] = sample.map((i) => i.id)
  try {
    const outcome = await classifyItems(sample, companyProfile, {
      keywords: relevantKeywords,
      exclusions: extra.exclusions ?? [],
      userExamples: extra.userExamples ?? [],
    })
    byId = outcome.byId
    unclassifiedIds = outcome.unclassifiedIds
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][SAMPLE] clasificación falló: ${message}`)
  }
  const unclassified = new Set(unclassifiedIds)
  console.log(
    `[CRIBAL][SAMPLE] clasificadas=${sample.length - unclassified.size} sin_clasificar=${unclassified.size}`
  )

  const items: ClassifiedValidationItem[] = sample.map((item) => {
    const c = byId.get(item.id)
    // Drop the internal-only fields (contentSnippet/searchText) from the payload.
    const { contentSnippet: _cs, searchText: _st, ...base } = item
    const isUnclassified = unclassified.has(item.id) || !c
    return {
      ...base,
      aiRelevant: c?.relevant ?? false,
      aiReason: c?.reason ?? '',
      aiStatus: isUnclassified ? 'unclassified' : 'classified',
    }
  })

  // The keyword filter matched nothing but there ARE recent tenders — show the
  // broad sample with a message pointing at the keywords stage.
  const message = usedFallback
    ? 'Ninguna licitación reciente coincide con tus palabras clave; probá con términos más amplios.'
    : undefined

  return { status: 'ok', items, usedFallback, source, fromCache, message }
}
