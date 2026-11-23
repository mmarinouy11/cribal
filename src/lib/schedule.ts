// Single source of truth for when the automatic pipeline runs: weekdays
// (Mon–Fri) at PIPELINE_HOUR_MONTEVIDEO (default 12:00) in America/Montevideo.
// The hour is defined in LOCAL (Montevideo) time, not UTC; everything else — the
// cron string, the UTC hour used by the "next run" math, and the user-facing
// label — derives from it. Override with the PIPELINE_CRON_HOUR env var (0-23).
// Montevideo is UTC-3 year-round (no DST since 2015), so the UTC hour is +3.
//
// Note: PIPELINE_CRON_HOUR is read where this module runs. On the server (the
// cron and the banner's server renders) the override applies; in client bundles
// the env var is not inlined, so the banner there uses the default 12:00.

export const TIME_ZONE = 'America/Montevideo'

function readHour(raw: string | undefined, fallback: number): number {
  const parsed = raw != null && raw.trim() !== '' ? Number(raw) : Number.NaN
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback
}

/** The local Montevideo hour the automatic pipeline runs at (default 12:00). */
export const PIPELINE_HOUR_MONTEVIDEO = readHour(process.env.PIPELINE_CRON_HOUR, 12)

/** Equivalent UTC hour (Montevideo is UTC-3 year-round). */
export const RUN_HOUR_UTC = (PIPELINE_HOUR_MONTEVIDEO + 3) % 24

/** Cron expression in Montevideo local time (schedulers pass `timezone: TIME_ZONE`). */
export const RUN_CRON = `0 ${PIPELINE_HOUR_MONTEVIDEO} * * 1-5`

/** User-facing time label, e.g. "12:00". */
export const RUN_TIME_LABEL = `${PIPELINE_HOUR_MONTEVIDEO}:00`

/** The next instant the pipeline is scheduled to run (weekday, local run hour). */
export function nextScheduledRunAt(now: Date = new Date()): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC, 0, 0, 0)
  )
  // Advance to the first weekday run hour strictly in the future.
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
 * Spanish label for the next run: "hoy a las 12:00" when it is today, otherwise
 * "el lunes 23 de noviembre a las 12:00" (real day computed in Montevideo time).
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
