import cron from 'node-cron'
import { runPipelineAllCompanies } from '@/lib/pipeline'
import { RUN_CRON, RUN_TIME_LABEL, TIME_ZONE } from '@/lib/schedule'

// Monday–Friday at the run hour in Montevideo time. Railway uses its own cron job
// in production; this scheduler is for local development. Both derive the hour
// from src/lib/schedule.ts.
cron.schedule(
  RUN_CRON,
  async () => {
    await runPipelineAllCompanies()
  },
  { timezone: TIME_ZONE }
)

console.log(`[CRIBAL] Scheduler iniciado — L-V ${RUN_TIME_LABEL} ${TIME_ZONE}`)
