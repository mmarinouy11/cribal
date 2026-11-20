'use server'

import type { RunStatus } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { runPipeline } from '@/lib/pipeline'

export async function triggerRun(companyId?: string): Promise<{ message: string }> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')

  const targetCompanyId = companyId ?? session.user.companyId

  // A user may only trigger a run for their own company.
  if (targetCompanyId !== session.user.companyId) {
    throw new Error('No autorizado')
  }

  // Manual runs bypass the cadence check on purpose: call runPipeline directly
  // (not runPipelineAllCompanies). A successful run still updates
  // lastSuccessfulRunAt, which resets the automatic cadence timer.
  // Run in the background — do not await so the action returns immediately.
  runPipeline(targetCompanyId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][ACTION] Error en pipeline (companyId=${targetCompanyId}): ${message}`)
  })

  return { message: 'Criba iniciada' }
}

export interface LatestRunStatus {
  status: RunStatus
  startedAt: string
  finishedAt: string | null
}

/**
 * Latest run status for the caller's company, used by the manual-run button to
 * report the outcome (e.g. "ARCE no respondió") once the background run finishes.
 */
export async function getLatestRunStatus(): Promise<LatestRunStatus | null> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')

  const run = await prisma.run.findFirst({
    where: { companyId: session.user.companyId },
    orderBy: { startedAt: 'desc' },
    select: { status: true, startedAt: true, finishedAt: true },
  })
  if (!run) return null
  return {
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  }
}
