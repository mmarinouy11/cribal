// Persist the tenders a user marked during onboarding as Opportunity records
// with source="onboarding". They never show on the dashboard (the dashboard
// ignores source="onboarding"); they are calibration data: relevant marks keep
// the AI treating similar tenders as relevant in the daily pipeline, and
// not-relevant marks balance that. Called server-side from registerCompany.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { enrichOpportunity } from '@/lib/scraper/enricher'
import { getTenderObjectText } from '@/lib/tenders/object-text'
import type { ClassifiedValidationItem, UserExample } from '@/lib/register/validation'

const ONBOARDING_SCORE = 7 // default score for relevant onboarding marks
const MAX_EXAMPLES = 10

/** Extract the numeric ARCE tender id from a detail/RSS URL ("/id/12345"). */
function extractTenderId(url: string): string {
  const match = url.match(/\/id\/(\d+)/)
  return match ? match[1] : ''
}

/**
 * Save the given validation marks as onboarding opportunities. Relevant marks
 * are stored NUEVA (and enriched); not-relevant marks are stored NO_FIT (not
 * enriched). Duplicates / items without a tender id are skipped.
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
      kind: 'onboarding',
      status: 'COMPLETED',
      startedAt: new Date(),
      finishedAt: new Date(),
      feedsChecked: 0,
      rawItemsFound: 0,
      opportunitiesSaved: items.length,
    },
  })

  const enrichIds: string[] = []
  let saved = 0

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
          source: 'onboarding',
          title: item.title,
          description: item.object || null,
          url: item.url,
          organismo: item.organismo || null,
          score: item.aiRelevant ? ONBOARDING_SCORE : 0,
          summary: item.aiReason || null,
          status: item.aiRelevant ? 'NUEVA' : 'NO_FIT',
          detectedAt: new Date(),
        },
        select: { id: true },
      })
      saved += 1
      // Only enrich relevant + open marks (the rest are calibration only).
      if (item.aiRelevant && item.isOpen) enrichIds.push(created.id)
    } catch (error) {
      // Duplicate (already saved for this company) — skip, don't fail the batch.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        continue
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][ONBOARDING] Error guardando "${item.title}": ${message}`)
    }
  }

  console.log(`[CRIBAL][ONBOARDING] ${saved} marcas guardadas como calibración (source=onboarding)`)

  // Fire-and-forget enrichment so dates/pliego/items populate without blocking.
  for (const id of enrichIds) {
    enrichOpportunity(id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][ONBOARDING] Error enriqueciendo ${id}: ${message}`)
    })
  }
}

/**
 * Up to 10 onboarding marks for a company, balanced between relevant and
 * not-relevant and most recent first, as calibration examples for the daily
 * pipeline classifier. Relevance comes from the stored status (NUEVA = relevant).
 */
export async function getOnboardingExamples(companyId: string): Promise<UserExample[]> {
  const opps = await prisma.opportunity.findMany({
    where: { companyId, source: 'onboarding' },
    orderBy: { createdAt: 'desc' },
    select: { title: true, description: true, objectDescription: true, status: true },
    take: 40,
  })

  const examples = opps
    .map((o) => ({
      object: getTenderObjectText({ title: o.title, object: o.objectDescription || o.description || '' }),
      relevant: o.status === 'NUEVA',
    }))
    .filter((e) => e.object.length > 0)

  const relevant = examples.filter((e) => e.relevant)
  const notRelevant = examples.filter((e) => !e.relevant)
  const half = Math.floor(MAX_EXAMPLES / 2)
  const balanced = [...relevant.slice(0, half), ...notRelevant.slice(0, half)]
  const rest = [...relevant.slice(half), ...notRelevant.slice(half)]
  return [...balanced, ...rest].slice(0, MAX_EXAMPLES)
}
