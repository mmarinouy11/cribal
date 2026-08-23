// Persist the relevant, still-open tenders a user validated during onboarding
// as Opportunity records, so they show up in the dashboard immediately instead
// of waiting for the first cron run. Called server-side from registerCompany.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { enrichOpportunity } from '@/lib/scraper/enricher'
import type { ClassifiedValidationItem } from '@/lib/register/validation'

const ONBOARDING_SCORE = 7 // default score for items seeded from onboarding

/** Extract the numeric ARCE tender id from a detail/RSS URL ("/id/12345"). */
function extractTenderId(url: string): string {
  const match = url.match(/\/id\/(\d+)/)
  return match ? match[1] : ''
}

/**
 * Save the given (relevant + open) validation items as NUEVA opportunities for
 * the company. Creates a synthetic "onboarding" run to satisfy the required
 * runId. Items that already exist (unique constraint) or have no extractable
 * tender id are skipped without failing the batch. Enrichment is fired and
 * forgotten for each saved opportunity.
 */
export async function saveOnboardingOpportunities(
  items: ClassifiedValidationItem[],
  companyId: string
): Promise<void> {
  if (items.length === 0) return

  // Opportunity.runId is required — create a synthetic completed run to own them.
  const onboardingRun = await prisma.run.create({
    data: {
      companyId,
      status: 'COMPLETED',
      startedAt: new Date(),
      finishedAt: new Date(),
      feedsChecked: 0,
      rawItemsFound: 0,
      opportunitiesSaved: items.length,
    },
  })

  const savedIds: string[] = []

  for (const item of items) {
    const externalId = extractTenderId(item.url)
    if (!externalId) continue // cannot build a stable opportunityId without it

    try {
      const created = await prisma.opportunity.create({
        data: {
          companyId,
          runId: onboardingRun.id,
          opportunityId: `arce|${externalId}`,
          externalId,
          sourceType: 'ARCE',
          title: item.title,
          description: item.object || null,
          url: item.url,
          organismo: item.organismo || null,
          score: ONBOARDING_SCORE,
          summary: item.aiReason || null,
          status: 'NUEVA',
          detectedAt: new Date(),
        },
        select: { id: true },
      })
      savedIds.push(created.id)
    } catch (error) {
      // Duplicate (already saved for this company) — skip, don't fail the batch.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        continue
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][ONBOARDING] Error guardando "${item.title}": ${message}`)
    }
  }

  console.log(`[CRIBAL][ONBOARDING] ${savedIds.length} oportunidades guardadas del onboarding`)

  // Fire-and-forget enrichment so dates/pliego/items populate without blocking.
  for (const id of savedIds) {
    enrichOpportunity(id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][ONBOARDING] Error enriqueciendo ${id}: ${message}`)
    })
  }
}
