/** Midnight (local) of the given date. */
export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Midnight (local) of today. */
export function startOfToday(): Date {
  return startOfDay(new Date())
}

/** A new Date `days` calendar days after `date`. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** True for Saturday/Sunday. */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}
