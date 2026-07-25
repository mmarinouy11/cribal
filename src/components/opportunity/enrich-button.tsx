'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { triggerEnrichment } from '@/lib/actions/enrichment'

export function EnrichButton({ opportunityId }: { opportunityId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  function handleClick() {
    startTransition(async () => {
      try {
        await triggerEnrichment(opportunityId)
        setToast({ message: 'Datos actualizados desde ARCE', type: 'success' })
        router.refresh()
      } catch {
        setToast({ message: 'No se pudieron actualizar los datos', type: 'error' })
      }
    })
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? 'Actualizando…' : '🔄 Actualizar datos ARCE'}
      </Button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}
