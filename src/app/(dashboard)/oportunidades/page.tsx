import Link from 'next/link'
import { redirect } from 'next/navigation'
import { OpportunityStatus, Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card } from '@/components/ui/card'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table'
import { ScoreBadge } from '@/components/ui/score-badge'
import { CategoryBadge } from '@/components/ui/category-badge'
import { Pagination } from '@/components/ui/pagination'
import { buttonClass } from '@/components/ui/button-styles'
import { OpportunitiesFilters } from '@/components/opportunities-filters'
import { StatusSelect } from '@/components/status-select'
import { formatDateDMY, truncate } from '@/lib/format'

const PAGE_SIZE = 20

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
  const companyId = session.user.companyId

  const statusParam = firstValue(searchParams.status)
  const minScoreParam = firstValue(searchParams.minScore)
  const categoryParam = firstValue(searchParams.category)
  const qParam = firstValue(searchParams.q)
  const pageParam = firstValue(searchParams.page)

  const statuses = parseStatuses(statusParam)
  const minScore = minScoreParam ? Number(minScoreParam) : undefined
  const page = Math.max(1, Number(pageParam) || 1)

  const where: Prisma.OpportunityWhereInput = { companyId }
  if (statuses.length > 0) where.status = { in: statuses }
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
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-[#111827]">Oportunidades</h1>
        <span className="rounded-full bg-[#e5e7eb] px-2.5 py-0.5 text-sm font-medium text-[#374151]">
          {total}
        </span>
      </header>

      <OpportunitiesFilters />

      <Card>
        {opportunities.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[#6b7280]">
            No hay oportunidades que coincidan con los filtros.
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
                <Th>Acciones</Th>
              </Tr>
            </THead>
            <TBody>
              {opportunities.map((opp) => (
                <Tr key={opp.id}>
                  <Td className="whitespace-nowrap text-[#6b7280]">
                    {formatDateDMY(opp.publicationDate)}
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
                    <StatusSelect id={opp.id} status={opp.status} />
                  </Td>
                  <Td>
                    <Link
                      href={`/oportunidades/${opp.id}`}
                      className={buttonClass('secondary', 'sm')}
                    >
                      Ver
                    </Link>
                  </Td>
                </Tr>
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
