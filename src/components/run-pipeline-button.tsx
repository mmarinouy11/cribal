'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ButtonVariant } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { triggerRun } from '@/lib/actions/runs'
import { cn } from '@/lib/cn'

type RunState = 'idle' | 'running' | 'done'

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
    try {
      await triggerRun()
      setState('done')
      // Give the background run a moment, then refresh server data.
      setTimeout(() => router.refresh(), 1500)
      setTimeout(() => setState('idle'), 5000)
    } catch {
      setState('idle')
      setToast({ message: 'No se pudo iniciar la criba', type: 'error' })
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
