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
    registrationStatus: 'ACTIVE' as const,
    registeredAt: new Date(),
  }

  const existing = await prisma.companyConfig.findFirst({
    where: { companyName: tenarai.companyName },
  })

  let companyId: string
  if (existing) {
    await prisma.companyConfig.update({ where: { id: existing.id }, data: tenarai })
    companyId = existing.id
    console.log(`[CRIBAL][SEED] Empresa actualizada: ${tenarai.companyName}`)
  } else {
    const created = await prisma.companyConfig.create({ data: tenarai })
    companyId = created.id
    console.log(`[CRIBAL][SEED] Empresa creada: ${tenarai.companyName}`)
  }

  const profile = {
    longDescription:
      'Tenarai LATAM es una empresa de tecnología y servicios digitales con presencia en Uruguay y operaciones nearshore para el mercado norteamericano. Especializada en desarrollo de software, servicios de soporte técnico gestionado, transformación digital y soluciones de datos e inteligencia artificial.',
    teamSize: '50-200 personas',
    caseStudies:
      'Desarrollo e implementación de plataformas digitales para empresas del Fortune 500. Operación de mesas de ayuda L1/L2 con SLAs garantizados para clientes en industrias de retail, fintech y salud.',
    differentiators:
      'Equipo bilingüe español/inglés. Experiencia en proyectos de Estado uruguayo. Metodologías ágiles certificadas. Disponibilidad 24/7 para servicios de soporte.',
    certifications: 'CMMI, ISO 27001',
  }

  await prisma.companyProfile.upsert({
    where: { companyId },
    create: { companyId, ...profile },
    update: profile,
  })
  console.log(`[CRIBAL][SEED] Perfil actualizado: ${tenarai.companyName}`)
}

seed()
  .catch((error) => {
    console.error('[CRIBAL][SEED] Error:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
