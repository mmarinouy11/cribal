'use server'

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { RegistrationStatus, UserRole } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { runPipeline, runPipelineAllCompanies } from '@/lib/pipeline'
import { sendPasswordResetEmail } from '@/lib/email/password-reset'

async function requireAdmin(): Promise<void> {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    throw new Error('No autorizado')
  }
}

function isValidRegistrationStatus(value: string): value is RegistrationStatus {
  return Object.values(RegistrationStatus).includes(value as RegistrationStatus)
}

export async function setCompanyRegistrationStatus(
  companyId: string,
  status: string
): Promise<void> {
  await requireAdmin()
  if (!isValidRegistrationStatus(status)) throw new Error('Estado inválido')

  await prisma.companyConfig.update({
    where: { id: companyId },
    // Suspended companies are also excluded from scheduled runs.
    data: { registrationStatus: status, isActive: status !== 'SUSPENDED' },
  })

  revalidatePath('/admin')
}

export async function setUserRole(userId: string, role: string): Promise<void> {
  await requireAdmin()
  if (!Object.values(UserRole).includes(role as UserRole)) {
    throw new Error('Rol inválido')
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role: role as UserRole },
  })

  revalidatePath('/admin')
}

export async function resetUserPassword(userId: string): Promise<void> {
  await requireAdmin()

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('Usuario no encontrado')

  // Generate a URL-safe temporary password.
  const tempPassword = randomBytes(9).toString('base64url')
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  await prisma.user.update({ where: { id: userId }, data: { passwordHash } })

  try {
    await sendPasswordResetEmail({
      to: user.email,
      userName: user.name ?? user.email,
      tempPassword,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][ADMIN] Error enviando reseteo a ${user.email}: ${message}`)
    throw new Error('La contraseña se restableció pero el email no pudo enviarse')
  }

  revalidatePath('/admin')
}

export async function triggerCompanyPipeline(companyId: string): Promise<void> {
  await requireAdmin()

  runPipeline(companyId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][ADMIN] Error en pipeline (companyId=${companyId}): ${message}`)
  })
}

export async function triggerAllPipelines(): Promise<void> {
  await requireAdmin()

  runPipelineAllCompanies('manual').catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][ADMIN] Error en pipeline de todas las empresas: ${message}`)
  })
}
