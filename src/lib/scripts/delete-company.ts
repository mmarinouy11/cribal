import 'dotenv/config'
import { prisma } from '../db/prisma'

/**
 * Admin-only maintenance script: permanently delete a company and every row that
 * depends on it, in FK-safe order, inside a single transaction. Intended for
 * cleaning up test companies.
 *
 * Usage:
 *   npm run delete:company -- <companyId> --confirm
 *
 * Without --confirm it prints what would be deleted and refuses to act.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const confirm = args.includes('--confirm')
  const companyId = args.find((arg) => !arg.startsWith('--'))

  if (!companyId) {
    console.error('Uso: npm run delete:company -- <companyId> --confirm')
    process.exitCode = 1
    return
  }

  const company = await prisma.companyConfig.findUnique({
    where: { id: companyId },
    select: { id: true, companyName: true },
  })
  if (!company) {
    console.error(`[CRIBAL][ADMIN] Empresa ${companyId} no encontrada`)
    process.exitCode = 1
    return
  }

  if (!confirm) {
    console.log(
      `[CRIBAL][ADMIN] Se eliminaría la empresa "${company.companyName}" (${company.id}) y TODOS sus datos.`
    )
    console.log('[CRIBAL][ADMIN] Volvé a correr con --confirm para ejecutar la eliminación.')
    return
  }

  // Delete children before parents to satisfy foreign keys. Everything runs in
  // one transaction so a mid-way failure rolls back cleanly.
  const summary = await prisma.$transaction(
    async (tx) => {
      const proposals = await tx.proposal.deleteMany({ where: { companyId } })
      const marketAnalyses = await tx.marketAnalysis.deleteMany({ where: { companyId } })
      const opportunities = await tx.opportunity.deleteMany({ where: { companyId } })
      const rawPublications = await tx.rawPublication.deleteMany({
        where: { run: { companyId } },
      })
      const runs = await tx.run.deleteMany({ where: { companyId } })
      const failedTenders = await tx.failedTender.deleteMany({ where: { companyId } })
      const niches = await tx.niche.deleteMany({ where: { companyId } })
      const profiles = await tx.companyProfile.deleteMany({ where: { companyId } })
      const users = await tx.user.deleteMany({ where: { companyId } })
      await tx.companyConfig.delete({ where: { id: companyId } })

      return {
        proposals: proposals.count,
        marketAnalyses: marketAnalyses.count,
        opportunities: opportunities.count,
        rawPublications: rawPublications.count,
        runs: runs.count,
        failedTenders: failedTenders.count,
        niches: niches.count,
        profiles: profiles.count,
        users: users.count,
      }
    },
    { timeout: 60000 }
  )

  console.log(`[CRIBAL][ADMIN] Empresa "${company.companyName}" (${company.id}) eliminada.`)
  console.log('[CRIBAL][ADMIN] Filas eliminadas:')
  console.log(`  proposals:        ${summary.proposals}`)
  console.log(`  market_analyses:  ${summary.marketAnalyses}`)
  console.log(`  opportunities:    ${summary.opportunities}`)
  console.log(`  raw_publications: ${summary.rawPublications}`)
  console.log(`  runs:             ${summary.runs}`)
  console.log(`  failed_tenders:   ${summary.failedTenders}`)
  console.log(`  niches:           ${summary.niches}`)
  console.log(`  company_profiles: ${summary.profiles}`)
  console.log(`  users:            ${summary.users}`)
  console.log('  company_configs:  1')
}

main()
  .catch((error) => {
    console.error('[CRIBAL][ADMIN] Eliminación falló:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
