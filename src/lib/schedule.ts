// Single source of truth for when the automatic pipeline runs: weekdays
// (Mon–Fri) at 08:00 America/Montevideo. Montevideo is UTC-3 year-round (no DST
// since 2015), so 08:00 local is 11:00 UTC. Both the cron scheduler and the
// "next run" banner read from here so the schedule is never duplicated.

export const RUN_HOUR_UTC = 11 // 08:00 America/Montevideo
export const RUN_CRON = `0 ${RUN_HOUR_UTC} * * 1-5`
const TIME_ZONE = 'America/Montevideo'
const RUN_TIME_LABEL = '8:00'

/** The next instant the pipeline is scheduled to run (weekday 11:00 UTC). */
export function nextScheduledRunAt(now: Date = new Date()): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC, 0, 0, 0)
  )
  // Advance to the first weekday 11:00 UTC strictly in the future.
  while (
    candidate.getTime() <= now.getTime() ||
    candidate.getUTCDay() === 0 || // Sunday
    candidate.getUTCDay() === 6 // Saturday
  ) {
    candidate.setUTCDate(candidate.getUTCDate() + 1)
    candidate.setUTCHours(RUN_HOUR_UTC, 0, 0, 0)
  }
  return candidate
}

/**
 * Whether an instant falls on a weekday (Mon–Fri) in Montevideo time. Used to
 * guard the automatic cron path so the pipeline never runs on the weekend, even
 * if the external (Railway) cron is ever misconfigured to fire Sat/Sun. The
 * manual "run now" button does not go through this guard.
 */
export function isMontevideoWeekday(now: Date = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
  }).format(now)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

/** Montevideo calendar day ("YYYY-MM-DD") for a given instant. */
function montevideoDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * Spanish label for the next run: "hoy a las 8:00" when it is today, otherwise
 * "el lunes 23 de noviembre a las 8:00" (real day computed in Montevideo time).
 */
export function formatNextRunLabel(now: Date = new Date()): string {
  const next = nextScheduledRunAt(now)
  if (montevideoDayKey(next) === montevideoDayKey(now)) {
    return `hoy a las ${RUN_TIME_LABEL}`
  }
  // Spanish day/month names are lowercase; ICU may capitalize, so normalize.
  const weekday = new Intl.DateTimeFormat('es-UY', { weekday: 'long', timeZone: TIME_ZONE })
    .format(next)
    .toLowerCase()
  const day = new Intl.DateTimeFormat('es-UY', { day: 'numeric', timeZone: TIME_ZONE }).format(next)
  const month = new Intl.DateTimeFormat('es-UY', { month: 'long', timeZone: TIME_ZONE })
    .format(next)
    .toLowerCase()
  return `el ${weekday} ${day} de ${month} a las ${RUN_TIME_LABEL}`
}
