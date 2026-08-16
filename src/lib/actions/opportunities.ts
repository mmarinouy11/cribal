'use server'

import { revalidatePath } from 'next/cache'
import { OpportunityStatus, Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

function isValidStatus(value: string): value is OpportunityStatus {
  return Object.values(OpportunityStatus).includes(value as OpportunityStatus)
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
