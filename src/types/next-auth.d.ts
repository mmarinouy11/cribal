import type { DefaultSession } from 'next-auth'
import type { UserRole } from '@prisma/client'

declare module 'next-auth' {
  interface Session {
    user: {
      companyId: string
      companyName: string
      role: UserRole
    } & DefaultSession['user']
  }

  interface User {
    companyId: string
    companyName: string
    role: UserRole
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    companyId: string
    companyName: string
    role: UserRole
  }
}
