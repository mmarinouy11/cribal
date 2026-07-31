import type { FailedTender, NicheCategory, Prisma, SignalStrength } from '@prisma/client'
import { prisma } from '../db/prisma'
import type { TenderItem } from '../scraper/arce-parser'

/** A niche key groups failures by organismo + article code (or title fallback). */
interface NicheGroup {
  organismo: string
  articleCode: string | null
  failures: FailedTender[]
}

function tenderItemsFromJson(value: Prisma.JsonValue | null): TenderItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item)
  ) as unknown as TenderItem[]
}

/** Primary item name for a failure: first tender item, else its title. */
function primaryItemName(failure: FailedTender): string {
  const items = tenderItemsFromJson(failure.tenderItems)
  const name = items.find((i) => i.name)?.name
  return name ?? failure.title
}

/** Short organismo label — first segment, capped in length. */
function abbreviateOrganismo(organismo: string): string {
  const first = organismo.split(/[|,-]/)[0].trim()
  return first.length > 40 ? `${first.slice(0, 40)}…` : first
}

/** NUCLEO is more favorable than ADYACENTE (FUERA never reaches a niche). */
function mostFavorable(a: NicheCategory, b: NicheCategory): NicheCategory {
  if (a === 'NUCLEO' || b === 'NUCLEO') return 'NUCLEO'
  if (a === 'ADYACENTE' || b === 'ADYACENTE') return 'ADYACENTE'
  return 'FUERA'
}

function computeSignalStrength(failureCount: number, lastFailureAt: Date): SignalStrength {
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  const recent = lastFailureAt >= twelveMonthsAgo

  if (failureCount >= 3 || (failureCount >= 2 && recent)) return 'ALTA'
  if (failureCount === 2) return 'MEDIA'
  return 'BAJA'
}

/**
 * Rebuild the company's niches from its non-FUERA failures. Failures are grouped
 * by organismo + first article code (failures with no code collapse into a single
 * per-organismo niche). Existing niches are updated in place so user-owned fields
 * (status, notes, aiAnalysis) survive; new groups create new niches. Returns the
 * number of niches touched.
 */
export async function recomputeNiches(companyId: string): Promise<number> {
  const failures = await prisma.failedTender.findMany({
    where: { companyId, nicheCategory: { not: 'FUERA' } },
    orderBy: { publicationDate: 'asc' },
  })

  // 1. Group in memory.
  const groups = new Map<string, NicheGroup>()
  for (const failure of failures) {
    const organismo = failure.organismo?.trim() || 'Sin organismo'
    const articleCode = failure.articleCodes[0] ?? null
    const key = `${organismo}||${articleCode ?? '__NOCODE__'}`

    const group = groups.get(key)
    if (group) {
      group.failures.push(failure)
    } else {
      groups.set(key, { organismo, articleCode, failures: [failure] })
    }
  }

  // 2. Upsert each group into a Niche.
  let touched = 0
  for (const group of groups.values()) {
    const failuresInGroup = group.failures
    const desiertaCount = failuresInGroup.filter((f) => f.failureType === 'DESIERTA').length
    const rechazadaCount = failuresInGroup.filter(
      (f) => f.failureType === 'OFERTAS_RECHAZADAS'
    ).length
    const failureCount = failuresInGroup.length

    const dates = failuresInGroup
      .map((f) => f.publicationDate ?? f.detectedAt)
      .sort((a, b) => a.getTime() - b.getTime())
    const firstFailureAt = dates[0]
    const lastFailureAt = dates[dates.length - 1]

    const topFailure = [...failuresInGroup].sort((a, b) => b.fitScore - a.fitScore)[0]
    const fitScore = topFailure.fitScore
    const missingCapability = topFailure.missingCapability

    const category = failuresInGroup
      .map((f) => f.nicheCategory)
      .reduce<NicheCategory>((acc, c) => mostFavorable(acc, c), 'FUERA')

    const label = `${primaryItemName(topFailure)} · ${abbreviateOrganismo(group.organismo)}`
    const signalStrength = computeSignalStrength(failureCount, lastFailureAt)

    const data = {
      organismo: group.organismo,
      articleCode: group.articleCode,
      label,
      category,
      fitScore,
      missingCapability,
      failureCount,
      desiertaCount,
      rechazadaCount,
      firstFailureAt,
      lastFailureAt,
      signalStrength,
    }

    // Find the existing niche, keyed on the schema's unique (companyId,
    // organismo, articleCode). No-code failures collapse into a single
    // articleCode=null niche per organismo, which keeps lookups stable across
    // runs (a label-based key would drift as failures accumulate).
    const existing = await prisma.niche.findFirst({
      where: { companyId, organismo: group.organismo, articleCode: group.articleCode },
    })

    const niche = existing
      ? await prisma.niche.update({ where: { id: existing.id }, data })
      : await prisma.niche.create({ data: { ...data, companyId } })

    // 3. Link this group's failures to the niche.
    await prisma.failedTender.updateMany({
      where: { id: { in: failuresInGroup.map((f) => f.id) } },
      data: { nicheId: niche.id },
    })

    touched++
  }

  // Unlink FUERA failures from any niche they might still point to.
  await prisma.failedTender.updateMany({
    where: { companyId, nicheCategory: 'FUERA', nicheId: { not: null } },
    data: { nicheId: null },
  })

  console.log(`[CRIBAL][NICHOS] ${touched} nicho(s) recomputados para ${companyId}`)
  return touched
}
