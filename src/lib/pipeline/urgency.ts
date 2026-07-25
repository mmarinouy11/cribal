import { OpportunityStatus, type Opportunity } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { startOfToday, addDays } from '@/lib/dates'
import { getBusinessDaysUntilClosing } from '@/lib/urgency-utils'

// Re-export the client-safe helpers so server callers can keep importing them here.
export { getBusinessDaysUntilClosing, getUrgencyLevel, type UrgencyLevel } from '@/lib/urgency-utils'

const OPEN_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.NUEVA,
  OpportunityStatus.REVISANDO,
  OpportunityStatus.RELEVANTE,
]

/**
 * Opportunities that are still open (NUEVA/REVISANDO/RELEVANTE) and close within
 * the next 5 business days, ordered by closing date ascending.
 */
export async function getUrgentOpportunities(companyId: string): Promise<Opportunity[]> {
  // Over-fetch by calendar days, then narrow to 5 business days precisely.
  const candidates = await prisma.opportunity.findMany({
    where: {
      companyId,
      status: { in: OPEN_STATUSES },
      closingDate: { gte: startOfToday(), lte: addDays(new Date(), 10) },
    },
    orderBy: { closingDate: 'asc' },
  })

  return candidates.filter(
    (opp) => opp.closingDate !== null && getBusinessDaysUntilClosing(opp.closingDate) <= 5
  )
}
