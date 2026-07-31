import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table'
import { ScoreBadge } from '@/components/ui/score-badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { RunStatusBadge } from '@/components/ui/run-status-badge'
import { Pagination } from '@/components/ui/pagination'
import { cn } from '@/lib/cn'
import { formatDateTime, formatDuration, truncate } from '@/lib/format'

const RAW_PAGE_SIZE = 50

type SearchParams = { [key: string]: string | string[] | undefined }

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

interface RunError {
  stage: string
  message: string
}

function parseErrors(errors: Prisma.JsonValue): RunError[] {
  if (!Array.isArray(errors)) return []
  return errors
    .filter((e): e is Prisma.JsonObject => typeof e === 'object' && e !== null && !Array.isArray(e))
    .map((e) => ({
      stage: typeof e.stage === 'string' ? e.stage : 'error',
      message: typeof e.message === 'string' ? e.message : JSON.stringify(e),
    }))
}

function jsonString(value: Prisma.JsonValue | null, key: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const field = (value as Prisma.JsonObject)[key]
    if (typeof field === 'string') return field
  }
  return ''
}

const RAW_TABS: { key: string; label: string; filter: string | null }[] = [
  { key: 'todos', label: 'Todos', filter: null },
  { key: 'guardados', label: 'Guardados', filter: 'guardado' },
  { key: 'keywords', label: 'Rechazados por keywords', filter: 'keyword_rechazado' },
  { key: 'stage-gate', label: 'Rechazados stage-gate', filter: 'stage_gate_rechazado' },
  { key: 'duplicados', label: 'Duplicados', filter: 'duplicado' },
]

function FunnelStage({
  label,
  count,
  max,
  isLast,
}: {
  label: string
  count: number
  max: number
  isLast: boolean
}) {
  const width = max > 0 ? `${Math.max(4, (count / max) * 100)}%` : '4%'
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 shrink-0 text-sm text-[#6b7280]">{label}</div>
      <div className="h-7 flex-1 overflow-hidden rounded bg-[#f1f5f9]">
        <div
          className={cn(
            'flex h-full items-center rounded px-2 text-xs font-semibold text-white',
            isLast ? 'bg-[#06b6d4]' : 'bg-[#0c1e3c]'
          )}
          style={{ width }}
        >
          {count}
        </div>
      </div>
    </div>
  )
}

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: SearchParams
}) {
  const session = await auth()
  if (!session) redirect('/login')

  // Regular users are scoped to their own company; admins may open any run.
  const isAdmin = session.user.role === 'ADMIN'
  const run = await prisma.run.findFirst({
    where: isAdmin ? { id: params.id } : { id: params.id, companyId: session.user.companyId },
  })
  if (!run) notFound()

  // Scope child records to the run's own company (works for admins too).
  const companyId = run.companyId

  const activeTabKey = firstValue(searchParams.tab) ?? 'todos'
  const activeTab = RAW_TABS.find((t) => t.key === activeTabKey) ?? RAW_TABS[0]
  const rawPage = Math.max(1, Number(firstValue(searchParams.rawPage)) || 1)

  const rawWhere: Prisma.RawPublicationWhereInput = { runId: run.id }
  if (activeTab.filter) rawWhere.filterResult = activeTab.filter

  const [savedOpportunities, rawTotal, rawPublications] = await Promise.all([
    prisma.opportunity.findMany({
      where: { runId: run.id, companyId },
      orderBy: { score: 'desc' },
    }),
    prisma.rawPublication.count({ where: rawWhere }),
    prisma.rawPublication.findMany({
      where: rawWhere,
      orderBy: { createdAt: 'desc' },
      skip: (rawPage - 1) * RAW_PAGE_SIZE,
      take: RAW_PAGE_SIZE,
    }),
  ])

  const errors = parseErrors(run.errors)
  const rawTotalPages = Math.max(1, Math.ceil(rawTotal / RAW_PAGE_SIZE))

  const funnelStages = [
    { label: 'Items encontrados', count: run.rawItemsFound },
    { label: 'Tras filtro de fecha', count: run.itemsAfterDateFilter },
    { label: 'Tras keywords', count: run.itemsAfterKeyword },
    { label: 'Tras stage-gate', count: run.itemsAfterStageGate },
    { label: 'Enviados a IA', count: run.itemsSentToAi },
    { label: 'Oportunidades guardadas', count: run.opportunitiesSaved },
  ]
  const funnelMax = Math.max(...funnelStages.map((s) => s.count), 1)

  return (
    <div className="space-y-6">
      <Link href="/ejecuciones" className="text-sm text-[#0e7490] hover:underline">
        ← Volver a ejecuciones
      </Link>

      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">Ejecución</h1>
          <p className="text-sm text-[#6b7280]">{formatDateTime(run.startedAt)}</p>
        </div>
        <RunStatusBadge status={run.status} />
      </header>

      <Card>
        <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Inicio</div>
            <div className="mt-0.5 text-sm text-[#0c1e3c]">{formatDateTime(run.startedAt)}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Fin</div>
            <div className="mt-0.5 text-sm text-[#0c1e3c]">{formatDateTime(run.finishedAt)}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Duración</div>
            <div className="mt-0.5 text-sm text-[#0c1e3c]">
              {formatDuration(run.startedAt, run.finishedAt)}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Feeds</div>
            <div className="mt-0.5 text-sm text-[#0c1e3c]">{run.feedsChecked}</div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <div className="border-b border-[#e0f2fe] px-5 py-4">
          <h2 className="font-semibold text-[#0c1e3c]">Embudo del pipeline</h2>
        </div>
        <CardBody className="space-y-2">
          {funnelStages.map((stage, index) => (
            <FunnelStage
              key={stage.label}
              label={stage.label}
              count={stage.count}
              max={funnelMax}
              isLast={index === funnelStages.length - 1}
            />
          ))}
        </CardBody>
      </Card>

      {errors.length > 0 && (
        <Card>
          <div className="border-b border-[#e0f2fe] px-5 py-4">
            <h2 className="font-semibold text-[#0c1e3c]">Errores ({errors.length})</h2>
          </div>
          <CardBody className="space-y-2">
            {errors.map((error, index) => (
              <div
                key={index}
                className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm"
              >
                <span className="font-semibold text-[#dc2626]">{error.stage}:</span>{' '}
                <span className="text-[#0c1e3c]">{error.message}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="border-b border-[#e0f2fe] px-5 py-4">
          <h2 className="font-semibold text-[#0c1e3c]">
            Oportunidades guardadas ({savedOpportunities.length})
          </h2>
        </div>
        {savedOpportunities.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#6b7280]">
            Esta ejecución no guardó oportunidades.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Título</Th>
                <Th>Organismo</Th>
                <Th>Score</Th>
                <Th>Estado</Th>
              </Tr>
            </THead>
            <TBody>
              {savedOpportunities.map((opp) => (
                <Tr key={opp.id}>
                  <Td>
                    <Link
                      href={`/oportunidades/${opp.id}`}
                      className="font-medium text-[#0c1e3c] hover:underline"
                    >
                      {truncate(opp.title, 60)}
                    </Link>
                  </Td>
                  <Td className="text-[#6b7280]">{truncate(opp.organismo ?? '—', 30)}</Td>
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

      <Card>
        <div className="border-b border-[#e0f2fe] px-5 py-4">
          <h2 className="font-semibold text-[#0c1e3c]">Publicaciones crudas</h2>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-[#e0f2fe] px-5 py-3">
          {RAW_TABS.map((tab) => (
            <Link
              key={tab.key}
              href={`/ejecuciones/${run.id}?tab=${tab.key}`}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium',
                tab.key === activeTab.key
                  ? 'bg-[#0c1e3c] text-white'
                  : 'bg-[#f1f5f9] text-[#6b7280] hover:bg-[#e0f2fe]'
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        {rawPublications.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#6b7280]">
            No hay publicaciones para este filtro.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Tender ID</Th>
                <Th>Título</Th>
                <Th>Resultado</Th>
                <Th>Razón</Th>
              </Tr>
            </THead>
            <TBody>
              {rawPublications.map((raw) => (
                <Tr key={raw.id}>
                  <Td className="whitespace-nowrap font-mono text-xs text-[#6b7280]">
                    {raw.tenderId || '—'}
                  </Td>
                  <Td>{truncate(jsonString(raw.normalized, 'title') || '—', 60)}</Td>
                  <Td className="whitespace-nowrap text-[#374151]">{raw.filterResult ?? '—'}</Td>
                  <Td className="text-[#6b7280]">{truncate(raw.filterReason ?? '—', 60)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <div className="px-5 pb-4">
          <Pagination
            basePath={`/ejecuciones/${run.id}`}
            currentPage={rawPage}
            totalPages={rawTotalPages}
            searchParams={{ tab: activeTab.key, rawPage: String(rawPage) }}
            pageParamName="rawPage"
          />
        </div>
      </Card>
    </div>
  )
}
