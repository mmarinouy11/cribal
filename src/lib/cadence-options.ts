// User-facing cadence presets, mapped onto the existing `lookbackDays`
// mechanism. We do NOT introduce a new scheduling concept: each preset is just
// a `lookbackDays` value that the weekday cron already honours through
// `isDueToRun()` / `effectiveLookbackDays()`.
//
//  - daily  (1 day)  → due every weekday  → runs Mon–Fri.
//  - twice  (3 days) → due again 3 days later → settles into Mon & Thu.
//  - weekly (7 days) → due again 7 days later → runs once a week (Mon).
//
// The parenthetical day names describe the typical rhythm once the cycle is
// anchored on a Monday; the real run day follows from each company's last
// successful run, since that is what `lookbackDays` is measured from.

export type CadenceValue = 'daily' | 'twice' | 'weekly'

export interface CadenceOption {
  value: CadenceValue
  label: string
  lookbackDays: number
}

export const CADENCE_OPTIONS: CadenceOption[] = [
  { value: 'daily', label: 'Todos los días hábiles', lookbackDays: 1 },
  { value: 'twice', label: 'Dos veces por semana (lunes y jueves)', lookbackDays: 3 },
  { value: 'weekly', label: 'Una vez por semana (lunes)', lookbackDays: 7 },
]

export const DEFAULT_CADENCE: CadenceValue = 'daily'

/** The `lookbackDays` value a cadence preset maps to (defaults to daily). */
export function cadenceToLookbackDays(value: CadenceValue): number {
  return (CADENCE_OPTIONS.find((o) => o.value === value) ?? CADENCE_OPTIONS[0]).lookbackDays
}

/**
 * Bucket any stored `lookbackDays` back to the closest preset for display, so a
 * legacy value (e.g. 2, 4, 5, 6) still selects a sensible option without
 * changing what is stored until the user picks a new cadence.
 */
export function lookbackDaysToCadence(days: number): CadenceValue {
  if (days <= 1) return 'daily'
  if (days <= 5) return 'twice'
  return 'weekly'
}

/** Spanish label for a cadence preset. */
export function cadenceLabel(value: CadenceValue): string {
  return (CADENCE_OPTIONS.find((o) => o.value === value) ?? CADENCE_OPTIONS[0]).label
}
