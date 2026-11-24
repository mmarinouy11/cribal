import type Anthropic from '@anthropic-ai/sdk'
import type { CompanyConfig } from '@prisma/client'
import type { NormalizedTender } from './normalizer'
import type { UserExample } from '@/lib/register/validation'
import { batchClassify, type IdentifiedResult } from '@/lib/ai/batch-classify'

export interface ClassificationResult {
  opportunityId: string
  score: number
  // Short Spanish label of what the tender is about (a company capability or a
  // short rubro). Relevance is NOT derived from this — it comes from the score.
  category: string
  summary: string
  recommendedPlay: string
}

export interface ClassificationOutcome {
  results: ClassificationResult[]
  // Opportunity ids that could not be classified (truncated / unparseable), so
  // the caller can mark the run PARTIAL and retry them next time.
  unclassifiedIds: string[]
}

const MODEL = 'claude-sonnet-4-6'
const BATCH_SIZE = 8
const MAX_PARALLEL = 3
const MAX_SUMMARY_CHARS = 120

const SYSTEM_PROMPT = `You evaluate Uruguayan public procurement tenders (ARCE) to decide whether each one is a real business opportunity for the configured company — whatever its line of business (products or services, any industry).

Use the \`classify_tenders\` tool to return exactly one classification per tender, copying each "opportunityId" exactly from the input.

For each tender:
- "score": integer 0-10 — how well the tender fits what THIS company sells (its capabilities and keywords). 0-4 = not a fit; 5-6 = marginal; 7-8 = relevant; 9-10 = highly relevant. A tender clearly outside the company's capabilities scores low.
- "category": a SHORT label (1-4 words, in Spanish) naming what the tender is about — pick the company capability that best fits when one does, otherwise a short rubro of your own (e.g. "Aire acondicionado", "Mantenimiento edilicio", "Equipamiento médico"). Never "no relevante" and never an IT taxonomy unless the company itself is IT.
- "summary": one short sentence in Spanish, at most ${MAX_SUMMARY_CHARS} characters, explaining the fit.
- "recommendedPlay": concrete commercial angle in Spanish, empty string when the tender is not a fit.`

const CLASSIFY_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          opportunityId: { type: 'string' },
          score: { type: 'integer' },
          category: { type: 'string' },
          summary: { type: 'string' },
          recommendedPlay: { type: 'string' },
        },
        required: ['opportunityId', 'score', 'category', 'summary', 'recommendedPlay'],
        additionalProperties: false,
      },
    },
  },
  required: ['classifications'],
  additionalProperties: false,
}

function buildUserMessage(
  batch: NormalizedTender[],
  company: CompanyConfig,
  examples: UserExample[]
): string {
  const tendersForPrompt = batch.map((tender) => ({
    opportunityId: tender.opportunityId,
    title: tender.title,
    description: tender.description,
    organismo: tender.organismo,
    tenderType: tender.tenderType,
  }))

  // The company's own onboarding marks — follow this criterion for similar tenders.
  const examplesBlock = examples.length
    ? `\nExamples from the company's own criterion (follow it for similar tenders):\n${examples
        .map((e) => `- ${e.relevant ? 'RELEVANT' : 'NOT RELEVANT'}: ${e.object}`)
        .join('\n')}\n`
    : ''

  return `Company: ${company.companyName}
Capabilities: ${company.capabilities.join(', ')}
Relevant keywords: ${company.relevantKeywords.join(', ') || 'none'}
Excluded products: ${company.excludedProducts.join(', ')}
${examplesBlock}
Tenders to evaluate:
${JSON.stringify(tendersForPrompt, null, 2)}`
}

/** Extract per-tender results from the tool input, tolerating partial objects. */
function extractClassifications(input: unknown): IdentifiedResult<ClassificationResult>[] {
  if (!input || typeof input !== 'object') return []
  const arr = (input as { classifications?: unknown }).classifications
  if (!Array.isArray(arr)) return []

  const out: IdentifiedResult<ClassificationResult>[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const opportunityId = typeof o.opportunityId === 'string' ? o.opportunityId : ''
    if (!opportunityId) continue
    const summary = typeof o.summary === 'string' ? o.summary.slice(0, MAX_SUMMARY_CHARS) : ''
    out.push({
      id: opportunityId,
      result: {
        opportunityId,
        score: typeof o.score === 'number' ? Math.max(0, Math.min(10, Math.round(o.score))) : 0,
        category: typeof o.category === 'string' ? o.category.trim() : '',
        summary,
        recommendedPlay: typeof o.recommendedPlay === 'string' ? o.recommendedPlay : '',
      },
    })
  }
  return out
}

/**
 * Classify tenders with Claude using small tool-based batches run in parallel.
 * A fatal AI failure propagates (AiServiceError); truncated or unparseable items
 * come back as `unclassifiedIds` so the run can be marked PARTIAL and retry them.
 */
export async function classifyTenders(
  tenders: NormalizedTender[],
  company: CompanyConfig,
  examples: UserExample[] = []
): Promise<ClassificationOutcome> {
  if (tenders.length === 0) return { results: [], unclassifiedIds: [] }

  const system = company.customAiPrompt ? `${SYSTEM_PROMPT}\n\n${company.customAiPrompt}` : SYSTEM_PROMPT

  const { byId, unclassifiedIds } = await batchClassify<NormalizedTender, ClassificationResult>({
    context: 'clasificación del pipeline',
    model: MODEL,
    system,
    items: tenders,
    idOf: (tender) => tender.opportunityId,
    buildUserMessage: (batch) => buildUserMessage(batch, company, examples),
    tool: {
      name: 'classify_tenders',
      description: 'Return the relevance classification for every tender in the batch.',
      inputSchema: CLASSIFY_TOOL_SCHEMA,
    },
    extractResults: extractClassifications,
    batchSize: BATCH_SIZE,
    maxParallel: MAX_PARALLEL,
  })

  return { results: [...byId.values()], unclassifiedIds }
}
