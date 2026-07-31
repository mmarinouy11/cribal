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

/** First tender item name for a failure, or null when there are no items. */
function itemName(failure: FailedTender): string | null {
  const items = tenderItemsFromJson(failure.tenderItems)
  return items.find((i) => i.name)?.name ?? null
}

/** Collapse an organismo that repeats itself ("X · X" → "X"). */
function cleanOrganismo(organismo: string): string {
  const parts = organismo
    .split('·')
    .map((segment) => segment.trim())
    .filter(Boolean)
  const unique = [...new Set(parts)]
  return unique.join(' · ') || organismo.trim()
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

/**
 * Build a readable niche label: "{object description} · {organismo}", falling
 * back to the item name, and only then to the raw feed title. The feed title
 * already contains the organismo, so it is used as-is without appending it again.
 */
function buildLabel(topFailure: FailedTender, organismo: string): string {
  const org = cleanOrganismo(organismo)
  const description = topFailure.objectDescription?.trim()
  if (description) return `${truncateText(description, 60)} · ${org}`
  const item = itemName(topFailure)
  if (item) return `${item} · ${org}`
  return topFailure.title
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

  // 2. Upsert groups, relink failures and prune orphans in a single transaction
  // so the UI never reads a half-updated state (e.g. the same failure showing up
  // under both its old and its new niche).
  const { touched, deleted, archived } = await prisma.$transaction(
    async (tx) => {
      const keptNicheIds: string[] = []
      let touchedCount = 0

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

        const label = buildLabel(topFailure, group.organismo)
        const signalStrength = computeSignalStrength(failureCount, lastFailureAt)

        const data = {
          organismo: group.organismo,
          articleCode: group.articleCode,
          label,
          objectDescription: topFailure.objectDescription,
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
        const existing = await tx.niche.findFirst({
          where: { companyId, organismo: group.organismo, articleCode: group.articleCode },
        })

        const niche = existing
          ? await tx.niche.update({ where: { id: existing.id }, data })
          : await tx.niche.create({ data: { ...data, companyId } })

        // 3. Link this group's failures to the niche.
        await tx.failedTender.updateMany({
          where: { id: { in: failuresInGroup.map((f) => f.id) } },
          data: { nicheId: niche.id },
        })

        keptNicheIds.push(niche.id)
        touchedCount++
      }

      // Unlink FUERA failures from any niche they might still point to.
      await tx.failedTender.updateMany({
        where: { companyId, nicheCategory: 'FUERA', nicheId: { not: null } },
        data: { nicheId: null },
      })

      // 4. Prune orphans: niches not touched this run whose failures all moved
      // elsewhere (e.g. an old articleCode=null niche superseded once the backfill
      // added a real code). Untouched ones are hard-deleted; ones the user
      // invested in (non-NUEVO status, notes or an AI analysis) are archived
      // instead so nothing is lost.
      const orphans = await tx.niche.findMany({
        where: { companyId, id: { notIn: keptNicheIds } },
        include: { _count: { select: { failures: true } } },
      })

      let deletedCount = 0
      let archivedCount = 0
      for (const orphan of orphans) {
        if (orphan._count.failures > 0) continue // Still has failures — leave it.
        const userInvested =
          orphan.status !== 'NUEVO' || Boolean(orphan.notes) || Boolean(orphan.aiAnalysis)
        if (userInvested) {
          if (orphan.status !== 'ARCHIVADO') {
            await tx.niche.update({ where: { id: orphan.id }, data: { status: 'ARCHIVADO' } })
          }
          archivedCount++
        } else {
          await tx.niche.delete({ where: { id: orphan.id } })
          deletedCount++
        }
      }

      return { touched: touchedCount, deleted: deletedCount, archived: archivedCount }
    },
    { timeout: 60000 }
  )

  console.log(
    `[CRIBAL][NICHOS] ${touched} nicho(s) recomputados para ${companyId} — ${deleted} eliminado(s), ${archived} archivado(s)`
  )
  return touched
}
