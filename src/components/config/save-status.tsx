export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

const STATUS_META: Record<Exclude<SaveStatus, 'idle'>, { label: string; className: string }> = {
  unsaved: { label: '● Cambios sin guardar', className: 'text-[#d97706]' },
  saving: { label: 'Guardando…', className: 'text-[#6b7280]' },
  saved: { label: '✓ Guardado', className: 'text-[#16a34a]' },
  error: { label: '✗ Error al guardar', className: 'text-[#dc2626]' },
}

/** Subtle auto-save status indicator. Renders nothing when idle. */
export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  const meta = STATUS_META[status]
  return <span className={`text-sm font-medium ${meta.className}`}>{meta.label}</span>
}
