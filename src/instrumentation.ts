// Next.js instrumentation hook — runs once when the server process starts.
// Lives in src/ because this project uses a src directory. Boots the in-process
// pipeline cron (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPipelineCron } = await import('@/lib/pipeline-cron')
    startPipelineCron()
  }
}
