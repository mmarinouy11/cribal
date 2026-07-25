import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe auth configuration shared by the middleware and the full auth
 * instance. It must NOT import Prisma, bcrypt, or any Node-only module, since
 * the middleware runs in the Edge Runtime. The Credentials provider (which does
 * use those) is added only in `auth.ts`.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.companyId = user.companyId
        token.companyName = user.companyName
      }
      return token
    },
    session({ session, token }) {
      session.user.companyId = token.companyId as string
      session.user.companyName = token.companyName as string
      return session
    },
  },
} satisfies NextAuthConfig
