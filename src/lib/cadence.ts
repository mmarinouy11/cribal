import { addDays, startOfDay } from '@/lib/dates'

const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Whole calendar days elapsed between two dates, counted by midnight boundaries
 * crossed (not exact 24h intervals). Using calendar dates — rather than
 * elapsed-ms — means a company that ran at 08:05 is "due" again the next
 * calendar day, so the daily 08:00 cron still triggers a lookbackDays:1 company
 * every weekday (it would otherwise be ~5 minutes short of a full 24h and skip).
 */
function daysSince(from: Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(from).getTime()) / MS_PER_DAY)
}

/**
 * A company is due to run when it has never run, or when at least `lookbackDays`
 * whole days have passed since its last successful run.
 */
export function isDueToRun(
  lastSuccessfulRunAt: Date | null,
  lookbackDays: number,
  now: Date
): boolean {
  if (!lastSuccessfulRunAt) return true
  return daysSince(lastSuccessfulRunAt, now) >= lookbackDays
}

/** Days remaining until the next automatic run (0 when due now / never run). */
export function daysUntilNextRun(
  lastSuccessfulRunAt: Date | null,
  lookbackDays: number,
  now: Date
): number {
  if (!lastSuccessfulRunAt) return 0
  return Math.max(0, lookbackDays - daysSince(lastSuccessfulRunAt, now))
}

/** Scheduled date of the next automatic run, or null if never run. */
export function nextRunDate(
  lastSuccessfulRunAt: Date | null,
  lookbackDays: number
): Date | null {
  if (!lastSuccessfulRunAt) return null
  return addDays(lastSuccessfulRunAt, lookbackDays)
}
