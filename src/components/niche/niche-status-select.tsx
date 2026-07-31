'use client'

import { useState, useTransition } from 'react'
import { NicheStatus } from '@prisma/client'
import { NICHE_STATUS_OPTIONS } from './niche-badges'
import { updateNicheStatus } from '@/lib/actions/niches'

interface NicheStatusSelectProps {
  id: string
  status: NicheStatus
}

/** Inline niche status dropdown with optimistic update via a server action. */
export function NicheStatusSelect({ id, status }: NicheStatusSelectProps) {
  const [current, setCurrent] = useState<NicheStatus>(status)
  const [isPending, startTransition] = useTransition()

  function handleChange(next: NicheStatus) {
    const previous = current
    setCurrent(next) // Optimistic.
    startTransition(async () => {
      try {
        await updateNicheStatus(id, next)
      } catch {
        setCurrent(previous) // Roll back on failure.
      }
    })
  }

  return (
    <select
      value={current}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value as NicheStatus)}
      onClick={(e) => e.stopPropagation()}
      className="rounded-lg border border-[#e0f2fe] bg-white px-2 py-1 text-xs text-[#0c1e3c] disabled:opacity-60"
    >
      {NICHE_STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
