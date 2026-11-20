'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ButtonVariant } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { triggerRun, getLatestRunStatus } from '@/lib/actions/runs'
import { cn } from '@/lib/cn'

type RunState = 'idle' | 'running' | 'done'

// Poll the latest run's outcome for up to ~4 minutes after triggering.
const POLL_INTERVAL_MS = 4_000
const POLL_MAX_ATTEMPTS = 60

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface RunPipelineButtonProps {
  label?: string
  // Kept for API compatibility; the button owns its own state-based styling.
  variant?: ButtonVariant
}

const BASE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed'

export function RunPipelineButton({ label = 'Correr la criba ahora' }: RunPipelineButtonProps) {
  const router = useRouter()
  const [state, setState] = useState<RunState>('idle')
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  async function handleRun() {
    if (state !== 'idle') return
    setState('running')
    const clickedAt = Date.now()
    try {
      await triggerRun()
    } catch {
      setState('idle')
      setToast({ message: 'No se pudo iniciar la criba', type: 'error' })
      return
    }

    // The run is asynchronous; poll its outcome so a failed run reports "ARCE no
    // respondió" rather than silently looking like "0 oportunidades nuevas".
    try {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await wait(POLL_INTERVAL_MS)
        const latest = await getLatestRunStatus()
        // A run of ours that has finished since we clicked.
        const finishedForUs =
          latest?.finishedAt && new Date(latest.finishedAt).getTime() >= clickedAt - 2000
        if (!finishedForUs) continue

        if (latest.status === 'FAILED') {
          setToast({ message: 'ARCE no respondió. Probá de nuevo más tarde.', type: 'error' })
        } else if (latest.status === 'PARTIAL') {
          setToast({
            message: 'Algunos feeds de ARCE no respondieron. Reintentaremos en la próxima corrida.',
            type: 'error',
          })
        } else {
          setToast({ message: 'Criba completada.', type: 'success' })
        }
        break
      }
    } catch {
      // Polling is best-effort; the dashboard banner still reflects the outcome.
    } finally {
      setState('idle')
      router.refresh()
    }
  }

  const stateClass =
    state === 'done'
      ? 'bg-[#10b981]'
      : state === 'running'
        ? 'bg-[#06b6d4] opacity-60'
        : 'bg-[#06b6d4] hover:bg-[#0891b2] active:scale-[0.98]'

  return (
    <>
      <button
        type="button"
        onClick={handleRun}
        disabled={state !== 'idle'}
        className={cn(BASE_CLASS, stateClass)}
      >
        {state === 'running' && (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Ejecutando…
          </>
        )}
        {state === 'done' && (
          <>
            <i className="ti ti-check" aria-hidden />
            Criba iniciada
          </>
        )}
        {state === 'idle' && (
          <>
            <i className="ti ti-player-play" aria-hidden />
            {label}
          </>
        )}
      </button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}
