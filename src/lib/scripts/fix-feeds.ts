import 'dotenv/config'
import { prisma } from '../db/prisma'
import { normalizeFeedToFamily } from '../arce/catalog'

/**
 * Normalize every company's stored rssFeeds to family level. ARCE's RSS endpoint
 * only filters by family — subfamily and free-text params are ignored — so this
 * rewrites `/familia/N/subfamilia/M` → `/familia/N`, drops `/texto/{keyword}`
 * feeds (and anything without a family), and deduplicates. Run once in
 * production after deploying the family-only feed fix: `npm run fix:feeds`.
 */
async function main(): Promise<void> {
  const companies = await prisma.companyConfig.findMany({
    select: { id: true, companyName: true, rssFeeds: true },
  })

  let updated = 0
  for (const company of companies) {
    const normalized = [
      ...new Set(
        company.rssFeeds.map(normalizeFeedToFamily).filter((f) => f.includes('/familia/'))
      ),
    ]

    if (JSON.stringify(normalized) === JSON.stringify(company.rssFeeds)) continue

    await prisma.companyConfig.update({
      where: { id: company.id },
      data: { rssFeeds: normalized },
    })
    updated += 1
    console.log(`[CRIBAL] ${company.companyName}: feeds actualizados`)
    console.log(`  Antes:   ${company.rssFeeds.join(', ') || '(vacío)'}`)
    console.log(`  Después: ${normalized.join(', ') || '(vacío)'}`)
  }

  console.log(
    `[CRIBAL] fix:feeds completado — ${updated} de ${companies.length} empresas actualizadas`
  )
}

main()
  .catch((error) => {
    console.error('[CRIBAL] fix:feeds falló:', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
