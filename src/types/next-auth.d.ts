import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      companyId: string
      companyName: string
    } & DefaultSession['user']
  }

  interface User {
    companyId: string
    companyName: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    companyId: string
    companyName: string
  }
}
