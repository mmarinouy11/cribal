import { OpportunityStatus } from '@prisma/client'
import { cn } from '@/lib/cn'

interface StatusMeta {
  label: string
  className: string
}

// Spanish label + color per opportunity status (Navy + Cyan brand).
// NUEVA uses an outline style; the rest are filled pills.
export const STATUS_META: Record<OpportunityStatus, StatusMeta> = {
  NUEVA: { label: 'Nueva', className: 'bg-transparent text-[#0e7490] border border-[#06b6d4]' },
  REVISANDO: { label: 'Revisando', className: 'bg-[#fef9c3] text-[#854d0e]' },
  RELEVANTE: { label: 'Relevante', className: 'bg-[#d1fae5] text-[#065f46]' },
  DESCARTADA: { label: 'Descartada', className: 'bg-[#f1f5f9] text-[#94a3b8]' },
  CONTACTADA: { label: 'Contactada', className: 'bg-[#ede9fe] text-[#5b21b6]' },
  NO_FIT: { label: 'No aplica', className: 'bg-[#fee2e2] text-[#991b1b]' },
  ARCHIVADA: { label: 'Archivada', className: 'bg-[#f1f5f9] text-[#94a3b8]' },
}

export const STATUS_OPTIONS: { value: OpportunityStatus; label: string }[] =
  Object.entries(STATUS_META).map(([value, meta]) => ({
    value: value as OpportunityStatus,
    label: meta.label,
  }))

export function StatusBadge({ status }: { status: OpportunityStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        meta.className
      )}
    >
      {meta.label}
    </span>
  )
}
