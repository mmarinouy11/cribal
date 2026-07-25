import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { OpportunityStatus } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table'
import { ScoreBadge } from '@/components/ui/score-badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { CategoryBadge } from '@/components/ui/category-badge'
import { RunStatusBadge } from '@/components/ui/run-status-badge'
import { buttonClass } from '@/components/ui/button-styles'
import { RunPipelineButton } from '@/components/run-pipeline-button'
import { formatDateDMY, formatSpanishDate, formatRelativeTime, truncate } from '@/lib/format'

const INACTIVE_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.DESCARTADA,
  OpportunityStatus.ARCHIVADA,
  OpportunityStatus.NO_FIT,
]

function MetricCard({
  icon,
  iconClass,
  value,
  label,
  extra,
}: {
  icon: string
  iconClass: string
  value: ReactNode
  label: string
  extra?: ReactNode
}) {
  return (
    <Card>
      <CardBody className="flex items-center gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-xl ${iconClass}`}
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold text-[#111827]">{value}</div>
          <div className="text-sm text-[#6b7280]">{label}</div>
          {extra}
        </div>
      </CardBody>
    </Card>
  )
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const companyId = session.user.companyId

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const [activeCount, newThisWeek, highlyRelevant, lastRun, recentOpportunities] =
    await Promise.all([
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
      prisma.opportunity.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Dashboard</h1>
          <p className="text-sm text-[#6b7280]">
            {session.user.companyName} · {formatSpanishDate(new Date())}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RunPipelineButton />
          <Link href="/oportunidades" className={buttonClass('secondary')}>
            Ver todas las oportunidades
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon="🎯"
          iconClass="bg-blue-50 text-blue-600"
          value={activeCount}
          label="Oportunidades activas"
        />
        <MetricCard
          icon="🆕"
          iconClass="bg-green-50 text-green-600"
          value={newThisWeek}
          label="Nuevas esta semana"
        />
        <MetricCard
          icon="⭐"
          iconClass="bg-amber-50 text-amber-600"
          value={highlyRelevant}
          label="Muy relevantes"
        />
        <MetricCard
          icon="▶️"
          iconClass="bg-indigo-50 text-indigo-600"
          value={lastRun ? formatRelativeTime(lastRun.startedAt) : 'Sin ejecuciones'}
          label="Última ejecución"
          extra={
            lastRun ? (
              <div className="mt-1">
                <RunStatusBadge status={lastRun.status} />
              </div>
            ) : undefined
          }
        />
      </section>

      <Card>
        <div className="flex items-center justify-between border-b border-[#e5e7eb] px-5 py-4">
          <h2 className="font-semibold text-[#111827]">Oportunidades recientes</h2>
          <Link href="/oportunidades" className="text-sm text-[#2563eb] hover:underline">
            Ver todas →
          </Link>
        </div>
        {recentOpportunities.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#6b7280]">
            Todavía no hay oportunidades. Corré el pipeline para empezar.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Fecha</Th>
                <Th>Organismo</Th>
                <Th>Título</Th>
                <Th>Categoría</Th>
                <Th>Score</Th>
                <Th>Estado</Th>
              </Tr>
            </THead>
            <TBody>
              {recentOpportunities.map((opp) => (
                <Tr key={opp.id}>
                  <Td className="whitespace-nowrap text-[#6b7280]">
                    {formatDateDMY(opp.publicationDate ?? opp.createdAt)}
                  </Td>
                  <Td className="text-[#6b7280]">{truncate(opp.organismo ?? '—', 30)}</Td>
                  <Td>
                    <Link
                      href={`/oportunidades/${opp.id}`}
                      className="font-medium text-[#1e3a5f] hover:underline"
                    >
                      {truncate(opp.title, 60)}
                    </Link>
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
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
