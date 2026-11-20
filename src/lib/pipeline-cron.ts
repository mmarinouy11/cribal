import cron from 'node-cron'
import { runPipelineAllCompanies } from '@/lib/pipeline'
import { RUN_CRON } from '@/lib/schedule'

let cronStarted = false

/**
 * Start the in-process pipeline scheduler. Runs inside the Next.js Node server
 * (via instrumentation.ts) so scheduling no longer depends on an external Railway
 * cron service. Idempotent — guarded so it only registers once per process.
 */
export function startPipelineCron() {
  if (cronStarted) {
    console.log('[CRIBAL][CRON] Ya iniciado, omitiendo')
    return
  }
  cronStarted = true

  // Monday–Friday at 11:00 UTC = 08:00 Montevideo (shared with the banner).
  cron.schedule(
    RUN_CRON,
    async () => {
      console.log('[CRIBAL][CRON] Iniciando pipeline automático...')
      try {
        await runPipelineAllCompanies('cron')
      } catch (err) {
        console.error('[CRIBAL][CRON] Error en pipeline automático:', err)
      }
    },
    { timezone: 'UTC' }
  )

  console.log('[CRIBAL][CRON] Scheduler iniciado — L-V 11:00 UTC (08:00 Montevideo)')
}
