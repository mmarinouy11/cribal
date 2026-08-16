import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { OpportunityStatus, Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { CategoryBadge } from '@/components/ui/category-badge'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button-styles'
import { OpportunityActions } from '@/components/opportunity/opportunity-actions'
import { LicitacionTimeline } from '@/components/opportunity/licitacion-timeline'
import { ProposalGenerator } from '@/components/proposal/proposal-generator'
import { DetailTabs, type DetailTab } from '@/components/opportunity/detail-tabs'
import { EnrichButton } from '@/components/opportunity/enrich-button'
import { MarketPanel, type MarketAnalysisView } from '@/components/opportunity/market-panel'
import { PliegoChat } from '@/components/opportunity/pliego-chat'
import { scoreColorClass } from '@/components/ui/score-badge'
import { getBusinessDaysUntilClosing, getUrgencyLevel } from '@/lib/urgency-utils'
import { formatDateDMY, formatDateTime } from '@/lib/format'
import { opportunityObjeto, opportunitySubtitle } from '@/lib/opportunity-labels'
import type { ProposalData } from '@/lib/actions/proposals'
import type { TenderItem } from '@/lib/scraper/arce-parser'
import type {
  AdjudicationRecord,
  CompetitorProfile,
  PriceIntelligence,
} from '@/lib/scraper/market-intelligence'

type SearchParams = { [key: string]: string | string[] | undefined }

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">{label}</div>
      <div className="mt-0.5 text-sm text-[#0c1e3c]">{value}</div>
    </div>
  )
}

const URGENCY_BADGE: Record<
  ReturnType<typeof getUrgencyLevel>,
  { label: string; className: string }
> = {
  critical: { label: '🔴 CRÍTICO', className: 'bg-red-100 text-red-700' },
  urgent: { label: '🟠 URGENTE', className: 'bg-amber-100 text-amber-700' },
  soon: { label: '🟡 PRÓXIMO', className: 'bg-yellow-100 text-yellow-700' },
  normal: { label: '🟢 Normal', className: 'bg-[#d1fae5] text-[#065f46]' },
}

function tenderItemsFromJson(value: Prisma.JsonValue | null): TenderItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item)
  ) as unknown as TenderItem[]
}

function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-[#6b7280]">{label}</span>
      <span className="text-[#0c1e3c]">{value}</span>
    </div>
  )
}

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: SearchParams
}) {
  const session = await auth()
  if (!session) redirect('/login')

  // Regular users are scoped to their own company; admins may open any record.
  const isAdmin = session.user.role === 'ADMIN'
  const opportunity = await prisma.opportunity.findFirst({
    where: isAdmin ? { id: params.id } : { id: params.id, companyId: session.user.companyId },
  })
  if (!opportunity) notFound()

  const tabParam = firstValue(searchParams.tab)
  const tab: DetailTab =
    tabParam === 'mercado' || tabParam === 'propuesta' || tabParam === 'chat'
      ? tabParam
      : 'detalle'

  const [proposalRow, marketRow, chatRow] = await Promise.all([
    prisma.proposal.findFirst({
      where: { opportunityId: opportunity.id, companyId: opportunity.companyId },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.marketAnalysis.findFirst({
      where: { opportunityId: opportunity.id, companyId: opportunity.companyId },
      orderBy: { analyzedAt: 'desc' },
    }),
    prisma.pliegoChat.findUnique({
      where: {
        opportunityId_companyId: {
          opportunityId: opportunity.id,
          companyId: opportunity.companyId,
        },
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    }),
  ])

  const chatMessages = chatRow?.messages ?? []

  const savedProposal: ProposalData | null = proposalRow
    ? {
        executiveSummary: proposalRow.executiveSummary ?? '',
        valueProposition: proposalRow.valueProposition ?? '',
        relevantCapabilities: proposalRow.relevantCapabilities ?? '',
        clarificationQuestions: proposalRow.clarificationQuestions ?? '',
        nextSteps: proposalRow.nextSteps ?? '',
      }
    : null

  const marketAnalysis: MarketAnalysisView | null = marketRow
    ? {
        adjudications: marketRow.adjudications as unknown as AdjudicationRecord[],
        competitors: marketRow.competitors as unknown as CompetitorProfile[],
        priceRange: marketRow.priceRange as unknown as PriceIntelligence,
        summary: marketRow.summary,
        analyzedAt: marketRow.analyzedAt.toISOString(),
      }
    : null

  const scoreWidth = `${Math.max(0, Math.min(10, opportunity.score)) * 10}%`
  const closingHasPassed =
    opportunity.closingDate !== null && opportunity.closingDate.getTime() < Date.now()
  // The visual timeline is only shown while the opportunity is being worked.
  const showTimeline = (['REVISANDO', 'RELEVANTE', 'OFERTADA'] as OpportunityStatus[]).includes(
    opportunity.status
  )

  const items = tenderItemsFromJson(opportunity.tenderItems)
  const businessDays = opportunity.closingDate
    ? getBusinessDaysUntilClosing(opportunity.closingDate)
    : null
  const urgencyBadge =
    businessDays !== null ? URGENCY_BADGE[getUrgencyLevel(businessDays)] : null
  const hasContact =
    opportunity.contactEmail || opportunity.contactPhone || opportunity.contactName || opportunity.pliegoUrl

  return (
    <div className="space-y-6">
      <Link href="/oportunidades" className="text-sm text-[#0e7490] hover:underline">
        ← Volver a oportunidades
      </Link>

      <DetailTabs opportunityId={opportunity.id} active={tab} chatCount={chatMessages.length} />

      {tab === 'detalle' && (
        <div className="space-y-6">
          <OpportunityActions
            id={opportunity.id}
            status={opportunity.status}
            closingHasPassed={closingHasPassed}
          />

          <div className="space-y-6">
            <Card>
              <CardBody className="space-y-4">
                <div>
                  <h1 className="text-xl font-bold text-[#0c1e3c]">
                    {opportunityObjeto(opportunity, 160)}
                  </h1>
                  <p className="mt-1 text-sm text-[#6b7280]">
                    {opportunitySubtitle(opportunity)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={opportunity.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClass('primary', 'sm')}
                  >
                    Ver en ARCE →
                  </a>
                  <EnrichButton opportunityId={opportunity.id} />
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-[#e0f2fe] pt-4">
                  <MetaItem
                    label="Fecha de publicación"
                    value={formatDateDMY(opportunity.publicationDate)}
                  />
                  <MetaItem label="Fuente" value={opportunity.sourceType} />
                </div>

                <div className="border-t border-[#e0f2fe] pt-4">
                  {opportunity.stageGatePassed === false ? (
                    <Badge className="bg-red-100 text-red-700">❌ Adjudicación/cierre</Badge>
                  ) : (
                    <Badge className="bg-[#d1fae5] text-[#065f46]">✅ Llamado abierto</Badge>
                  )}
                  {opportunity.stageGateReason && (
                    <p className="mt-2 text-sm text-[#6b7280]">{opportunity.stageGateReason}</p>
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Key dates — visual timeline while the opportunity is being worked,
                compact list otherwise. */}
            {showTimeline ? (
              <Card>
                <CardBody>
                  <h3 className="mb-4 font-semibold text-[#0c1e3c]">Línea de tiempo</h3>
                  {opportunity.enrichedAt ? (
                    <LicitacionTimeline
                      publicationDate={opportunity.publicationDate}
                      clarificationsDate={opportunity.clarificationsDate}
                      prorrogasDate={opportunity.prorrogasDate}
                      closingDate={opportunity.closingDate}
                      openingDate={opportunity.openingDate}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm text-[#6b7280]">
                        Datos del llamado no disponibles aún.
                      </p>
                      <EnrichButton opportunityId={opportunity.id} />
                    </div>
                  )}
                </CardBody>
              </Card>
            ) : (
              opportunity.enrichedAt && (
                <Card>
                  <CardBody>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-[#0c1e3c]">Fechas clave</h3>
                      {urgencyBadge && (
                        <Badge className={urgencyBadge.className}>{urgencyBadge.label}</Badge>
                      )}
                    </div>
                    <DateRow
                      label="Recepción de ofertas"
                      value={
                        opportunity.closingDate
                          ? `${formatDateTime(opportunity.closingDate)}${
                              businessDays !== null ? ` · ${businessDays} día(s) hábil(es)` : ''
                            }`
                          : '—'
                      }
                    />
                    <DateRow label="Acto de apertura" value={formatDateTime(opportunity.openingDate)} />
                    <DateRow label="Prórrogas hasta" value={formatDateTime(opportunity.prorrogasDate)} />
                    <DateRow
                      label="Aclaraciones hasta"
                      value={formatDateTime(opportunity.clarificationsDate)}
                    />
                    {opportunity.isElectronic !== null && (
                      <DateRow
                        label="Apertura electrónica"
                        value={opportunity.isElectronic ? 'Sí' : 'No'}
                      />
                    )}
                  </CardBody>
                </Card>
              )
            )}

            {/* Tender items */}
            {items.length > 0 && (
              <Card>
                <div className="border-b border-[#e0f2fe] px-5 py-4">
                  <h3 className="font-semibold text-[#0c1e3c]">Ítems del llamado ({items.length})</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#f0f9ff]">
                      <tr className="text-left text-xs uppercase text-[#6b7280]">
                        <th className="px-4 py-2">Ítem #</th>
                        <th className="px-4 py-2">Nombre</th>
                        <th className="px-4 py-2">Cód. Artículo</th>
                        <th className="px-4 py-2">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e0f2fe]">
                      {items.map((item, i) => (
                        <tr key={`${item.itemNumber}-${i}`}>
                          <td className="px-4 py-2 text-[#6b7280]">{item.itemNumber}</td>
                          <td className="px-4 py-2 text-[#0c1e3c]">{item.name}</td>
                          <td className="px-4 py-2 text-[#6b7280]">{item.articleCode ?? '—'}</td>
                          <td className="px-4 py-2 text-[#6b7280]">{item.quantity ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Contact */}
            {hasContact && (
              <Card>
                <CardBody className="space-y-1">
                  <h3 className="mb-2 font-semibold text-[#0c1e3c]">Contacto</h3>
                  {opportunity.contactName && (
                    <DateRow label="Nombre" value={opportunity.contactName} />
                  )}
                  {opportunity.contactEmail && (
                    <DateRow label="Email" value={opportunity.contactEmail} />
                  )}
                  {opportunity.contactPhone && (
                    <DateRow label="Teléfono" value={opportunity.contactPhone} />
                  )}
                  {opportunity.pliegoUrl && (
                    <a
                      href={opportunity.pliegoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-sm text-[#0e7490] hover:underline"
                    >
                      📄 Descargar pliego (PDF)
                    </a>
                  )}
                </CardBody>
              </Card>
            )}

            <Card>
              <CardBody className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                      Puntaje IA
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span
                        className={`rounded-lg px-3 py-1 text-3xl font-bold ${scoreColorClass(opportunity.score)}`}
                      >
                        {opportunity.score}
                      </span>
                      <span className="text-sm text-[#6b7280]">/ 10</span>
                    </div>
                  </div>
                  <CategoryBadge category={opportunity.category} />
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-[#e0f2fe]">
                  <div className="h-full rounded-full bg-[#06b6d4]" style={{ width: scoreWidth }} />
                </div>

                {opportunity.summary && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                      Resumen IA
                    </div>
                    <p className="mt-1 text-sm text-[#0c1e3c]">{opportunity.summary}</p>
                  </div>
                )}

                {opportunity.recommendedPlay && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                    <div className="text-sm font-semibold text-[#0c1e3c]">💡 Jugada recomendada</div>
                    <p className="mt-1 text-sm text-[#0c1e3c]">{opportunity.recommendedPlay}</p>
                  </div>
                )}
              </CardBody>
            </Card>

            {opportunity.description && (
              <Card>
                <CardBody>
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-[#0c1e3c]">
                      Descripción original
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-[#374151]">
                      {opportunity.description}
                    </p>
                  </details>
                </CardBody>
              </Card>
            )}

            <Card>
              <CardBody className="space-y-2 text-sm text-[#6b7280]">
                <div>
                  <span className="font-medium text-[#0c1e3c]">Detectada:</span>{' '}
                  {formatDateTime(opportunity.detectedAt)}
                </div>
                <div className="break-all">
                  <span className="font-medium text-[#0c1e3c]">Run ID:</span> {opportunity.runId}
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === 'mercado' && (
        <MarketPanel
          opportunityId={opportunity.id}
          status={opportunity.status}
          analysis={marketAnalysis}
        />
      )}

      {tab === 'chat' && (
        <PliegoChat
          opportunityId={opportunity.id}
          initialMessages={chatMessages}
          hasPliego={Boolean(opportunity.pliegoUrl)}
          pliegoUrl={opportunity.pliegoUrl}
          hasArticleCodes={items.some((item) => Boolean(item.articleCode))}
        />
      )}

      {tab === 'propuesta' && (
        <ProposalGenerator
          opportunityId={opportunity.id}
          opportunity={{ title: opportunity.title, organismo: opportunity.organismo ?? '' }}
          savedProposal={savedProposal}
        />
      )}
    </div>
  )
}
