import { redirect } from 'next/navigation'
import { OpportunityStatus, Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card } from '@/components/ui/card'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table'
import { ClickableRow } from '@/components/ui/clickable-row'
import { ScoreBadge } from '@/components/ui/score-badge'
import { CategoryBadge } from '@/components/ui/category-badge'
import { Pagination } from '@/components/ui/pagination'
import { OpportunitiesFilters } from '@/components/opportunities-filters'
import { StatusSelect } from '@/components/status-select'
import { getEffectiveCompanyId } from '@/lib/tenant'
import { formatDateDMY } from '@/lib/format'
import { opportunityObjeto, opportunitySubtitle } from '@/lib/opportunity-labels'
import { startOfToday, addDays } from '@/lib/dates'

const PAGE_SIZE = 20

// Statuses considered "not active" (closed/discarded), used by the dashboard
// card shortcuts (?estado=activas / ?cierranEstaSemana=true).
const INACTIVE_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.DESCARTADA,
  OpportunityStatus.ARCHIVADA,
  OpportunityStatus.NO_FIT,
]

type SearchParams = { [key: string]: string | string[] | undefined }

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseStatuses(value: string | undefined): OpportunityStatus[] {
  if (!value) return []
  const valid = new Set(Object.values(OpportunityStatus))
  return value
    .split(',')
    .filter((s): s is OpportunityStatus => valid.has(s as OpportunityStatus))
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const companyIdParam = firstValue(searchParams.companyId)
  const companyId = getEffectiveCompanyId(session, companyIdParam)

  const statusParam = firstValue(searchParams.status)
  const minScoreParam = firstValue(searchParams.minScore)
  const categoryParam = firstValue(searchParams.category)
  const qParam = firstValue(searchParams.q)
  const pageParam = firstValue(searchParams.page)
  // Dashboard card shortcuts.
  const estadoParam = firstValue(searchParams.estado)
  const cierranEstaSemana = firstValue(searchParams.cierranEstaSemana) === 'true'

  const statuses = parseStatuses(statusParam)
  const minScore = minScoreParam ? Number(minScoreParam) : undefined
  const page = Math.max(1, Number(pageParam) || 1)

  const where: Prisma.OpportunityWhereInput = { companyId }

  // Status: the filter chips (?status=…) win; otherwise the dashboard's
  // ?estado shortcut applies ("activas" = not closed, or a specific status).
  if (statuses.length > 0) {
    where.status = { in: statuses }
  } else if (estadoParam === 'activas' || cierranEstaSemana) {
    where.status = { notIn: INACTIVE_STATUSES }
  } else if (estadoParam && Object.values(OpportunityStatus).includes(estadoParam as OpportunityStatus)) {
    where.status = estadoParam as OpportunityStatus
  }

  // "Cierran esta semana": open opportunities closing within the next 7 days.
  if (cierranEstaSemana) {
    where.closingDate = { gte: startOfToday(), lte: addDays(new Date(), 7) }
  }

  if (minScore !== undefined && !Number.isNaN(minScore)) where.score = { gte: minScore }
  if (categoryParam) where.category = categoryParam
  if (qParam) {
    where.OR = [
      { title: { contains: qParam, mode: 'insensitive' } },
      { organismo: { contains: qParam, mode: 'insensitive' } },
    ]
  }

  const [total, opportunities] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const currentSearchParams: Record<string, string | undefined> = {
    status: statusParam,
    minScore: minScoreParam,
    category: categoryParam,
    q: qParam,
    companyId: companyIdParam,
    estado: estadoParam,
    cierranEstaSemana: cierranEstaSemana ? 'true' : undefined,
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">
          Oportunidades
        </h1>
        <span className="rounded-full bg-[#e0f2fe] px-2.5 py-0.5 text-sm font-medium text-[#0e7490]">
          {total}
        </span>
      </header>

      <OpportunitiesFilters />

      <Card className="overflow-hidden">
        {opportunities.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[#6b7280]">
            No hay oportunidades que coincidan con los filtros.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Fecha</Th>
                <Th>Oportunidad</Th>
                <Th>Categoría</Th>
                <Th>Puntaje</Th>
                <Th>Estado</Th>
              </Tr>
            </THead>
            <TBody>
              {opportunities.map((opp) => (
                <ClickableRow key={opp.id} href={`/oportunidades/${opp.id}`}>
                  <Td className="whitespace-nowrap text-[#6b7280]">
                    {formatDateDMY(opp.publicationDate)}
                  </Td>
                  <Td>
                    <div className="font-medium text-[#0c1e3c]">{opportunityObjeto(opp, 80)}</div>
                    <div className="mt-0.5 text-xs text-[#6b7280]">
                      {opportunitySubtitle(opp, { shortType: true })}
                    </div>
                  </Td>
                  <Td>
                    <CategoryBadge category={opp.category} />
                  </Td>
                  <Td>
                    <ScoreBadge score={opp.score} />
                  </Td>
                  <Td>
                    <StatusSelect id={opp.id} status={opp.status} />
                  </Td>
                </ClickableRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Pagination
        basePath="/oportunidades"
        currentPage={page}
        totalPages={totalPages}
        searchParams={currentSearchParams}
      />
    </div>
  )
}
