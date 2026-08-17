'use client'

import { useRouter } from 'next/navigation'
import { startOfDay, startOfToday, addDays, isWeekend } from '@/lib/dates'
import { getBusinessDaysUntilClosing } from '@/lib/urgency-utils'
import { cn } from '@/lib/cn'

export interface TimelineOpportunity {
  id: string
  title: string
  organismo: string | null
  closingDate: Date
  score: number
  status: string
}

interface ClosingTimelineProps {
  opportunities: TimelineOpportunity[]
}

const DAYS_AHEAD = 14
const MAX_DOTS = 3

function dotColor(opp: TimelineOpportunity): string {
  const businessDays = getBusinessDaysUntilClosing(opp.closingDate)
  if (businessDays <= 1) return '#ef4444' // critical
  if (businessDays <= 3) return '#f59e0b' // urgent
  if (opp.score >= 7) return '#06b6d4' // relevant (cyan)
  return '#cbd5e1' // new / other
}

function shortWeekday(date: Date): string {
  return new Intl.DateTimeFormat('es-UY', { weekday: 'short' }).format(date)
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat('es-UY', { day: 'numeric', month: 'short' }).format(date)
}

function closingTooltip(opp: TimelineOpportunity): string {
  const title = opp.title.length > 50 ? `${opp.title.slice(0, 50)}…` : opp.title
  const time = new Intl.DateTimeFormat('es-UY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(opp.closingDate)
  return `${title}\n${opp.organismo ?? ''}\nCierre: ${time}`
}

export function ClosingTimeline({ opportunities }: ClosingTimelineProps) {
  const router = useRouter()
  const today = startOfToday()

  // Group opportunities by their closing calendar day (ms key).
  const byDay = new Map<number, TimelineOpportunity[]>()
  for (const opp of opportunities) {
    const key = startOfDay(opp.closingDate).getTime()
    const list = byDay.get(key) ?? []
    list.push(opp)
    byDay.set(key, list)
  }

  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i))
  const hasAny = opportunities.length > 0

  const legend: { color: string; label: string }[] = [
    { color: '#ef4444', label: 'Crítico (≤1 día)' },
    { color: '#f59e0b', label: 'Urgente (2-3 días)' },
    { color: '#06b6d4', label: 'Relevante' },
    { color: '#cbd5e1', label: 'Nueva' },
  ]

  return (
    <div className="rounded-xl border border-[#e0f2fe] bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.6px] text-[#94a3b8]">
          Línea de tiempo de cierres
        </h2>
        <div className="flex flex-wrap gap-3">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1 text-[11px] text-[#94a3b8]">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {!hasAny ? (
        <p className="flex h-6 items-center text-sm text-[#94a3b8]">
          Sin vencimientos próximos en los próximos 14 días
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex gap-2">
            {days.map((day, index) => {
              const dayOpps = byDay.get(day.getTime()) ?? []
              const weekend = isWeekend(day)
              const isToday = index === 0
              const visible = dayOpps.slice(0, MAX_DOTS)
              const extra = dayOpps.length - visible.length

              return (
                <div
                  key={day.getTime()}
                  className={cn(
                    'flex w-20 shrink-0 flex-col items-center rounded-lg px-1 py-2',
                    weekend && 'bg-[#f0f9ff]',
                    isToday && 'border-l-4 border-[#06b6d4] bg-[#ecfeff]'
                  )}
                >
                  <div
                    className={cn(
                      'text-xs capitalize',
                      isToday ? 'font-bold text-[#0e7490]' : 'text-[#6b7280]'
                    )}
                  >
                    {isToday ? 'Hoy' : shortWeekday(day)}
                  </div>
                  <div className="text-[11px] text-[#9ca3af]">{shortDate(day)}</div>

                  <div className="mt-2 flex min-h-[24px] flex-wrap items-center justify-center gap-1">
                    {visible.map((opp) => (
                      <button
                        key={opp.id}
                        type="button"
                        title={closingTooltip(opp)}
                        onClick={() => router.push(`/oportunidades/${opp.id}?tab=detalle`)}
                        className="h-3 w-3 rounded-full transition-transform hover:scale-125"
                        style={{ backgroundColor: dotColor(opp) }}
                        aria-label={opp.title}
                      />
                    ))}
                    {extra > 0 && (
                      <span className="text-[10px] font-semibold text-[#6b7280]">+{extra}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
