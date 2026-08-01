import 'dotenv/config'
import { prisma } from '../db/prisma'

/**
 * List companies with no associated users — orphans left by a failed
 * registration. Read-only: prints a table so the condition is detectable without
 * ad-hoc queries. Clean up with `npm run delete:company -- <id> --confirm`.
 */
async function main(): Promise<void> {
  const orphans = await prisma.companyConfig.findMany({
    where: { users: { none: {} } },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: {
        select: { failedTenders: true, niches: true, opportunities: true, runs: true },
      },
    },
  })

  if (orphans.length === 0) {
    console.log('[CRIBAL][AUDIT] No hay empresas sin usuarios.')
    return
  }

  console.log(`[CRIBAL][AUDIT] ${orphans.length} empresa(s) sin usuarios:`)
  for (const company of orphans) {
    console.log(
      `  ${company.id}  "${company.companyName}"  creada ${company.createdAt.toISOString()}\n` +
        `      runs=${company._count.runs} opportunities=${company._count.opportunities} ` +
        `failedTenders=${company._count.failedTenders} niches=${company._count.niches} ` +
        `activa=${company.isActive}`
    )
  }
  console.log(
    '[CRIBAL][AUDIT] Eliminá cada una con: npm run delete:company -- <companyId> --confirm'
  )
}

main()
  .catch((error) => {
    console.error('[CRIBAL][AUDIT] Auditoría falló:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
