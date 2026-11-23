import type Anthropic from '@anthropic-ai/sdk'
import type { CompanyConfig } from '@prisma/client'
import type { NormalizedTender } from './normalizer'
import type { UserExample } from '@/lib/register/validation'
import { batchClassify, type IdentifiedResult } from '@/lib/ai/batch-classify'

export interface ClassificationResult {
  opportunityId: string
  isRelevant: boolean
  score: number
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

const CATEGORIES = [
  'desarrollo_software',
  'soporte_tecnico',
  'cloud',
  'datos_analytics',
  'ciberseguridad',
  'qa_testing',
  'servicios_gestionados',
  'licencias',
  'consultoria',
  'no_relevante',
]

const SYSTEM_PROMPT = `You are a specialist assistant that evaluates Uruguayan public procurement publications to identify real business opportunities for technology and digital services companies.

Your task is to classify each tender and determine if it represents a genuine opportunity for the configured company.

Use the \`classify_tenders\` tool to return exactly one classification per tender, copying each "opportunityId" exactly from the input.

Field guidance:
- "score": integer 0-10.
- "category": one of ${CATEGORIES.join(' | ')}.
- "summary": one short sentence in Spanish, at most ${MAX_SUMMARY_CHARS} characters.
- "recommendedPlay": concrete commercial angle in Spanish, empty string if not relevant.

Scoring scale:
0–4: Not relevant
5–6: Marginal — flag for manual review
7–8: Relevant
9–10: Highly relevant — high priority

Special instruction for technical support opportunities:
Technical support / service desk tenders ARE relevant when they involve outsourced or managed support services, including Level 1, Level 2, help desk, service desk, user support, incident management, or support and maintenance services. Treat these as relevant even if they are not software development projects.

Reject tenders that are ONLY for software licenses, renewals, or subscriptions for Veeam or Zimbra, unless the tender explicitly includes a broader managed service, implementation, migration, or technical support scope beyond the license purchase.`

const CLASSIFY_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          opportunityId: { type: 'string' },
          isRelevant: { type: 'boolean' },
          score: { type: 'integer' },
          category: { type: 'string' },
          summary: { type: 'string' },
          recommendedPlay: { type: 'string' },
        },
        required: [
          'opportunityId',
          'isRelevant',
          'score',
          'category',
          'summary',
          'recommendedPlay',
        ],
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
        isRelevant: o.isRelevant === true,
        score: typeof o.score === 'number' ? Math.max(0, Math.min(10, Math.round(o.score))) : 0,
        category: typeof o.category === 'string' ? o.category : 'no_relevante',
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
