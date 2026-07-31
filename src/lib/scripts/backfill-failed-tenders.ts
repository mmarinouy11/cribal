import 'dotenv/config'
import { prisma } from '../db/prisma'
import { enrichFailure } from '../pipeline/failed-tenders'
import { recomputeNiches } from '../pipeline/niches'
import { delay } from '../scraper/fetch-arce'
import type { Prisma } from '@prisma/client'

/**
 * One-off backfill: re-enrich FailedTender rows that were stored before the
 * enricher fetched the /mostrar-llamado/1 call view, so their tenderItems /
 * articleCodes / objectDescription came back empty. Fetches ARCE again, updates
 * the rows, then recomputes niches for every affected company so failures regroup
 * by article code. Idempotent — safe to re-run.
 */
async function main(): Promise<void> {
  const rows = await prisma.failedTender.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      companyId: true,
      tenderId: true,
      articleCodes: true,
      tenderItems: true,
      objectDescription: true,
    },
  })

  const stale = rows.filter((row) => {
    const items = Array.isArray(row.tenderItems) ? row.tenderItems : []
    return items.length === 0 || row.articleCodes.length === 0 || row.objectDescription === null
  })

  console.log(
    `[CRIBAL][NICHOS] Backfill: ${stale.length}/${rows.length} fallos a re-enriquecer`
  )

  const affectedCompanies = new Set<string>()

  for (const row of stale) {
    await delay(500)
    const enriched = await enrichFailure(row.tenderId)
    await prisma.failedTender.update({
      where: { id: row.id },
      data: {
        articleCodes: enriched.articleCodes,
        tenderItems: enriched.tenderItems as unknown as Prisma.InputJsonValue,
        objectDescription: enriched.objectDescription,
      },
    })
    affectedCompanies.add(row.companyId)
    console.log(
      `[CRIBAL][NICHOS] ${row.tenderId} → ${enriched.articleCodes.length} código(s), objeto: ${
        enriched.objectDescription ? 'sí' : 'no'
      }`
    )
  }

  for (const companyId of affectedCompanies) {
    const count = await recomputeNiches(companyId)
    console.log(`[CRIBAL][NICHOS] ${companyId}: ${count} nicho(s) recomputados`)
  }

  console.log('[CRIBAL][NICHOS] Backfill completado')
}

main()
  .catch((error) => {
    console.error('[CRIBAL][NICHOS] Backfill falló:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
