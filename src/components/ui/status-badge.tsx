import { OpportunityStatus } from '@prisma/client'
import { Badge } from './badge'

interface StatusMeta {
  label: string
  className: string
}

// Spanish label + color per opportunity status.
export const STATUS_META: Record<OpportunityStatus, StatusMeta> = {
  NUEVA: { label: 'Nueva', className: 'bg-blue-100 text-blue-700' },
  REVISANDO: { label: 'Revisando', className: 'bg-amber-100 text-amber-700' },
  RELEVANTE: { label: 'Relevante', className: 'bg-green-100 text-green-700' },
  DESCARTADA: { label: 'Descartada', className: 'bg-gray-100 text-gray-600' },
  CONTACTADA: { label: 'Contactada', className: 'bg-indigo-100 text-indigo-700' },
  NO_FIT: { label: 'No aplica', className: 'bg-red-100 text-red-700' },
  ARCHIVADA: { label: 'Archivada', className: 'bg-gray-100 text-gray-500' },
}

export const STATUS_OPTIONS: { value: OpportunityStatus; label: string }[] =
  Object.entries(STATUS_META).map(([value, meta]) => ({
    value: value as OpportunityStatus,
    label: meta.label,
  }))

export function StatusBadge({ status }: { status: OpportunityStatus }) {
  const meta = STATUS_META[status]
  return <Badge className={meta.className}>{meta.label}</Badge>
}
