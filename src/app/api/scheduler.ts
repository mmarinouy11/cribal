import cron from 'node-cron'
import { runPipelineAllCompanies } from '@/lib/pipeline'

// Monday–Friday at 20:00 Montevideo time. Railway uses its own cron job in
// production; this scheduler is for local development.
cron.schedule(
  '0 20 * * 1-5',
  async () => {
    await runPipelineAllCompanies()
  },
  { timezone: 'America/Montevideo' }
)

console.log('[CRIBAL] Scheduler iniciado — L-V 20:00 Montevideo')
