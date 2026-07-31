import Parser from 'rss-parser'
import Anthropic from '@anthropic-ai/sdk'
import type { MarketAnalysis, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { fetchArceHtml, delay } from './fetch-arce'
import { parseAdjudicationDetail, type TenderItem } from './arce-parser'

const RSS_BASE = 'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ADJ'
const DETAIL_BASE = 'https://www.comprasestatales.gub.uy/consultas/detalle/id'
const MODEL = 'claude-sonnet-4-6'
const MAX_DETAILS = 10
const USER_AGENT = 'Mozilla/5.0 (compatible; Cribal/1.0)'

export interface AdjudicationRecord {
  tenderId: string
  organismo: string
  objeto: string
  adjudicatedTo: string
  amount: number | null
  currency: string
  date: string | null
  url: string
}

export interface CompetitorProfile {
  name: string
  rut: string
  timesParticipated: number
  timesWon: number
  winRate: number
  totalAmountWon: number
  organisms: string[]
  lastSeen: string | null
}

export interface PriceIntelligence {
  sampleSize: number
  currency: string
  unitPrices: number[]
  min: number
  max: number
  average: number
  median: number
  suggestedRange: { low: number; high: number }
  lastUpdated: string
}

const STOPWORDS = new Set([
  'para',
  'con',
  'del',
  'los',
  'las',
  'por',
  'una',
  'que',
  'servicio',
  'servicios',
  'llamado',
  'compra',
  'licitacion',
  'licitación',
  'obras',
  'the',
])

function extractKeywords(title: string, description: string): string[] {
  const words = `${title} ${description}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w))

  const seen = new Set<string>()
  const unique: string[] = []
  for (const word of words) {
    if (seen.has(word)) continue
    seen.add(word)
    unique.push(word)
    if (unique.length >= 5) break
  }
  return unique
}

function tenderItemsFromJson(value: Prisma.JsonValue | null): TenderItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item)
  ) as unknown as TenderItem[]
}

function extractTenderId(url: string): string | null {
  const match = url.match(/\/id\/(\d+)/)
  return match ? match[1] : null
}

function organismoFromTitle(title: string): string {
  const parts = title.split('|')
  return parts.length > 1 ? parts[parts.length - 1].trim() : ''
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

interface AdjudicationLead {
  tenderId: string
  url: string
  feedTitle: string
}

interface CollectResult {
  leads: AdjudicationLead[]
  usedKeywordFallback: boolean
}

async function readFeeds(parser: Parser, feeds: string[]): Promise<AdjudicationLead[]> {
  const leads: AdjudicationLead[] = []
  const seen = new Set<string>()

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed)
      for (const item of parsed.items ?? []) {
        const id = extractTenderId(item.link ?? '')
        if (id && !seen.has(id)) {
          seen.add(id)
          leads.push({ tenderId: id, url: `${DETAIL_BASE}/${id}`, feedTitle: item.title ?? '' })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[CRIBAL][MERCADO] Error en feed ${feed}: ${message}`)
    }
    if (leads.length >= MAX_DETAILS) break
  }

  return leads
}

/**
 * Collect historical adjudications to analyse. Article codes are the primary
 * search parameter: a code identifies the exact good/service (e.g. 13175 =
 * MANTENIMIENTO DE SOFTWARE), so its adjudications stay within the same sector.
 * Keyword search is only a fallback — it matches titles across unrelated sectors
 * (tourism, construction, medical) and is used when the opportunity carries no
 * article codes or the code feeds return nothing.
 */
async function collectAdjudicationUrls(
  articleCodes: string[],
  keywords: string[]
): Promise<CollectResult> {
  const parser = new Parser({ headers: { 'User-Agent': USER_AGENT }, timeout: 30000 })

  const articleFeeds = articleCodes.map(
    (code) => `${RSS_BASE}/articulo/${encodeURIComponent(code)}`
  )
  let leads = await readFeeds(parser, articleFeeds)
  let usedKeywordFallback = false

  if (leads.length === 0 && keywords.length > 0) {
    const keywordFeeds = keywords.map((kw) => `${RSS_BASE}/texto/${encodeURIComponent(kw)}`)
    leads = await readFeeds(parser, keywordFeeds)
    usedKeywordFallback = true
  }

  return { leads: leads.slice(0, MAX_DETAILS), usedKeywordFallback }
}

function buildCompetitorMap(
  adjudications: ParsedAdjudication[],
  articleCodes: string[]
): CompetitorProfile[] {
  const codeSet = new Set(articleCodes)
  const map = new Map<string, CompetitorProfile>()

  for (const adj of adjudications) {
    // Only consider adjudicated items whose article code matches the
    // opportunity, so competitors reflect this exact good/service rather than
    // unrelated items bundled into the same adjudication.
    const matchingItems = adj.detail.adjudicatedItems.filter(
      (item) => codeSet.size === 0 || (item.articleCode && codeSet.has(item.articleCode))
    )
    // Skip adjudications that don't actually involve our article code: their
    // participants are not competitors for this good/service.
    if (matchingItems.length === 0 && codeSet.size > 0) continue

    const winners = new Set<string>()
    for (const item of matchingItems) {
      const key = item.providerRut || item.providerName
      if (!key) continue
      winners.add(key)

      const existing =
        map.get(key) ??
        ({
          name: item.providerName,
          rut: item.providerRut ?? '',
          timesParticipated: 0,
          timesWon: 0,
          winRate: 0,
          totalAmountWon: 0,
          organisms: [],
          lastSeen: null,
        } satisfies CompetitorProfile)

      existing.totalAmountWon += item.totalWithTax ?? item.unitPriceNoTax ?? 0
      if (adj.record.organismo && !existing.organisms.includes(adj.record.organismo)) {
        existing.organisms.push(adj.record.organismo)
      }
      if (adj.record.date && (!existing.lastSeen || adj.record.date > existing.lastSeen)) {
        existing.lastSeen = adj.record.date
      }
      map.set(key, existing)
    }

    // Count a win once per adjudication per winner.
    for (const key of winners) {
      const profile = map.get(key)
      if (profile) {
        profile.timesWon += 1
        profile.timesParticipated += 1
      }
    }

    // Participants who did not win still count as participations.
    for (const participant of adj.detail.participants) {
      const key = participant.documentNumber || participant.name
      if (!key || winners.has(key)) continue
      const existing =
        map.get(key) ??
        ({
          name: participant.name,
          rut: participant.documentNumber,
          timesParticipated: 0,
          timesWon: 0,
          winRate: 0,
          totalAmountWon: 0,
          organisms: [],
          lastSeen: adj.record.date,
        } satisfies CompetitorProfile)
      existing.timesParticipated += 1
      map.set(key, existing)
    }
  }

  const profiles = [...map.values()]
  for (const profile of profiles) {
    profile.winRate =
      profile.timesParticipated > 0
        ? Math.round((profile.timesWon / profile.timesParticipated) * 100) / 100
        : 0
  }
  return profiles.sort((a, b) => b.totalAmountWon - a.totalAmountWon)
}

function buildPriceIntelligence(
  adjudications: ParsedAdjudication[],
  articleCodes: string[]
): PriceIntelligence {
  const codeSet = new Set(articleCodes)
  const prices: number[] = []
  let currency = 'UYU'

  for (const adj of adjudications) {
    for (const item of adj.detail.adjudicatedItems) {
      const matches = codeSet.size === 0 || (item.articleCode && codeSet.has(item.articleCode))
      if (matches && item.unitPriceNoTax !== null) {
        prices.push(item.unitPriceNoTax)
        currency = item.currency
      }
    }
  }

  const sorted = [...prices].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, n) => acc + n, 0)

  return {
    sampleSize: sorted.length,
    currency,
    unitPrices: sorted,
    min: sorted.length > 0 ? sorted[0] : 0,
    max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    average: sorted.length > 0 ? Math.round(sum / sorted.length) : 0,
    median: Math.round(percentile(sorted, 50)),
    suggestedRange: {
      low: Math.round(percentile(sorted, 25)),
      high: Math.round(percentile(sorted, 75)),
    },
    lastUpdated: new Date().toISOString(),
  }
}

interface ParsedAdjudication {
  record: AdjudicationRecord
  detail: ReturnType<typeof parseAdjudicationDetail>
}

async function generateSummary(
  title: string,
  organismo: string,
  items: TenderItem[],
  adjudications: AdjudicationRecord[],
  competitors: CompetitorProfile[],
  price: PriceIntelligence,
  keywordFallback: boolean
): Promise<string | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const system = `Sos un analista de inteligencia de mercado para licitaciones del Estado uruguayo.
Analizás datos históricos de adjudicaciones para ayudar a empresas a preparar ofertas competitivas.

Respondé SOLO en español. Sé concreto y accionable.`

  // When the search fell back to keywords, the sample may mix unrelated sectors,
  // so the analysis must flag that its competitors and prices are unreliable.
  const fallbackWarning = keywordFallback
    ? `⚠️ ADVERTENCIA: Estos resultados provienen de una búsqueda por palabras clave, no por código de artículo. Los competidores y precios pueden incluir sectores no relacionados. Aclará esta limitación de forma destacada al inicio del análisis.\n\n`
    : ''

  const user = `${fallbackWarning}Oportunidad: ${title}
Organismo: ${organismo}
Ítems: ${JSON.stringify(items)}

Adjudicaciones similares encontradas (${adjudications.length}):
${JSON.stringify(adjudications)}

Competidores identificados:
${JSON.stringify(competitors)}

Inteligencia de precios:
${JSON.stringify(price)}

Generá un análisis de mercado con:
1. Resumen del mercado para este tipo de licitación
2. Principales competidores y su perfil (fortalezas, historial)
3. Estrategia de precio recomendada basada en datos históricos
4. Organismos clave donde esta empresa licita
5. Recomendaciones estratégicas para esta oferta específica

Máximo 500 palabras. Formato: secciones con títulos en negrita.`

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CRIBAL][MERCADO] Error generando resumen IA: ${message}`)
    return null
  }
}

/**
 * Run an on-demand market analysis for an opportunity: search historical
 * adjudications, map competitors, estimate price ranges and generate a Claude
 * summary. Partial failures are tolerated — whatever was collected is saved.
 */
export async function analyzeMarket(
  opportunityId: string,
  companyId: string
): Promise<MarketAnalysis> {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId },
  })
  if (!opportunity) throw new Error('Oportunidad no encontrada')

  // Step 1 — search parameters.
  const items = tenderItemsFromJson(opportunity.tenderItems)
  const articleCodes = items
    .map((item) => item.articleCode)
    .filter((code): code is string => Boolean(code))
  const keywords = extractKeywords(opportunity.title, opportunity.description ?? '')

  // Step 2 — collect and parse historical adjudications.
  const { leads, usedKeywordFallback } = await collectAdjudicationUrls(articleCodes, keywords)
  const parsed: ParsedAdjudication[] = []

  for (const lead of leads) {
    await delay(300)
    const html = await fetchArceHtml(lead.url)
    if (!html) continue
    const detail = parseAdjudicationDetail(html)
    const winner =
      detail.adjudicatedItems.map((i) => i.providerName).find(Boolean) ?? 'Sin datos'
    parsed.push({
      detail,
      record: {
        tenderId: lead.tenderId,
        // Organismo comes from the adjudication page itself; only fall back to
        // the feed title when the page has no recognisable label.
        organismo: detail.organismo ?? organismoFromTitle(lead.feedTitle),
        objeto: lead.feedTitle || opportunity.title,
        adjudicatedTo: winner,
        amount: detail.totalAmount,
        currency: detail.currency,
        date: detail.purchaseDate ? detail.purchaseDate.toISOString() : null,
        url: lead.url,
      },
    })
  }

  // Steps 3 & 4 — competitor map and price intelligence, both restricted to the
  // opportunity's article codes so cross-sector noise never leaks in.
  const competitors = buildCompetitorMap(parsed, articleCodes)
  const price = buildPriceIntelligence(parsed, articleCodes)
  const adjudicationRecords = parsed.map((p) => p.record)

  // Step 5 — Claude summary.
  const summary = await generateSummary(
    opportunity.title,
    opportunity.organismo ?? '',
    items,
    adjudicationRecords,
    competitors,
    price,
    usedKeywordFallback
  )

  // Step 6 — persist.
  const analysis = await prisma.marketAnalysis.create({
    data: {
      opportunityId: opportunity.id,
      companyId,
      searchKeywords: keywords,
      articleCodes,
      adjudicationsFound: adjudicationRecords.length,
      competitorsFound: competitors.length,
      adjudications: adjudicationRecords as unknown as Prisma.InputJsonValue,
      competitors: competitors as unknown as Prisma.InputJsonValue,
      priceRange: price as unknown as Prisma.InputJsonValue,
      summary,
    },
  })

  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: {
      marketAnalyzedAt: new Date(),
      similarAdjudications: adjudicationRecords as unknown as Prisma.InputJsonValue,
      competitorMap: competitors as unknown as Prisma.InputJsonValue,
      priceIntelligence: price as unknown as Prisma.InputJsonValue,
      marketSummary: summary,
    },
  })

  console.log(
    `[CRIBAL][MERCADO] Análisis completado para ${opportunity.title}: ${adjudicationRecords.length} adjudicaciones, ${competitors.length} competidores`
  )

  return analysis
}
