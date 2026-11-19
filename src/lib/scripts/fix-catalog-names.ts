import 'dotenv/config'
import he from 'he'
import { prisma } from '../db/prisma'
import { normalizeText } from '../text/normalize'

/**
 * Repair catalog article names in place and (re)fill their search index:
 * decode any leftover HTML entities (e.g. "DISE&Ntilde;O" → "DISEÑO",
 * "&acute;" → "´") and recompute `nameNorm` from the decoded name. Reads and
 * updates the DB only — no Playwright, no ARCE access, nothing under /app/data.
 *
 * Idempotent: a row is written only when its decoded name or its nameNorm
 * actually changes, so a second run changes nothing. Run with:
 *   npm run fix:catalog:names
 */
async function main(): Promise<void> {
  const rows = await prisma.catalogArticle.findMany({
    select: { id: true, name: true, nameNorm: true },
  })

  const changes: { id: number; before: string; after: string; nameNorm: string }[] = []
  for (const row of rows) {
    const decoded = he.decode(row.name).trim()
    const nameNorm = normalizeText(decoded)
    const nameChanged = decoded && decoded !== row.name
    const normChanged = nameNorm !== row.nameNorm
    if (nameChanged || normChanged) {
      changes.push({ id: row.id, before: row.name, after: decoded || row.name, nameNorm })
    }
  }

  // Apply the updates (small set relative to the table).
  for (const change of changes) {
    await prisma.catalogArticle.update({
      where: { id: change.id },
      data: { name: change.after, nameNorm: change.nameNorm },
    })
  }

  const nameChanges = changes.filter((c) => c.before !== c.after)
  console.log(`[CRIBAL][FIX-NAMES] Filas revisadas: ${rows.length}`)
  console.log(`[CRIBAL][FIX-NAMES] Filas modificadas: ${changes.length}`)
  console.log(`[CRIBAL][FIX-NAMES]   de las cuales con nombre decodificado: ${nameChanges.length}`)

  // Prefer showing decoded-name examples; fall back to nameNorm-only changes.
  const examples = (nameChanges.length > 0 ? nameChanges : changes).slice(0, 10)
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
