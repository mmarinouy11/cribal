import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card } from '@/components/ui/card'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table'
import { ClickableRow } from '@/components/ui/clickable-row'
import { RunStatusBadge } from '@/components/ui/run-status-badge'
import { Pagination } from '@/components/ui/pagination'
import { RunPipelineButton } from '@/components/run-pipeline-button'
import { getEffectiveCompanyId } from '@/lib/tenant'
import { formatDateTime, formatDuration } from '@/lib/format'

const PAGE_SIZE = 20

type SearchParams = { [key: string]: string | string[] | undefined }

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const companyIdParam = firstValue(searchParams.companyId)
  const companyId = getEffectiveCompanyId(session, companyIdParam)

  const page = Math.max(1, Number(firstValue(searchParams.page)) || 1)

  const [total, runs] = await Promise.all([
    prisma.run.count({ where: { companyId } }),
    prisma.run.findMany({
      where: { companyId },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">Historial de ejecuciones</h1>
        <RunPipelineButton label="Correr ahora" />
      </header>

      <Card>
        {runs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[#6b7280]">
            Todavía no hay ejecuciones.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Fecha</Th>
                <Th>Estado</Th>
                <Th>Feeds</Th>
                <Th>Items</Th>
                <Th>Tras fecha</Th>
                <Th>Tras keywords</Th>
                <Th>Tras stage-gate</Th>
                <Th>Enviados a IA</Th>
                <Th>Guardados</Th>
                <Th>Duración</Th>
              </Tr>
            </THead>
            <TBody>
              {runs.map((run) => (
                <ClickableRow key={run.id} href={`/ejecuciones/${run.id}`}>
                  <Td className="whitespace-nowrap">{formatDateTime(run.startedAt)}</Td>
                  <Td>
                    <RunStatusBadge status={run.status} />
                  </Td>
                  <Td>{run.feedsChecked}</Td>
                  <Td>{run.rawItemsFound}</Td>
                  <Td>{run.itemsAfterDateFilter}</Td>
                  <Td>{run.itemsAfterKeyword}</Td>
                  <Td>{run.itemsAfterStageGate}</Td>
                  <Td>{run.itemsSentToAi}</Td>
                  <Td className="font-medium text-[#0c1e3c]">{run.opportunitiesSaved}</Td>
                  <Td className="whitespace-nowrap text-[#6b7280]">
                    {formatDuration(run.startedAt, run.finishedAt)}
                  </Td>
                </ClickableRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Pagination
        basePath="/ejecuciones"
        currentPage={page}
        totalPages={totalPages}
        searchParams={{ companyId: companyIdParam }}
      />
    </div>
  )
}
