import { startOfToday, startOfDay, isWeekend } from '@/lib/dates'

export type UrgencyLevel = 'critical' | 'urgent' | 'soon' | 'normal'

/**
 * Count business days (Mon–Fri) from tomorrow through the closing date,
 * inclusive. Closing today or in the past returns 0. Client-safe (no DB).
 */
export function getBusinessDaysUntilClosing(closingDate: Date): number {
  const today = startOfToday()
  const target = startOfDay(closingDate)
  if (target <= today) return 0

  let count = 0
  const cursor = new Date(today)
  while (cursor < target) {
    cursor.setDate(cursor.getDate() + 1)
    if (!isWeekend(cursor)) count += 1
  }
  return count
}

export function getUrgencyLevel(businessDays: number): UrgencyLevel {
  if (businessDays <= 1) return 'critical'
  if (businessDays <= 3) return 'urgent'
  if (businessDays <= 5) return 'soon'
  return 'normal'
}
