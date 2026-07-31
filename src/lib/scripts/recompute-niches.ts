import 'dotenv/config'
import { prisma } from '../db/prisma'
import { recomputeNiches } from '../pipeline/niches'

/**
 * Recompute niches for every company. Run once after deploying the orphan-cleanup
 * fix to clear the duplicate niches left by the earlier backfill (each affected
 * failure moved to a new article-code niche while its old articleCode=null niche
 * survived). Idempotent.
 */
async function main(): Promise<void> {
  const companies = await prisma.companyConfig.findMany({ select: { id: true, companyName: true } })
  console.log(`[CRIBAL][NICHOS] Recomputando nichos para ${companies.length} empresa(s)`)

  for (const company of companies) {
    const count = await recomputeNiches(company.id)
    console.log(`[CRIBAL][NICHOS] ${company.companyName}: ${count} nicho(s)`)
  }

  console.log('[CRIBAL][NICHOS] Recompute completado')
}

main()
  .catch((error) => {
    console.error('[CRIBAL][NICHOS] Recompute falló:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
