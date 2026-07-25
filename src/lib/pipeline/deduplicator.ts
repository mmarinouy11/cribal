import { prisma } from '../db/prisma'
import type { NormalizedTender } from './normalizer'

export interface DeduplicationResult {
  newTenders: NormalizedTender[]
  duplicates: NormalizedTender[]
}

/**
 * Split tenders into those not yet in the database and those that already exist
 * (matched by opportunityId). Scoped to a single company so tenants never see
 * each other's opportunities as duplicates.
 */
export async function filterDuplicates(
  tenders: NormalizedTender[],
  companyId: string
): Promise<DeduplicationResult> {
  const opportunityIds = tenders.map((t) => t.opportunityId)

  const existing = await prisma.opportunity.findMany({
    where: { companyId, opportunityId: { in: opportunityIds } },
    select: { opportunityId: true },
  })
  const existingIds = new Set(existing.map((o) => o.opportunityId))

  const newTenders: NormalizedTender[] = []
  const duplicates: NormalizedTender[] = []

  for (const tender of tenders) {
    if (existingIds.has(tender.opportunityId)) {
      duplicates.push(tender)
    } else {
      newTenders.push(tender)
    }
  }

  console.log(
    `[CRIBAL][DEDUP] ${tenders.length} → ${newTenders.length} nuevos (${duplicates.length} ya existían en DB)`
  )

  return { newTenders, duplicates }
}
