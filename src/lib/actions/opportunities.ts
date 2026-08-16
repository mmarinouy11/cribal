'use server'

import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'
import { OpportunityStatus, Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { extractPliegoText } from '@/lib/pliego/extractor'
import type { TenderItem } from '@/lib/scraper/arce-parser'

const CONDITIONS_MODEL = 'claude-sonnet-4-6'
const CONDITIONS_MAX_PLIEGO_CHARS = 60_000

function isValidStatus(value: string): value is OpportunityStatus {
  return Object.values(OpportunityStatus).includes(value as OpportunityStatus)
}

function tenderItemsFromJson(value: Prisma.JsonValue | null): TenderItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item)
  ) as unknown as TenderItem[]
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/**
 * Assert the opportunity exists and belongs to the session user's company.
 * Returns the session's companyId on success; throws otherwise.
 */
async function assertOwnership(id: string): Promise<string> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')

  const companyId = session.user.companyId
  const owned = await prisma.opportunity.findFirst({
    where: { id, companyId },
    select: { id: true },
  })
  if (!owned) throw new Error('No autorizado')

  return companyId
}

export async function updateOpportunityStatus(id: string, status: string): Promise<void> {
  await assertOwnership(id)

  if (!isValidStatus(status)) {
    throw new Error('Estado inválido')
  }

  await prisma.opportunity.update({
    where: { id },
    data: { status },
  })

  revalidatePath('/oportunidades')
  revalidatePath(`/oportunidades/${id}`)
  revalidatePath('/')
}

// Contextual state transitions from the detail page action buttons.
const ADVANCE_TARGETS = ['REVISANDO', 'RELEVANTE', 'OFERTADA', 'ARCHIVADA', 'NUEVA'] as const
type AdvanceTarget = (typeof ADVANCE_TARGETS)[number]

/**
 * Move an opportunity to a new status via a contextual action (seguir, tomar,
 * marcar ofertada, archivar, reabrir). Reopening (NUEVA) clears the dismissal
 * metadata. Company-scoped.
 */
export async function advanceOpportunity(id: string, target: AdvanceTarget): Promise<void> {
  await assertOwnership(id)
  if (!ADVANCE_TARGETS.includes(target)) throw new Error('Transición inválida')

  const data: Prisma.OpportunityUpdateInput = { status: target }
  if (target === 'NUEVA') {
    data.dismissReason = null
    data.dismissComment = null
    data.dismissedAt = null
  }

  await prisma.opportunity.update({ where: { id }, data })
  revalidatePath('/oportunidades')
  revalidatePath(`/oportunidades/${id}`)
  revalidatePath('/')
}

/** Dismiss (Desestimar) an opportunity with a reason and optional comment. */
export async function dismissOpportunity(
  id: string,
  reason: string,
  comment: string
): Promise<void> {
  await assertOwnership(id)

  await prisma.opportunity.update({
    where: { id },
    data: {
      status: 'DESCARTADA',
      dismissReason: reason || null,
      dismissComment: comment.trim() || null,
      dismissedAt: new Date(),
    },
  })
  revalidatePath('/oportunidades')
  revalidatePath(`/oportunidades/${id}`)
  revalidatePath('/')
}

export interface OpportunityReviewInput {
  status?: string
  owner?: string
  nextAction?: string
  nextFollowUpDate?: Date | null
  notes?: string
}

export async function updateOpportunityReview(
  id: string,
  data: OpportunityReviewInput
): Promise<void> {
  await assertOwnership(id)

  const updateData: Prisma.OpportunityUpdateInput = {}

  if (data.status !== undefined) {
    if (!isValidStatus(data.status)) throw new Error('Estado inválido')
    updateData.status = data.status
  }
  if (data.owner !== undefined) updateData.owner = data.owner || null
  if (data.nextAction !== undefined) updateData.nextAction = data.nextAction || null
  if (data.nextFollowUpDate !== undefined) updateData.nextFollowUpDate = data.nextFollowUpDate
  if (data.notes !== undefined) updateData.notes = data.notes || null

  await prisma.opportunity.update({
    where: { id },
    data: updateData,
  })

  revalidatePath(`/oportunidades/${id}`)
  revalidatePath('/oportunidades')
}

const CONDITIONS_SYSTEM_PROMPT = `Analizás pliegos de licitaciones del Estado uruguayo para identificar los requisitos
que debe cumplir una empresa para poder presentar oferta.

Respondé SOLO con un objeto JSON:
{
  "experienciaMinima": string | null,      // años o proyectos similares requeridos
  "certificaciones": string[],             // ISO, CMMI, etc.
  "garantias": string | null,              // garantía de mantenimiento de oferta
  "documentacionRequerida": string[],      // lista de documentos a presentar
  "restricciones": string[],               // exclusiones o incompatibilidades
  "plazoEjecucion": string | null,         // tiempo de entrega o duración del contrato
  "criterioEvaluacion": string | null,     // cómo se evalúan las ofertas (precio, técnica, etc.)
  "resumenGeneral": string                 // 2-3 oraciones resumiendo los requisitos clave
}`

function formatConditionsItems(items: TenderItem[]): string {
  if (items.length === 0) return 'No disponible'
  return items.map((i) => `${i.itemNumber}. ${i.name}`).join('\n')
}

/**
 * Analyze the tender's submission conditions with Claude and persist the result
 * on the opportunity. Uses the cached pliego text when available (extracting it
 * lazily otherwise); without a pliego it works from the description + items and
 * flags the analysis as partial. Company-scoped.
 */
export async function analyzeConditions(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth()
  if (!session) return { success: false, error: 'No autorizado' }
  const companyId = session.user.companyId

  const opportunity = await prisma.opportunity.findFirst({ where: { id, companyId } })
  if (!opportunity) return { success: false, error: 'No autorizado' }

  // Use cached pliego text; extract and cache it lazily the first time.
  let pliegoText = opportunity.pliegoText
  if (!pliegoText && opportunity.pliegoUrl) {
    pliegoText = await extractPliegoText(opportunity.pliegoUrl)
    if (pliegoText) {
      await prisma.opportunity.update({ where: { id }, data: { pliegoText } })
    }
  }

  const items = tenderItemsFromJson(opportunity.tenderItems)
  const pliegoSection = pliegoText
    ? `Contenido del pliego:\n${pliegoText.slice(0, CONDITIONS_MAX_PLIEGO_CHARS)}`
    : 'No hay pliego PDF disponible. Basá el análisis en la descripción y los ítems, y aclará en "resumenGeneral" que el análisis es parcial por falta del pliego.'

  const userMessage = `Oportunidad: ${opportunity.title}
Organismo: ${opportunity.organismo ?? 'No especificado'}
Descripción: ${opportunity.description ?? 'No disponible'}

Ítems del llamado:
${formatConditionsItems(items)}

${pliegoSection}`

  const callModel = async (): Promise<string> => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: CONDITIONS_MODEL,
      max_tokens: 1500,
      system: CONDITIONS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  const parse = (text: string): Prisma.InputJsonValue => {
    const parsed: unknown = JSON.parse(stripMarkdownFences(text))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('La respuesta no es un objeto JSON')
    }
    return parsed as Prisma.InputJsonValue
  }

  let analysis: Prisma.InputJsonValue
  try {
    try {
      analysis = parse(await callModel())
    } catch {
      // Retry once on malformed JSON.
      analysis = parse(await callModel())
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][CONDICIONES] Error analizando ${id}: ${message}`)
    return { success: false, error: 'No se pudo analizar las condiciones. Intentá nuevamente.' }
  }

  await prisma.opportunity.update({ where: { id }, data: { conditionsAnalysis: analysis } })
  revalidatePath(`/oportunidades/${id}`)
  return { success: true }
}
