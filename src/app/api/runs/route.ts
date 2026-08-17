import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { runPipeline, runPipelineAllCompanies } from '@/lib/pipeline'

// The pipeline calls external services (RSS, Claude, Resend), so keep this on
// the Node.js runtime rather than the Edge runtime.
export const runtime = 'nodejs'

interface PostBody {
  companyId?: string
}

/**
 * POST /api/runs — trigger a pipeline run. Two valid callers:
 *  1. Railway cron (Bearer CRON_SECRET) → runs every active company.
 *  2. Authenticated dashboard user → runs their own company (admins: any).
 * The pipeline always runs in the background so the request returns fast.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // 1. Cron token.
  const authHeader = request.headers.get('authorization')
  const cronToken = process.env.CRON_SECRET

  if (cronToken && authHeader === `Bearer ${cronToken}`) {
    void runPipelineAllCompanies('cron').catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][CRON] Error en pipeline: ${message}`)
    })
    return NextResponse.json({ message: 'Criba iniciada para todas las empresas' })
  }

  // 2. Session.
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  let body: PostBody = {}
  try {
    body = (await request.json()) as PostBody
  } catch {
    body = {}
  }

  const companyId = body.companyId ?? session.user.companyId

  // A user may only trigger their own company; admins may trigger any.
  if (companyId !== session.user.companyId && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  void runPipeline(companyId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][API] Error en pipeline (companyId=${companyId}): ${message}`)
  })

  return NextResponse.json({ message: 'Criba iniciada', companyId })
}

/**
 * GET /api/runs?companyId=xxx&limit=10 — run history with all counters, ordered
 * by startedAt descending. Regular users only see their own company; admins may
 * pass a companyId to see any company, or omit it to see all.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const requestedCompanyId = searchParams.get('companyId')
  const limitParam = searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 10

  const isAdmin = session.user.role === 'ADMIN'

  let where: Prisma.RunWhereInput
  if (isAdmin) {
    // Admins: filter by the requested company, or see all when none is given.
    where = requestedCompanyId ? { companyId: requestedCompanyId } : {}
  } else {
    // Regular users: always scoped to their own company.
    where = { companyId: session.user.companyId }
  }

  const runs = await prisma.run.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({ runs })
}
