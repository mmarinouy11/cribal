import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { runPipeline, runPipelineAllCompanies } from '@/lib/pipeline'

// The pipeline calls external services (RSS, Claude, Resend), so keep this on
// the Node.js runtime rather than the Edge runtime.
export const runtime = 'nodejs'

interface PostBody {
  companyId?: string
}

/**
 * POST /api/runs — trigger a pipeline run. With a companyId it runs that
 * company only; without one it runs every active company. The pipeline runs
 * in the background so the request returns immediately.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: PostBody = {}
  try {
    body = (await request.json()) as PostBody
  } catch {
    // Empty or invalid body is fine — default to running all companies.
    body = {}
  }

  const companyId = body.companyId ?? null

  // Fire and forget: do not await so the response returns immediately.
  if (companyId) {
    void runPipeline(companyId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][API] Error en pipeline (companyId=${companyId}): ${message}`)
    })
  } else {
    void runPipelineAllCompanies().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][API] Error en pipeline de todas las empresas: ${message}`)
    })
  }

  return NextResponse.json({ message: 'Pipeline iniciado', companyId }, { status: 200 })
}

/**
 * GET /api/runs?companyId=xxx&limit=10 — return run history with all counters,
 * ordered by startedAt descending.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get('companyId')
  const limitParam = searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 10

  const where: Prisma.RunWhereInput = companyId ? { companyId } : {}

  const runs = await prisma.run.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({ runs })
}
