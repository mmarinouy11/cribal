'use client'

import { useState, useTransition } from 'react'
import { OpportunityStatus } from '@prisma/client'
import { STATUS_OPTIONS } from '@/components/ui/status-badge'
import { updateOpportunityStatus } from '@/lib/actions/opportunities'

interface StatusSelectProps {
  id: string
  status: OpportunityStatus
}

/** Inline status dropdown with optimistic update via a server action. */
export function StatusSelect({ id, status }: StatusSelectProps) {
  const [current, setCurrent] = useState<OpportunityStatus>(status)
  const [isPending, startTransition] = useTransition()

  function handleChange(next: OpportunityStatus) {
    const previous = current
    setCurrent(next) // Optimistic.
    startTransition(async () => {
      try {
        await updateOpportunityStatus(id, next)
      } catch {
        setCurrent(previous) // Roll back on failure.
      }
    })
  }

  return (
    <select
      value={current}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value as OpportunityStatus)}
      onClick={(e) => e.stopPropagation()}
      className="rounded-lg border border-[#e5e7eb] bg-white px-2 py-1 text-xs text-[#111827] disabled:opacity-60"
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
