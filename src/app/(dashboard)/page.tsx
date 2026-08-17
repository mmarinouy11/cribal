import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { OpportunityStatus, RunStatus, NicheStatus } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card } from '@/components/ui/card'
import { NicheCategoryBadge } from '@/components/niche/niche-badges'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table'
import { ClickableRow } from '@/components/ui/clickable-row'
import { ScoreBadge } from '@/components/ui/score-badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { CategoryBadge } from '@/components/ui/category-badge'
import { RunStatusBadge } from '@/components/ui/run-status-badge'
import { buttonClass } from '@/components/ui/button-styles'
import { RunPipelineButton } from '@/components/run-pipeline-button'
import { OnboardingBanner } from '@/components/onboarding-banner'
import { ClosingTimeline } from '@/components/dashboard/closing-timeline'
import { getUrgentOpportunities, getBusinessDaysUntilClosing } from '@/lib/pipeline/urgency'
import { computeNicheScore } from '@/lib/niche-score'
import { daysUntilNextRun } from '@/lib/cadence'
import { startOfToday, addDays } from '@/lib/dates'
import { cn } from '@/lib/cn'
import { formatDateDMY, formatSpanishDate, formatRelativeTime, formatDateTime, truncate } from '@/lib/format'

const INACTIVE_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.DESCARTADA,
  OpportunityStatus.ARCHIVADA,
  OpportunityStatus.NO_FIT,
]

const OPEN_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.NUEVA,
  OpportunityStatus.REVISANDO,
  OpportunityStatus.RELEVANTE,
]

function MetricCard({
  icon,
  iconColor,
  iconBg,
  value,
  valueClassName,
  label,
  extra,
  href,
}: {
  icon: string
  iconColor: string
  iconBg: string
  value: ReactNode
  valueClassName?: string
  label: string
  extra?: ReactNode
  href?: string
}) {
  const card = (
    <Card className={cn('h-full', href && 'cursor-pointer transition-shadow hover:shadow-md')}>
      <div className="p-5">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-[10px]', iconBg)}>
          <i className={cn('ti', icon, 'text-xl', iconColor)} aria-hidden />
        </div>
        <div
          className={cn(
            'mt-3 text-[#0c1e3c]',
            valueClassName ?? 'text-[32px] font-bold leading-none'
          )}
        >
          {value}
        </div>
        <div className="mt-1 text-xs text-[#64748b]">{label}</div>
        {extra}
      </div>
    </Card>
  )

  return href ? (
    <Link href={href} className="block h-full">
      {card}
    </Link>
  ) : (
    card
  )
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const companyId = session.user.companyId

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const [
    activeCount,
    newThisWeek,
    highlyRelevant,
    lastRun,
    company,
    recentOpportunities,
    timelineOpportunities,
    urgentAll,
    nichesActiveCount,
    activeNiches,
  ] = await Promise.all([
    prisma.opportunity.count({
      where: { companyId, status: { notIn: INACTIVE_STATUSES } },
    }),
    prisma.opportunity.count({
      where: {
        companyId,
        status: OpportunityStatus.NUEVA,
        createdAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.opportunity.count({ where: { companyId, score: { gte: 8 } } }),
    prisma.run.findFirst({
      where: { companyId },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.companyConfig.findUnique({
      where: { id: companyId },
      select: { lastSuccessfulRunAt: true, lookbackDays: true },
    }),
    prisma.opportunity.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.opportunity.findMany({
      where: {
        companyId,
        status: { notIn: INACTIVE_STATUSES },
        closingDate: { gte: startOfToday(), lte: addDays(new Date(), 14) },
      },
      select: {
        id: true,
        title: true,
        organismo: true,
        closingDate: true,
        score: true,
        status: true,
      },
      orderBy: { closingDate: 'asc' },
    }),
    getUrgentOpportunities(companyId),
    prisma.niche.count({
      where: {
        companyId,
        status: { notIn: [NicheStatus.DESCARTADO, NicheStatus.ARCHIVADO] },
      },
    }),
    prisma.niche.findMany({
      where: {
        companyId,
        status: { notIn: [NicheStatus.DESCARTADO, NicheStatus.ARCHIVADO] },
      },
      select: {
        id: true,
        label: true,
        category: true,
        failureCount: true,
        lastFailureAt: true,
        fitScore: true,
      },
    }),
  ])

  // Top niches by puntaje (0-10 combining fit + recurrence + recency).
  const topNiches = activeNiches
    .map((niche) => ({ ...niche, score: computeNicheScore(niche) }))
    .filter((niche) => niche.score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  // Timeline items are guaranteed to have a closing date by the query filter.
  const timelineItems = timelineOpportunities
    .filter((o): o is typeof o & { closingDate: Date } => o.closingDate !== null)
    .map((o) => ({ ...o, closingDate: o.closingDate }))

  // Urgent = closing within 3 business days; "closing this week" = within 5.
  const urgentOpportunities = urgentAll.filter(
    (o) => o.closingDate !== null && getBusinessDaysUntilClosing(o.closingDate) <= 3
  )
  const closingThisWeekCount = urgentAll.filter(
    (o) =>
      o.closingDate !== null &&
      OPEN_STATUSES.includes(o.status) &&
      getBusinessDaysUntilClosing(o.closingDate) <= 5
  ).length

  // Next scheduled automatic run, derived from the company's cadence.
  const lastSuccessfulRunAt = company?.lastSuccessfulRunAt ?? null
  const daysToNextRun = lastSuccessfulRunAt
    ? daysUntilNextRun(lastSuccessfulRunAt, company?.lookbackDays ?? 1, new Date())
    : null
  const nextRunLabel =
    daysToNextRun === null
      ? null
      : daysToNextRun === 0
        ? 'hoy'
        : daysToNextRun === 1
          ? 'mañana'
          : `en ${daysToNextRun} días`

  // "Última ejecución" tri-state: never run / last failed / last successful.
  const lastRunValue = !lastRun
    ? 'Sin ejecuciones'
    : !lastSuccessfulRunAt
      ? 'Última falló'
      : formatRelativeTime(lastSuccessfulRunAt)

  return (
    <div className="space-y-6">
      <OnboardingBanner />

      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">Tablero</h1>
          <p className="text-[13px] text-[#94a3b8]">
            {session.user.companyName} · {formatSpanishDate(new Date())}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <RunPipelineButton />
          <Link
            href="/oportunidades"
            className="text-xs font-medium text-[#06b6d4] hover:underline"
          >
            Ver todas las oportunidades →
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          icon="ti-briefcase"
          iconColor="text-[#06b6d4]"
          iconBg="bg-[#e0f2fe]"
          value={activeCount}
          label="Oportunidades activas"
          href="/oportunidades?estado=activas"
        />
        <MetricCard
          icon="ti-sparkles"
          iconColor="text-[#8b5cf6]"
          iconBg="bg-[#ede9fe]"
          value={newThisWeek}
          label="Nuevas esta semana"
          href="/oportunidades?estado=NUEVA"
        />
        <MetricCard
          icon="ti-star"
          iconColor="text-[#f59e0b]"
          iconBg="bg-[#fef3c7]"
          value={highlyRelevant}
          label="Muy relevantes"
          href="/oportunidades?minScore=8"
        />
        <MetricCard
          icon="ti-clock"
          iconColor="text-[#10b981]"
          iconBg="bg-[#d1fae5]"
          value={lastRunValue}
          valueClassName="text-lg font-semibold leading-tight"
          label="Última ejecución"
          href="/ejecuciones"
          extra={
            <div className="mt-1.5 space-y-1">
              {nextRunLabel && (
                <div className="text-[11px] text-[#94a3b8]">Próxima: {nextRunLabel}</div>
              )}
              {lastSuccessfulRunAt ? (
                <RunStatusBadge status={RunStatus.COMPLETED} />
              ) : lastRun ? (
                <RunStatusBadge status={RunStatus.FAILED} />
              ) : null}
            </div>
          }
        />
        <MetricCard
          icon="ti-alarm"
          iconColor="text-[#ef4444]"
          iconBg="bg-[#fee2e2]"
          value={closingThisWeekCount}
          label="Cierran esta semana"
          href="/oportunidades?cierranEstaSemana=true"
        />
        <MetricCard
          icon="ti-bulb"
          iconColor="text-[#8b5cf6]"
          iconBg="bg-[#ede9fe]"
          value={nichesActiveCount}
          label="Nichos detectados"
          href="/nichos"
        />
      </section>

      <ClosingTimeline opportunities={timelineItems} />

      {urgentOpportunities.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.6px] text-[#94a3b8]">
            <i className="ti ti-alert-triangle text-sm text-[#dc2626]" aria-hidden />
            Atención requerida
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {urgentOpportunities.map((opp) => {
              const businessDays = opp.closingDate
                ? getBusinessDaysUntilClosing(opp.closingDate)
                : 0
              return (
                <div key={opp.id} className="rounded-xl border border-red-100 bg-red-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#0c1e3c]">{truncate(opp.title, 60)}</p>
                      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.4px] text-[#dc2626]">
                        CIERRA EN {businessDays} DÍA{businessDays === 1 ? '' : 'S'} HÁBIL
                        {businessDays === 1 ? '' : 'ES'}
                      </p>
                      <p className="mt-0.5 text-xs text-[#94a3b8]">
                        {opp.organismo ?? '—'} · {formatDateTime(opp.closingDate)} · Puntaje{' '}
                        {opp.score}
                      </p>
                    </div>
                    <Link
                      href={`/oportunidades/${opp.id}?tab=detalle`}
                      className={buttonClass('secondary', 'sm')}
                    >
                      Ver →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {topNiches.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.6px] text-[#94a3b8]">
              <i className="ti ti-bulb text-sm" aria-hidden />
              Nichos destacados
            </h2>
            <Link href="/nichos" className="text-xs text-[#06b6d4] hover:underline">
              Ver todos los nichos →
            </Link>
          </div>
          <Card className="divide-y divide-[#e0f2fe]">
            {topNiches.map((niche) => (
              <div key={niche.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-[#0c1e3c]">
                    {niche.label}
                  </span>
                  <NicheCategoryBadge category={niche.category} />
                </div>
                <div className="flex shrink-0 items-center gap-4 text-xs text-[#94a3b8]">
                  <span>
                    Puntaje {niche.score}/10 · {niche.failureCount} fallo
                    {niche.failureCount === 1 ? '' : 's'} · {formatRelativeTime(niche.lastFailureAt)}
                  </span>
                  <Link
                    href={`/nichos/${niche.id}`}
                    className="font-medium text-[#06b6d4] hover:underline"
                  >
                    Ver →
                  </Link>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e0f2fe] px-5 py-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.4px] text-[#0c1e3c]">
            Oportunidades recientes
          </h2>
          <Link href="/oportunidades" className="text-xs text-[#06b6d4] hover:underline">
            Ver todas →
          </Link>
        </div>
        {recentOpportunities.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#6b7280]">
            Todavía no hay oportunidades. Corré la criba para empezar.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Fecha</Th>
                <Th>Organismo</Th>
                <Th>Título</Th>
                <Th>Categoría</Th>
                <Th>Puntaje</Th>
                <Th>Estado</Th>
              </Tr>
            </THead>
            <TBody>
              {recentOpportunities.map((opp) => (
                <ClickableRow key={opp.id} href={`/oportunidades/${opp.id}`}>
                  <Td className="whitespace-nowrap text-[#6b7280]">
                    {formatDateDMY(opp.publicationDate ?? opp.createdAt)}
                  </Td>
                  <Td className="text-[#6b7280]">{truncate(opp.organismo ?? '—', 30)}</Td>
                  <Td>
                    <span className="font-medium text-[#0c1e3c]">{truncate(opp.title, 60)}</span>
                  </Td>
                  <Td>
                    <CategoryBadge category={opp.category} />
                  </Td>
                  <Td>
                    <ScoreBadge score={opp.score} />
                  </Td>
                  <Td>
                    <StatusBadge status={opp.status} />
                  </Td>
                </ClickableRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
