import { NicheCategory, NicheStatus, SignalStrength, FailureType } from '@prisma/client'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------------------
// Signal strength
// ---------------------------------------------------------------------------

interface SignalMeta {
  label: string
  badgeClassName: string
  borderColor: string
}

export const SIGNAL_META: Record<SignalStrength, SignalMeta> = {
  ALTA: {
    label: 'Alta señal',
    badgeClassName: 'bg-[#fee2e2] text-[#dc2626]',
    borderColor: '#dc2626',
  },
  MEDIA: {
    label: 'Media señal',
    badgeClassName: 'bg-[#fef3c7] text-[#b45309]',
    borderColor: '#f59e0b',
  },
  BAJA: {
    label: 'Baja señal',
    badgeClassName: 'bg-[#f1f5f9] text-[#64748b]',
    borderColor: '#94a3b8',
  },
}

export const SIGNAL_OPTIONS: { value: SignalStrength; label: string }[] = [
  { value: SignalStrength.ALTA, label: 'Alta' },
  { value: SignalStrength.MEDIA, label: 'Media' },
  { value: SignalStrength.BAJA, label: 'Baja' },
]

export function SignalBadge({ signal }: { signal: SignalStrength }) {
  const meta = SIGNAL_META[signal]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        meta.badgeClassName
      )}
    >
      {meta.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Category (NUCLEO / ADYACENTE — FUERA never reaches the UI)
// ---------------------------------------------------------------------------

interface CategoryMeta {
  label: string
  className: string
}

export const NICHE_CATEGORY_META: Record<NicheCategory, CategoryMeta> = {
  NUCLEO: { label: 'Núcleo', className: 'bg-[#cffafe] text-[#0e7490]' },
  ADYACENTE: { label: 'Adyacente', className: 'bg-[#ede9fe] text-[#5b21b6]' },
  FUERA: { label: 'Fuera', className: 'bg-[#f1f5f9] text-[#94a3b8]' },
}

export const NICHE_CATEGORY_OPTIONS: { value: NicheCategory; label: string }[] = [
  { value: NicheCategory.NUCLEO, label: 'Núcleo' },
  { value: NicheCategory.ADYACENTE, label: 'Adyacente' },
]

export function NicheCategoryBadge({ category }: { category: NicheCategory }) {
  const meta = NICHE_CATEGORY_META[category]
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

// ---------------------------------------------------------------------------
// Failure type tags
// ---------------------------------------------------------------------------

export function FailureTypeTag({ type, count }: { type: FailureType; count: number }) {
  const isDesierta = type === 'DESIERTA'
  const label = isDesierta ? 'Desierta' : 'Ofertas rechazadas'
  const className = isDesierta ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#fee2e2] text-[#991b1b]'
  if (count <= 0) return null
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium', className)}>
      {label} ×{count}
    </span>
  )
}

export function RecallTag() {
  return (
    <span className="inline-flex items-center rounded-md bg-[#cffafe] px-2 py-0.5 text-[11px] font-medium text-[#0e7490]">
      Re-llamado probable
    </span>
  )
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const NICHE_STATUS_META: Record<NicheStatus, string> = {
  NUEVO: 'Nuevo',
  EXPLORANDO: 'Explorando',
  DESCARTADO: 'Descartado',
  ARCHIVADO: 'Archivado',
}

export const NICHE_STATUS_OPTIONS: { value: NicheStatus; label: string }[] = Object.entries(
  NICHE_STATUS_META
).map(([value, label]) => ({ value: value as NicheStatus, label }))
