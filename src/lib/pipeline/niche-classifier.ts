import Anthropic from '@anthropic-ai/sdk'
import type { CompanyConfig, FailureType } from '@prisma/client'
import type { TenderItem } from '../scraper/arce-parser'

/** A failed tender ready to be evaluated for fit against the company. */
export interface FailureToClassify {
  failureId: string
  title: string
  description: string
  organismo: string
  failureType: FailureType
  tenderItems: TenderItem[]
}

export interface NicheClassification {
  failureId: string
  category: 'nucleo' | 'adyacente' | 'fuera'
  fitScore: number // 0-10
  reason: string // Spanish, one sentence
  missingCapability: string // Spanish, empty if nucleo or fuera
}

const MODEL = 'claude-sonnet-4-6'
const BATCH_SIZE = 20

const SYSTEM_PROMPT = `Analizás licitaciones del Estado uruguayo que fracasaron — quedaron desiertas
(nadie se presentó) o todas las ofertas fueron rechazadas. Son necesidades
insatisfechas que el organismo probablemente vuelva a licitar.

Tu tarea NO es verificar si la empresa ya trabaja en ese rubro. Es evaluar si
podría capturar esa oportunidad, incluso si hoy no opera ahí.

Para cada licitación, clasificá:

- "nucleo": está dentro de lo que la empresa ya hace.
- "adyacente": podría con un estiramiento razonable — contratar un perfil,
  aliarse con otro proveedor, incorporar una tecnología cercana, extender un
  servicio existente. Indicá concretamente qué le faltaría.
- "fuera": otro rubro por completo, la distancia es demasiado grande.

Score 0-10 combinando cercanía a las capacidades actuales y atractivo de la
oportunidad. Un adyacente muy atractivo puede puntuar más alto que un núcleo
menor.

IMPORTANTE: el objetivo es descubrir mercados nuevos, no confirmar los actuales.
No seas conservador con "adyacente". Si hay un camino plausible para que la
empresa lo cubra, marcalo adyacente y explicá el camino. Reservá "fuera" para
casos donde no hay puente razonable.

Respondé SOLO un array JSON, sin markdown:
[{
  "failureId": string,
  "category": "nucleo" | "adyacente" | "fuera",
  "fitScore": number,
  "reason": string,
  "missingCapability": string
}]`

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return cachedClient
}

function buildUserMessage(batch: FailureToClassify[], company: CompanyConfig): string {
  const failuresForPrompt = batch.map((failure) => ({
    failureId: failure.failureId,
    title: failure.title,
    description: failure.description,
    organismo: failure.organismo,
    tenderItems: failure.tenderItems,
    failureType: failure.failureType,
  }))

  return `Empresa: ${company.companyName}
Descripción: ${company.description ?? ''}
Capacidades actuales: ${company.capabilities.join(', ')}

Licitaciones fallidas a evaluar:
${JSON.stringify(failuresForPrompt, null, 2)}`
}

/** Remove markdown code fences that a model may wrap the JSON array in. */
function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function parseResponse(text: string): NicheClassification[] {
  const cleaned = stripMarkdownFences(text)
  const parsed: unknown = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) {
    throw new Error('La respuesta de la IA no es un array JSON')
  }
  return parsed as NicheClassification[]
}

async function classifyBatch(
  batch: FailureToClassify[],
  company: CompanyConfig
): Promise<NicheClassification[]> {
  const client = getClient()
  const userMessage = buildUserMessage(batch, company)

  const callModel = async (): Promise<string> => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
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
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError)
    console.error(`[CRIBAL][NICHOS] Error parseando clasificación, reintentando: ${firstMessage}`)
    try {
      return parseResponse(await callModel())
    } catch (secondError) {
      const secondMessage =
        secondError instanceof Error ? secondError.message : String(secondError)
      console.error(
        `[CRIBAL][NICHOS] Batch descartado tras segundo error de parseo: ${secondMessage}`
      )
      return []
    }
  }
}

/**
 * Classify failed tenders by how far each is from the company's current
 * capabilities. Unlike the main classifier this applies no keyword/category
 * pre-filter — every failure is evaluated so new markets can surface. Batches of
 * 20; a failed batch is logged and skipped.
 */
export async function classifyFailures(
  failures: FailureToClassify[],
  company: CompanyConfig
): Promise<NicheClassification[]> {
  if (failures.length === 0) return []

  const batches: FailureToClassify[][] = []
  for (let i = 0; i < failures.length; i += BATCH_SIZE) {
    batches.push(failures.slice(i, i + BATCH_SIZE))
  }

  console.log(
    `[CRIBAL][NICHOS] Clasificando ${failures.length} fallos en ${batches.length} batch${
      batches.length === 1 ? '' : 'es'
    }...`
  )

  const results: NicheClassification[] = []
  for (let i = 0; i < batches.length; i++) {
    const batchResults = await classifyBatch(batches[i], company)
    results.push(...batchResults)
  }

  return results
}
