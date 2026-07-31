'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { updateNicheNotes } from '@/lib/actions/niches'

interface NicheNotesProps {
  nicheId: string
  initialNotes: string
}

/** Editable notes for a niche, saved via a server action. */
export function NicheNotes({ nicheId, initialNotes }: NicheNotesProps) {
  const [notes, setNotes] = useState(initialNotes)
  const [saved, setSaved] = useState(initialNotes)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  const dirty = notes !== saved

  function save() {
    startTransition(async () => {
      try {
        await updateNicheNotes(nicheId, notes)
        setSaved(notes)
        setToast({ message: 'Notas guardadas', type: 'success' })
      } catch {
        setToast({ message: 'No se pudieron guardar las notas', type: 'error' })
      }
    })
  }

  return (
    <div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={5}
        placeholder="Notas internas sobre este nicho…"
        className="w-full rounded-lg border border-[#e0f2fe] bg-white px-3 py-2 text-sm text-[#0c1e3c] focus:border-[#06b6d4] focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <Button variant="secondary" size="sm" onClick={save} disabled={!dirty || isPending}>
          {isPending ? 'Guardando…' : 'Guardar notas'}
        </Button>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
