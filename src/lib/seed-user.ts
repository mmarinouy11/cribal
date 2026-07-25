import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from './db/prisma'

/**
 * Create (or update) the initial Tenarai user. Idempotent: matched by email.
 * Run with `npx ts-node src/lib/seed-user.ts`.
 */
async function seedUser(): Promise<void> {
  const email = 'marcelo.marino@infogain.com'
  const name = 'Marcelo Marino'
  const password = process.env.SEED_USER_PASSWORD ?? 'cribal2024'

  const company = await prisma.companyConfig.findFirst({
    where: { companyName: 'Tenarai LATAM' },
  })

  if (!company) {
    throw new Error(
      'No se encontró la empresa "Tenarai LATAM". Corré primero `npm run seed`.'
    )
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, companyId: company.id, role: 'ADMIN' },
    create: { email, name, passwordHash, companyId: company.id, role: 'ADMIN' },
  })

  console.log(`[CRIBAL][SEED] Usuario creado: ${email}`)
}

seedUser()
  .catch((error) => {
    console.error('[CRIBAL][SEED] Error:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
