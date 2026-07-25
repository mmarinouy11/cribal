'use server'

import { auth } from '@/lib/auth'
import { runPipeline } from '@/lib/pipeline'

export async function triggerRun(companyId?: string): Promise<{ message: string }> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')

  const targetCompanyId = companyId ?? session.user.companyId

  // A user may only trigger a run for their own company.
  if (targetCompanyId !== session.user.companyId) {
    throw new Error('No autorizado')
  }

  // Run in the background — do not await so the action returns immediately.
  runPipeline(targetCompanyId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][ACTION] Error en pipeline (companyId=${targetCompanyId}): ${message}`)
  })

  return { message: 'Pipeline iniciado' }
}
