import { getBusinessDaysUntilClosing } from '@/lib/urgency-utils'
import { formatDateDMY, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'

interface LicitacionTimelineProps {
  publicationDate: Date | null
  clarificationsDate: Date | null
  prorrogasDate: Date | null
  closingDate: Date | null
  openingDate: Date | null
}

interface RawMilestone {
  key: string
  label: string
  date: Date | null
  withTime: boolean
  isClosing: boolean
}

type Milestone = RawMilestone & { date: Date }

const URGENT_BUSINESS_DAYS = 5

/**
 * Vertical timeline of a tender's key dates. Past dates render gray with a solid
 * dot; future dates blue; a closing date within 5 business days renders red with
 * an urgency badge. The dot is hollow for events after the closing (e.g. the
 * opening act), which are still to come once the decision point has passed.
 */
export function LicitacionTimeline(props: LicitacionTimelineProps) {
  const now = Date.now()

  const closingTime = props.closingDate?.getTime() ?? null
  const raw: RawMilestone[] = [
    { key: 'pub', label: 'Publicación', date: props.publicationDate, withTime: false, isClosing: false },
    { key: 'aclar', label: 'Aclaraciones hasta', date: props.clarificationsDate, withTime: false, isClosing: false },
    { key: 'prorr', label: 'Prórrogas hasta', date: props.prorrogasDate, withTime: false, isClosing: false },
    { key: 'cierre', label: 'Cierre de ofertas', date: props.closingDate, withTime: true, isClosing: true },
    { key: 'apertura', label: 'Apertura', date: props.openingDate, withTime: false, isClosing: false },
  ]
  const milestones = raw.filter((m): m is Milestone => m.date !== null)

  if (milestones.length === 0) {
    return <p className="text-sm text-[#6b7280]">Sin fechas registradas para este llamado.</p>
  }

  return (
    <ol>
      {milestones.map((m, index) => {
        const isPast = m.date.getTime() < now
        const businessDays = m.isClosing ? getBusinessDaysUntilClosing(m.date) : null
        const isUrgentClosing =
          m.isClosing && !isPast && businessDays !== null && businessDays <= URGENT_BUSINESS_DAYS
        // Filled dot for events up to (and including) the closing/decision point;
        // hollow for what comes after it (e.g. the opening act).
        const filled = closingTime !== null ? m.date.getTime() <= closingTime : isPast
        const isLast = index === milestones.length - 1

        const accent = isUrgentClosing ? '#dc2626' : isPast ? '#94a3b8' : '#06b6d4'
        const dateText = m.withTime ? `${formatDateTime(m.date)}hs` : formatDateDMY(m.date)

        return (
          <li key={m.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className="mt-1 h-3 w-3 shrink-0 rounded-full border-2"
                style={{ borderColor: accent, backgroundColor: filled ? accent : '#ffffff' }}
              />
              {!isLast && (
                <span
                  className="w-0.5 flex-1"
                  style={{ backgroundColor: isPast ? '#e2e8f0' : '#bae6fd' }}
                />
              )}
            </div>
            <div className={cn('flex-1', isLast ? 'pb-0' : 'pb-5')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium" style={{ color: accent }}>
                  {m.label}
                </span>
                {isUrgentClosing && (
                  <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-[11px] font-semibold text-[#dc2626]">
                    Cierra en {businessDays} día{businessDays === 1 ? '' : 's'} hábil
                    {businessDays === 1 ? '' : 'es'}
                  </span>
                )}
              </div>
              <div className="text-sm" style={{ color: accent }}>
                {dateText}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
