'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { enrichOpportunity } from '@/lib/scraper/enricher'

export async function triggerEnrichment(opportunityId: string): Promise<void> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')

  const owned = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!owned) throw new Error('No autorizado')

  // Deliberate user action — await it so the refreshed page shows fresh data.
  await enrichOpportunity(opportunityId)

  revalidatePath(`/oportunidades/${opportunityId}`)
}
