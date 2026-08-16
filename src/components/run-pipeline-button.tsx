'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, type ButtonVariant } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { triggerRun } from '@/lib/actions/runs'

interface RunPipelineButtonProps {
  label?: string
  variant?: ButtonVariant
}

export function RunPipelineButton({
  label = 'Correr la criba ahora',
  variant = 'primary',
}: RunPipelineButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await triggerRun()
        setToast({ message: result.message, type: 'success' })
        // Give the background run a moment, then refresh server data.
        setTimeout(() => router.refresh(), 1500)
      } catch {
        setToast({ message: 'No se pudo iniciar la criba', type: 'error' })
      }
    })
  }

  return (
    <>
      <Button variant={variant} onClick={handleClick} disabled={isPending}>
        {isPending ? (
          'Iniciando…'
        ) : (
          <>
            <i className="ti ti-player-play" aria-hidden />
            {label}
          </>
        )}
      </Button>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </>
  )
}
