import Anthropic from '@anthropic-ai/sdk'
import type { CompanyConfig } from '@prisma/client'
import type { NormalizedTender } from './normalizer'

export interface ClassificationResult {
  opportunityId: string
  isRelevant: boolean
  score: number
  category: string
  summary: string
  recommendedPlay: string
}

const MODEL = 'claude-sonnet-4-6'
const BATCH_SIZE = 20

const SYSTEM_PROMPT = `You are a specialist assistant that evaluates Uruguayan public procurement publications to identify real business opportunities for technology and digital services companies.

Your task is to classify each tender and determine if it represents a genuine opportunity for the configured company.

Return ONLY a JSON array — no markdown, no extra text, no explanation outside the array.

Each object in the array must have exactly these fields:
- "opportunityId": string (copy exactly from input)
- "isRelevant": boolean
- "score": integer 0-10
- "category": one of: "desarrollo_software" | "soporte_tecnico" | "cloud" | "datos_analytics" | "ciberseguridad" | "qa_testing" | "servicios_gestionados" | "licencias" | "consultoria" | "no_relevante"
- "summary": string (one sentence in Spanish explaining the decision)
- "recommendedPlay": string (concrete commercial angle in Spanish, empty string if not relevant)

Scoring scale:
0–4: Not relevant
5–6: Marginal — flag for manual review
7–8: Relevant
9–10: Highly relevant — high priority

Special instruction for technical support opportunities:
Technical support / service desk tenders ARE relevant when they involve outsourced or managed support services, including Level 1, Level 2, help desk, service desk, user support, incident management, or support and maintenance services. Treat these as relevant even if they are not software development projects.

Reject tenders that are ONLY for software licenses, renewals, or subscriptions for Veeam or Zimbra, unless the tender explicitly includes a broader managed service, implementation, migration, or technical support scope beyond the license purchase.`

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return cachedClient
}

function buildUserMessage(batch: NormalizedTender[], company: CompanyConfig): string {
  const tendersForPrompt = batch.map((tender) => ({
    opportunityId: tender.opportunityId,
    title: tender.title,
    description: tender.description,
    organismo: tender.organismo,
    tenderType: tender.tenderType,
  }))

  return `Company: ${company.companyName}
Capabilities: ${company.capabilities.join(', ')}
Excluded products: ${company.excludedProducts.join(', ')}

Tenders to evaluate:
${JSON.stringify(tendersForPrompt, null, 2)}`
}

/** Remove markdown code fences that a model may wrap the JSON array in. */
function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function parseResponse(text: string): ClassificationResult[] {
  const cleaned = stripMarkdownFences(text)
  const parsed: unknown = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) {
    throw new Error('La respuesta de la IA no es un array JSON')
  }
  return parsed as ClassificationResult[]
}

async function classifyBatch(
  batch: NormalizedTender[],
  company: CompanyConfig
): Promise<ClassificationResult[]> {
  const client = getClient()
  const userMessage = buildUserMessage(batch, company)
  const system = company.customAiPrompt
    ? `${SYSTEM_PROMPT}\n\n${company.customAiPrompt}`
    : SYSTEM_PROMPT

  const callModel = async (): Promise<string> => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userMessage }],
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  try {
    return parseResponse(await callModel())
  } catch (firstError) {
    // Retry once on parse/JSON failure.
    const firstMessage =
      firstError instanceof Error ? firstError.message : String(firstError)
    console.error(`[CRIBAL][IA] Error parseando respuesta, reintentando: ${firstMessage}`)
    try {
      return parseResponse(await callModel())
    } catch (secondError) {
      const secondMessage =
        secondError instanceof Error ? secondError.message : String(secondError)
      console.error(
        `[CRIBAL][IA] Batch descartado tras segundo error de parseo: ${secondMessage}`
      )
      return []
    }
  }
}

/**
 * Classify tenders with Claude in batches of 20. Batch failures are logged and
 * skipped so one bad batch does not stop the whole run.
 */
export async function classifyTenders(
  tenders: NormalizedTender[],
  company: CompanyConfig
): Promise<ClassificationResult[]> {
  if (tenders.length === 0) return []

  const batches: NormalizedTender[][] = []
  for (let i = 0; i < tenders.length; i += BATCH_SIZE) {
    batches.push(tenders.slice(i, i + BATCH_SIZE))
  }

  console.log(
    `[CRIBAL][IA] Clasificando ${tenders.length} llamados en ${batches.length} batch${
      batches.length === 1 ? '' : 'es'
    }...`
  )

  const results: ClassificationResult[] = []
  for (let i = 0; i < batches.length; i++) {
    const batchResults = await classifyBatch(batches[i], company)
    const relevantCount = batchResults.filter((r) => r.isRelevant).length
    console.log(
      `[CRIBAL][IA] Batch ${i + 1}/${batches.length} completado — ${relevantCount} relevantes`
    )
    results.push(...batchResults)
  }

  return results
}
