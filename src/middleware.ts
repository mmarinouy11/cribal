import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/lib/auth.config'

// Edge-safe auth instance: uses only authConfig (no Prisma/bcrypt), so the
// middleware can run in the Edge Runtime.
const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const { pathname } = req.nextUrl
  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/api/auth')

  // Let Bearer-token requests to /api/runs through so the route handler can
  // validate the CRON_SECRET itself (the middleware can't, and has no session
  // for cron callers). Without a Bearer header /api/runs still falls through to
  // the session check below, so session-based access is unchanged.
  const authHeader = req.headers.get('authorization')
  const isCronRun =
    pathname.startsWith('/api/runs') && authHeader?.startsWith('Bearer ') === true

  if (!isLoggedIn && !isAuthRoute && !isCronRun) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
