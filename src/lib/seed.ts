import 'dotenv/config'
import { prisma } from './db/prisma'

/**
 * Seed the initial Tenarai LATAM company config. Idempotent: it updates the
 * existing record (matched by companyName) or creates it if missing.
 */
async function seed(): Promise<void> {
  const tenarai = {
    companyName: 'Tenarai LATAM',
    description:
      'Empresa de tecnología y servicios digitales especializada en desarrollo de software, cloud, datos, IA, soporte técnico y servicios gestionados.',
    capabilities: [
      'desarrollo de software',
      'aplicaciones web',
      'aplicaciones mobile',
      'cloud',
      'AWS',
      'Azure',
      'datos y analytics',
      'IA y automatización',
      'soporte técnico',
      'mesa de ayuda',
      'soporte L1 y L2',
      'QA y testing',
      'mantenimiento de aplicaciones',
      'integración de sistemas',
      'servicios gestionados',
      'transformación digital',
      'consultoría TI',
    ],
    relevantKeywords: [] as string[], // Base keywords come from keywordFilter.ts
    excludedKeywords: [] as string[], // Base keywords come from exclusionFilter.ts
    excludedProducts: ['Veeam', 'Zimbra'],
    minimumScore: 7,
    lookbackDays: 1,
    rssFeeds: [
      'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/10',
      'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/3',
      'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/texto/microsoft',
    ],
    notificationEmails: ['marcelo.marino@infogain.com'],
    isActive: true,
  }

  const existing = await prisma.companyConfig.findFirst({
    where: { companyName: tenarai.companyName },
  })

  if (existing) {
    await prisma.companyConfig.update({ where: { id: existing.id }, data: tenarai })
    console.log(`[CRIBAL][SEED] Empresa actualizada: ${tenarai.companyName}`)
  } else {
    await prisma.companyConfig.create({ data: tenarai })
    console.log(`[CRIBAL][SEED] Empresa creada: ${tenarai.companyName}`)
  }
}

seed()
  .catch((error) => {
    console.error('[CRIBAL][SEED] Error:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
