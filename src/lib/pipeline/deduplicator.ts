import type { OpportunityStatus } from '@prisma/client'
import { prisma } from '../db/prisma'
import type { NormalizedTender } from './normalizer'

/** A candidate tender that already exists as an onboarding-sample opportunity. */
export interface OnboardingMatch {
  tender: NormalizedTender
  opportunityDbId: string
  status: OpportunityStatus
  // Whether the onboarding mark was an explicit user override (vs the AI's).
  userMarked: boolean
}

/** Read the userMarked flag stored in an onboarding opportunity's aiRawOutput. */
function readUserMarked(aiRawOutput: unknown): boolean {
  return (
    typeof aiRawOutput === 'object' &&
    aiRawOutput !== null &&
    (aiRawOutput as { userMarked?: unknown }).userMarked === true
  )
}

export interface DeduplicationResult {
  newTenders: NormalizedTender[]
  // Existing pipeline opportunities — genuine duplicates, skipped.
  duplicates: NormalizedTender[]
  // Existing onboarding-sample opportunities — candidates for promotion.
  onboardingMatches: OnboardingMatch[]
}

/**
 * Split tenders into those not yet in the database, genuine duplicates (already
 * a pipeline opportunity), and onboarding matches (already saved as a
 * source="onboarding" calibration opportunity for this company). Matched by
 * opportunityId and scoped to a single company. Onboarding matches are split out
 * so the pipeline can PROMOTE the open relevant ones instead of discarding the
 * real tender as a duplicate (which left new accounts with an empty dashboard).
 */
export async function filterDuplicates(
  tenders: NormalizedTender[],
  companyId: string
): Promise<DeduplicationResult> {
  const opportunityIds = tenders.map((t) => t.opportunityId)

  const existing = await prisma.opportunity.findMany({
    where: { companyId, opportunityId: { in: opportunityIds } },
    select: { id: true, opportunityId: true, source: true, status: true, aiRawOutput: true },
  })
  const existingByOppId = new Map(existing.map((o) => [o.opportunityId, o]))

  const newTenders: NormalizedTender[] = []
  const duplicates: NormalizedTender[] = []
  const onboardingMatches: OnboardingMatch[] = []

  for (const tender of tenders) {
    const match = existingByOppId.get(tender.opportunityId)
    if (!match) {
      newTenders.push(tender)
    } else if (match.source === 'onboarding') {
      onboardingMatches.push({
        tender,
        opportunityDbId: match.id,
        status: match.status,
        userMarked: readUserMarked(match.aiRawOutput),
      })
    } else {
      duplicates.push(tender)
    }
  }

  console.log(
    `[CRIBAL][DEDUP] ${tenders.length} → ${newTenders.length} nuevos (${duplicates.length} ya existían, ${onboardingMatches.length} del onboarding)`
  )

  return { newTenders, duplicates, onboardingMatches }
}
