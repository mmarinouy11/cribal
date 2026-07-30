import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db/prisma'
import { authConfig } from '@/lib/auth.config'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        // Emails are stored normalized at registration/seed
        // (trim + lowercase). Normalize the lookup the same way so a different
        // capitalization or a stray trailing space doesn't miss the user.
        const email = (credentials.email as string).trim().toLowerCase()

        try {
          const user = await prisma.user.findUnique({
            where: { email },
            include: { company: true },
          })

          if (!user) {
            console.warn(`[CRIBAL][AUTH] Login rechazado: usuario no encontrado (${email})`)
            return null
          }

          const valid = await bcrypt.compare(
            credentials.password as string,
            user.passwordHash
          )

          if (!valid) {
            console.warn(`[CRIBAL][AUTH] Login rechazado: contraseña inválida (${email})`)
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            companyId: user.companyId,
            companyName: user.company?.companyName ?? '',
            role: user.role,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[CRIBAL][AUTH] Error en authorize (${email}): ${message}`)
          return null
        }
      },
    }),
  ],
})
