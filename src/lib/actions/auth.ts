'use server'

import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db/prisma'
import { BASE_EXCLUSION_KEYWORDS } from '@/lib/pipeline/exclusionFilter'
import { sendWelcomeEmail } from '@/lib/email/welcome'

// The three ARCE feeds used as sensible defaults for every new company.
const DEFAULT_RSS_FEEDS = [
  'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/10',
  'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/3',
  'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/texto/microsoft',
]

export interface RegisterCompanyInput {
  // Step 1
  companyName: string
  description: string
  // Step 2
  userName: string
  email: string
  password: string
  // Step 3
  capabilities: string[]
  minimumScore: number
  notificationEmail: string
}

export interface RegisterCompanyResult {
  success: boolean
  error?: string
}

export async function registerCompany(
  data: RegisterCompanyInput
): Promise<RegisterCompanyResult> {
  // 1. Validate required fields.
  const companyName = data.companyName.trim()
  const userName = data.userName.trim()
  const email = data.email.trim().toLowerCase()
  const notificationEmail = (data.notificationEmail || email).trim().toLowerCase()

  if (!companyName) return { success: false, error: 'El nombre de la empresa es obligatorio' }
  if (!userName) return { success: false, error: 'Tu nombre es obligatorio' }
  if (!email) return { success: false, error: 'El email es obligatorio' }
  if (!data.password || data.password.length < 8) {
    return { success: false, error: 'La contraseña debe tener al menos 8 caracteres' }
  }

  // 2. Email must not already be in use.
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return { success: false, error: 'Ya existe una cuenta con ese email' }
  }

  const minimumScore = Math.min(10, Math.max(5, Math.round(data.minimumScore) || 7))
  const capabilities = data.capabilities.map((c) => c.trim()).filter(Boolean)
  const passwordHash = await bcrypt.hash(data.password, 12)

  // 3-5. Create company, profile and user atomically.
  try {
    await prisma.$transaction(async (tx) => {
      const company = await tx.companyConfig.create({
        data: {
          companyName,
          description: data.description.trim() || null,
          capabilities,
          relevantKeywords: [],
          excludedKeywords: BASE_EXCLUSION_KEYWORDS,
          excludedProducts: [],
          minimumScore,
          lookbackDays: 1,
          rssFeeds: DEFAULT_RSS_FEEDS,
          notificationEmails: [notificationEmail],
          isActive: true,
          registrationStatus: 'PENDING',
          registeredAt: new Date(),
        },
      })

      await tx.companyProfile.create({
        data: { companyId: company.id },
      })

      await tx.user.create({
        data: {
          email,
          name: userName,
          passwordHash,
          companyId: company.id,
          role: 'USER',
        },
      })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][REGISTER] Error creando cuenta para ${email}: ${message}`)
    return { success: false, error: 'No se pudo crear la cuenta. Intentá nuevamente.' }
  }

  // 6. Welcome email — failure here must not fail the registration.
  try {
    await sendWelcomeEmail({ to: email, userName, companyName })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][REGISTER] Error enviando email de bienvenida a ${email}: ${message}`)
  }

  console.log(`[CRIBAL][REGISTER] Cuenta creada: ${email} (${companyName})`)
  return { success: true }
}
