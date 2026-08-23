import 'dotenv/config'
import { prisma } from '../db/prisma'
import { enrichOpportunity } from '../scraper/enricher'

/**
 * Re-enrich opportunities whose title contains a given substring. Clears the
 * cached pliegoText so it is re-extracted (needed after the .zip pliego fix),
 * then re-runs the ARCE enrichment to capture the pliegoUrl.
 *
 * Usage: npm run reenrich -- "37/2026"
 */
async function main(): Promise<void> {
  const needle = process.argv[2]
  if (!needle) {
    console.error('[CRIBAL][REENRICH] Falta el argumento de búsqueda. Ej: npm run reenrich -- "37/2026"')
    process.exit(1)
  }

  const opportunities = await prisma.opportunity.findMany({
    where: { title: { contains: needle, mode: 'insensitive' } },
    select: { id: true, title: true },
  })

  if (opportunities.length === 0) {
    console.log(`[CRIBAL][REENRICH] No se encontraron oportunidades con "${needle}"`)
    return
  }

  for (const opp of opportunities) {
    // Force re-extraction of the pliego text on the next conditions/chat use.
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { pliegoText: null },
    })
    console.log(`[CRIBAL][REENRICH] Re-enriqueciendo: ${opp.title}`)
    await enrichOpportunity(opp.id)
  }

  console.log(`[CRIBAL][REENRICH] Completado — ${opportunities.length} oportunidad(es)`)
}

main()
  .catch((error) => {
    console.error('[CRIBAL][REENRICH] Falló:', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
