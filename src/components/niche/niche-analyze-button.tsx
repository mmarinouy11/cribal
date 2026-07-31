'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { analyzeNiche } from '@/lib/actions/niches'

interface NicheAnalyzeButtonProps {
  nicheId: string
  hasAnalysis: boolean
}

/** Triggers the on-demand AI analysis of a niche, like the market analysis. */
export function NicheAnalyzeButton({ nicheId, hasAnalysis }: NicheAnalyzeButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  function run() {
    startTransition(async () => {
      const result = await analyzeNiche(nicheId)
      if (result.success) {
        setToast({ message: 'Análisis del nicho completado', type: 'success' })
        router.refresh()
      } else {
        setToast({ message: result.error ?? 'No se pudo analizar el nicho', type: 'error' })
      }
    })
  }

  return (
    <>
      <Button variant={hasAnalysis ? 'secondary' : 'primary'} onClick={run} disabled={isPending}>
        {isPending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Analizando…
          </>
        ) : (
          <>
            <i className="ti ti-sparkles" aria-hidden />
            {hasAnalysis ? 'Regenerar análisis' : 'Analizar nicho con IA'}
          </>
        )}
      </Button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}
