import type Anthropic from '@anthropic-ai/sdk'
import type { CompanyConfig, FailureType } from '@prisma/client'
import type { TenderItem } from '../scraper/arce-parser'
import { batchClassify, type IdentifiedResult } from '@/lib/ai/batch-classify'

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
const BATCH_SIZE = 8
const MAX_PARALLEL = 3
const MAX_REASON_CHARS = 120

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

Usá la herramienta \`classify_failures\` para devolver una clasificación por
licitación, copiando cada "failureId" exactamente. "reason" es una oración en
español de máximo ${MAX_REASON_CHARS} caracteres. "missingCapability" va solo en
los "adyacente" (vacío en "nucleo" y "fuera").`

const CLASSIFY_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          failureId: { type: 'string' },
          category: { type: 'string' },
          fitScore: { type: 'integer' },
          reason: { type: 'string' },
          missingCapability: { type: 'string' },
        },
        required: ['failureId', 'category', 'fitScore', 'reason', 'missingCapability'],
        additionalProperties: false,
      },
    },
  },
  required: ['classifications'],
  additionalProperties: false,
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

function toCategory(value: unknown): 'nucleo' | 'adyacente' | 'fuera' {
  return value === 'nucleo' || value === 'adyacente' ? value : 'fuera'
}

/** Extract per-failure results from the tool input, tolerating partial objects. */
function extractClassifications(input: unknown): IdentifiedResult<NicheClassification>[] {
  if (!input || typeof input !== 'object') return []
  const arr = (input as { classifications?: unknown }).classifications
  if (!Array.isArray(arr)) return []

  const out: IdentifiedResult<NicheClassification>[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const failureId = typeof o.failureId === 'string' ? o.failureId : ''
    if (!failureId) continue
    const category = toCategory(o.category)
    out.push({
      id: failureId,
      result: {
        failureId,
        category,
        fitScore: typeof o.fitScore === 'number' ? Math.max(0, Math.min(10, Math.round(o.fitScore))) : 0,
        reason: typeof o.reason === 'string' ? o.reason.slice(0, MAX_REASON_CHARS) : '',
        missingCapability:
          category === 'adyacente' && typeof o.missingCapability === 'string'
            ? o.missingCapability
            : '',
      },
    })
  }
  return out
}

/**
 * Classify failed tenders by how far each is from the company's current
 * capabilities, using small tool-based batches. No keyword pre-filter — every
 * failure is evaluated so new markets can surface. Truncated/unparseable items
 * are simply skipped (they are retried on the next run's ingestion).
 */
export async function classifyFailures(
  failures: FailureToClassify[],
  company: CompanyConfig
): Promise<NicheClassification[]> {
  if (failures.length === 0) return []

  const { byId } = await batchClassify<FailureToClassify, NicheClassification>({
    context: 'clasificación de nichos',
    model: MODEL,
    system: SYSTEM_PROMPT,
    items: failures,
    idOf: (failure) => failure.failureId,
    buildUserMessage: (batch) => buildUserMessage(batch, company),
    tool: {
      name: 'classify_failures',
      description: 'Return the niche-fit classification for every failed tender in the batch.',
      inputSchema: CLASSIFY_TOOL_SCHEMA,
    },
    extractResults: extractClassifications,
    batchSize: BATCH_SIZE,
    maxParallel: MAX_PARALLEL,
  })

  return [...byId.values()]
}
