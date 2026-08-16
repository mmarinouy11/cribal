'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { OpportunityStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { Toast, type ToastType } from '@/components/ui/toast'
import { advanceOpportunity, dismissOpportunity } from '@/lib/actions/opportunities'

type AdvanceTarget = 'REVISANDO' | 'RELEVANTE' | 'OFERTADA' | 'ARCHIVADA' | 'NUEVA'

interface OpportunityActionsProps {
  id: string
  status: OpportunityStatus
  closingHasPassed: boolean
}

const DISMISS_REASONS = [
  'No es nuestro rubro',
  'Requisitos técnicos que no cumplimos',
  'Precio estimado fuera de mercado',
  'Plazo de ejecución inviable',
  'Ya tiene un proveedor establecido',
  'Otro motivo',
]

export function OpportunityActions({ id, status, closingHasPassed }: OpportunityActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')

  function advance(target: AdvanceTarget) {
    startTransition(async () => {
      try {
        await advanceOpportunity(id, target)
        router.refresh()
      } catch {
        setToast({ message: 'No se pudo actualizar la oportunidad', type: 'error' })
      }
    })
  }

  function confirmDismiss() {
    if (!reason) return
    startTransition(async () => {
      try {
        await dismissOpportunity(id, reason, comment)
        setDialogOpen(false)
        setReason('')
        setComment('')
        router.refresh()
      } catch {
        setToast({ message: 'No se pudo desestimar la oportunidad', type: 'error' })
      }
    })
  }

  const dismissButton = (
    <Button variant="secondary" onClick={() => setDialogOpen(true)} disabled={isPending}>
      <i className="ti ti-x" aria-hidden />
      Desestimar
    </Button>
  )

  function renderButtons() {
    switch (status) {
      case 'NUEVA':
        return (
          <>
            <Button onClick={() => advance('REVISANDO')} disabled={isPending}>
              <i className="ti ti-eye" aria-hidden />
              Seguir esta oportunidad
            </Button>
            {dismissButton}
          </>
        )
      case 'REVISANDO':
        return (
          <>
            <Button onClick={() => advance('RELEVANTE')} disabled={isPending}>
              <i className="ti ti-check" aria-hidden />
              Tomar oportunidad
            </Button>
            {dismissButton}
          </>
        )
      case 'RELEVANTE':
      case 'CONTACTADA':
        return (
          <>
            <Button onClick={() => advance('OFERTADA')} disabled={isPending}>
              <i className="ti ti-send" aria-hidden />
              Marcar como ofertada
            </Button>
            {dismissButton}
          </>
        )
      case 'OFERTADA':
        return closingHasPassed ? (
          <Button onClick={() => advance('ARCHIVADA')} disabled={isPending}>
            <i className="ti ti-archive" aria-hidden />
            Archivar
          </Button>
        ) : (
          <span className="text-sm text-[#6b7280]">
            Podrás archivarla una vez que cierre el llamado.
          </span>
        )
      case 'DESCARTADA':
      case 'ARCHIVADA':
      case 'NO_FIT':
        return (
          <Button variant="secondary" onClick={() => advance('NUEVA')} disabled={isPending}>
            <i className="ti ti-arrow-back-up" aria-hidden />
            Reabrir
          </Button>
        )
      default:
        return null
    }
  }

  return (
    <div className="rounded-xl border border-[#e0f2fe] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
            Estado
          </span>
          <StatusBadge status={status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">{renderButtons()}</div>
      </div>

      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !isPending && setDialogOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[#0c1e3c]">Desestimar oportunidad</h3>
            <p className="mt-1 text-sm text-[#6b7280]">¿Por qué descartás esta oportunidad?</p>

            <div className="mt-4 space-y-2">
              {DISMISS_REASONS.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-2 text-sm text-[#0c1e3c]">
                  <input
                    type="radio"
                    name="dismiss-reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="accent-[#06b6d4]"
                  />
                  {r}
                </label>
              ))}
            </div>

            <label className="mt-4 block text-sm font-medium text-[#6b7280]">
              Comentarios adicionales (opcional)
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] focus:border-[#06b6d4] focus:outline-none"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setDialogOpen(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button variant="danger" onClick={confirmDismiss} disabled={isPending || !reason}>
                Desestimar oportunidad
              </Button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
