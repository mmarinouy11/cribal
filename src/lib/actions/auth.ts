'use server'

import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { sendWelcomeEmail } from '@/lib/email/welcome'

// Sentinel thrown inside the transaction when the email is already taken, so the
// whole transaction rolls back before any row is committed.
const DUPLICATE_EMAIL = 'DUPLICATE_EMAIL'

// Fallback feed used only when the form supplies no RSS feeds at all.
const FALLBACK_RSS_FEED = 'https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/3'

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
  // Step 3 — AI-generated (or manually adjusted) configuration
  relevantKeywords: string[]
  excludedKeywords: string[]
  excludedProducts: string[]
  rssFeeds: string[]
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

  // 2. Fast, friendly pre-check for an existing email. This is only UX — the
  // authoritative uniqueness guard lives inside the transaction below, so a race
  // between this check and the write can never leave an orphaned company.
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return { success: false, error: 'Ya existe una cuenta con ese email' }
  }

  const minimumScore = Math.min(10, Math.max(5, Math.round(data.minimumScore) || 7))
  const capabilities = data.capabilities.map((c) => c.trim()).filter(Boolean)
  const passwordHash = await bcrypt.hash(data.password, 12)

  // Configuration comes from the form (AI-generated or manually adjusted).
  const cleanList = (list: string[]): string[] => list.map((s) => s.trim()).filter(Boolean)
  const rssFeeds = cleanList(data.rssFeeds)

  // 3-5. Create company, profile and user atomically. Any throw rolls back all
  // three, so a company is never committed without its owning user.
  try {
    await prisma.$transaction(async (tx) => {
      // Enforce email uniqueness first, inside the transaction, so a duplicate
      // (or a race that slipped past the pre-check) aborts before anything is
      // written.
      const clash = await tx.user.findUnique({ where: { email }, select: { id: true } })
      if (clash) throw new Error(DUPLICATE_EMAIL)

      const company = await tx.companyConfig.create({
        data: {
          companyName,
          description: data.description.trim() || null,
          capabilities,
          relevantKeywords: cleanList(data.relevantKeywords),
          excludedKeywords: cleanList(data.excludedKeywords),
          excludedProducts: cleanList(data.excludedProducts),
          minimumScore,
          lookbackDays: 1,
          rssFeeds: rssFeeds.length > 0 ? rssFeeds : [FALLBACK_RSS_FEED],
          notificationEmails: [notificationEmail],
          isActive: true,
          registrationStatus: 'PENDING',
          registeredAt: new Date(),
        },
      })

      // Create the user right after the company (before the profile): the
      // unique-email constraint is the most likely failure, and creating the
      // user here means such a failure rolls the whole transaction back.
      await tx.user.create({
        data: {
          email,
          name: userName,
          passwordHash,
          companyId: company.id,
          role: 'USER',
        },
      })

      await tx.companyProfile.create({
        data: { companyId: company.id },
      })
    })
  } catch (error) {
    // A duplicate email (sentinel, or a P2002 unique violation from a race) gets
    // the friendly message; everything else is a generic failure.
    const isDuplicate =
      (error instanceof Error && error.message === DUPLICATE_EMAIL) ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    if (isDuplicate) {
      return { success: false, error: 'Ya existe una cuenta con ese email' }
    }
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
