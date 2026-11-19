import 'dotenv/config'
import he from 'he'
import { prisma } from '../db/prisma'

/**
 * Repair catalog article names in place: decode any leftover HTML entities
 * (e.g. "DISE&Ntilde;O" → "DISEÑO", "&acute;" → "´"). Reads and updates the DB
 * only — no Playwright, no ARCE access, nothing under /app/data touched.
 *
 * Idempotent: only rows whose decoded name differs are written, so a second run
 * changes nothing. Run with: npm run fix:catalog:names
 */
async function main(): Promise<void> {
  const rows = await prisma.catalogArticle.findMany({ select: { id: true, name: true } })

  const changes: { id: number; before: string; after: string }[] = []
  for (const row of rows) {
    const decoded = he.decode(row.name).trim()
    if (decoded && decoded !== row.name) {
      changes.push({ id: row.id, before: row.name, after: decoded })
    }
  }

  // Apply the updates (small set relative to the table).
  for (const change of changes) {
    await prisma.catalogArticle.update({
      where: { id: change.id },
      data: { name: change.after },
    })
  }

  console.log(`[CRIBAL][FIX-NAMES] Filas revisadas: ${rows.length}`)
  console.log(`[CRIBAL][FIX-NAMES] Filas modificadas: ${changes.length}`)

  const examples = changes.slice(0, 10)
  if (examples.length > 0) {
    console.log('[CRIBAL][FIX-NAMES] Ejemplos (antes → después):')
    for (const ex of examples) {
      console.log(`[CRIBAL][FIX-NAMES]   [${ex.id}] "${ex.before}" → "${ex.after}"`)
    }
  }
}

main()
  .catch((error) => {
    console.error('[CRIBAL][FIX-NAMES] Falló:', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
