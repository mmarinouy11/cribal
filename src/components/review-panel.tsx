'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { OpportunityStatus } from '@prisma/client'
import { STATUS_OPTIONS, StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { updateOpportunityReview } from '@/lib/actions/opportunities'

interface ReviewPanelProps {
  id: string
  status: OpportunityStatus
  owner: string | null
  nextAction: string | null
  nextFollowUpDate: string | null // ISO date string (yyyy-mm-dd) or null
  notes: string | null
}

export function ReviewPanel({
  id,
  status,
  owner,
  nextAction,
  nextFollowUpDate,
  notes,
}: ReviewPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  const [form, setForm] = useState({
    status,
    owner: owner ?? '',
    nextAction: nextAction ?? '',
    nextFollowUpDate: nextFollowUpDate ?? '',
    notes: notes ?? '',
  })

  function handleSave() {
    startTransition(async () => {
      try {
        await updateOpportunityReview(id, {
          status: form.status,
          owner: form.owner,
          nextAction: form.nextAction,
          nextFollowUpDate: form.nextFollowUpDate
            ? new Date(form.nextFollowUpDate)
            : null,
          notes: form.notes,
        })
        setToast({ message: 'Cambios guardados', type: 'success' })
        router.refresh()
      } catch {
        setToast({ message: 'No se pudieron guardar los cambios', type: 'error' })
      }
    })
  }

  const inputClass =
    'w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-sm text-[#111827] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb]'
  const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6b7280]'

  return (
    <div className="space-y-4">
      <div>
        <span className={labelClass}>Estado actual</span>
        <StatusBadge status={form.status} />
      </div>

      <div>
        <label htmlFor="status" className={labelClass}>
          Cambiar estado
        </label>
        <select
          id="status"
          value={form.status}
          onChange={(e) =>
            setForm({ ...form, status: e.target.value as OpportunityStatus })
          }
          className={inputClass}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="owner" className={labelClass}>
          Responsable
        </label>
        <input
          id="owner"
          type="text"
          value={form.owner}
          onChange={(e) => setForm({ ...form, owner: e.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="nextAction" className={labelClass}>
          Próxima acción
        </label>
        <textarea
          id="nextAction"
          rows={3}
          value={form.nextAction}
          onChange={(e) => setForm({ ...form, nextAction: e.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="nextFollowUpDate" className={labelClass}>
          Fecha próximo seguimiento
        </label>
        <input
          id="nextFollowUpDate"
          type="date"
          value={form.nextFollowUpDate}
          onChange={(e) => setForm({ ...form, nextFollowUpDate: e.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notas
        </label>
        <textarea
          id="notes"
          rows={4}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className={inputClass}
        />
      </div>

      <Button onClick={handleSave} disabled={isPending} className="w-full">
        {isPending ? 'Guardando…' : 'Guardar cambios'}
      </Button>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
