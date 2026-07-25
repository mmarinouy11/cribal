/** DD/MM/YYYY, or "—" when the date is null. */
export function formatDateDMY(date: Date | null): string {
  if (!date) return '—'
  const d = new Date(date)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()}`
}

/** Long Spanish date, e.g. "viernes, 25 de julio de 2026". */
export function formatSpanishDate(date: Date): string {
  return new Intl.DateTimeFormat('es-UY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** DD/MM/YYYY HH:mm, or "—" when null. */
export function formatDateTime(date: Date | null): string {
  if (!date) return '—'
  const d = new Date(date)
  const time = new Intl.DateTimeFormat('es-UY', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
  return `${formatDateDMY(d)} ${time}`
}

/** Spanish relative time, e.g. "hace 2 horas", "hace 3 días". */
export function formatRelativeTime(date: Date | null): string {
  if (!date) return '—'
  const diffMs = Date.now() - new Date(date).getTime()
  const seconds = Math.round(diffMs / 1000)
  const minutes = Math.round(seconds / 60)
  const hours = Math.round(minutes / 60)
  const days = Math.round(hours / 24)

  if (seconds < 60) return 'hace unos segundos'
  if (minutes < 60) return `hace ${minutes} minuto${minutes === 1 ? '' : 's'}`
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? '' : 's'}`
  if (days < 30) return `hace ${days} día${days === 1 ? '' : 's'}`

  const months = Math.round(days / 30)
  return `hace ${months} mes${months === 1 ? '' : 'es'}`
}

/** Human-readable duration between two dates, e.g. "1m 23s". */
export function formatDuration(start: Date | null, end: Date | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return '—'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

/** Truncate a string to `max` chars, appending an ellipsis when cut. */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return `${str.slice(0, max).trimEnd()}…`
}
