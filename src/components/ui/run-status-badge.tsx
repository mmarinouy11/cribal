import { RunStatus } from '@prisma/client'
import { Badge } from './badge'

interface RunStatusMeta {
  label: string
  className: string
}

export const RUN_STATUS_META: Record<RunStatus, RunStatusMeta> = {
  RUNNING: { label: 'Corriendo', className: 'bg-amber-100 text-amber-700' },
  COMPLETED: { label: 'Completada', className: 'bg-[#d1fae5] text-[#065f46]' },
  FAILED: { label: 'Fallida', className: 'bg-red-100 text-red-700' },
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status]
  return (
    <Badge className={meta.className}>
      {status === 'RUNNING' && <span className="mr-1 animate-pulse">●</span>}
      {meta.label}
    </Badge>
  )
}
