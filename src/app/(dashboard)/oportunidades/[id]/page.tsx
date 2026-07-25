import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { CategoryBadge } from '@/components/ui/category-badge'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button-styles'
import { ReviewPanel } from '@/components/review-panel'
import { ProposalGenerator } from '@/components/proposal/proposal-generator'
import { scoreColorClass } from '@/components/ui/score-badge'
import { formatDateDMY, formatDateTime } from '@/lib/format'
import type { ProposalData } from '@/lib/actions/proposals'

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-[#111827]">{value}</div>
    </div>
  )
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const session = await auth()
  if (!session) redirect('/login')

  // Regular users are scoped to their own company; admins may open any record.
  const isAdmin = session.user.role === 'ADMIN'
  const opportunity = await prisma.opportunity.findFirst({
    where: isAdmin
      ? { id: params.id }
      : { id: params.id, companyId: session.user.companyId },
  })

  if (!opportunity) notFound()

  // Scope the proposal to the opportunity's own company (works for admins too).
  const proposalRow = await prisma.proposal.findFirst({
    where: { opportunityId: opportunity.id, companyId: opportunity.companyId },
    orderBy: { updatedAt: 'desc' },
  })

  const savedProposal: ProposalData | null = proposalRow
    ? {
        executiveSummary: proposalRow.executiveSummary ?? '',
        valueProposition: proposalRow.valueProposition ?? '',
        relevantCapabilities: proposalRow.relevantCapabilities ?? '',
        clarificationQuestions: proposalRow.clarificationQuestions ?? '',
        nextSteps: proposalRow.nextSteps ?? '',
      }
    : null

  const scoreWidth = `${Math.max(0, Math.min(10, opportunity.score)) * 10}%`
  const rawOutput = opportunity.aiRawOutput
    ? JSON.stringify(opportunity.aiRawOutput, null, 2)
    : null
  const followUp = opportunity.nextFollowUpDate
    ? new Date(opportunity.nextFollowUpDate).toISOString().slice(0, 10)
    : null

  return (
    <div className="space-y-6">
      <Link href="/oportunidades" className="text-sm text-[#2563eb] hover:underline">
        ← Volver a oportunidades
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column — tender information */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody className="space-y-4">
              <h1 className="text-xl font-bold text-[#111827]">{opportunity.title}</h1>

              <a
                href={opportunity.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('primary', 'sm')}
              >
                Ver en ARCE →
              </a>

              <div className="grid grid-cols-2 gap-4 border-t border-[#e5e7eb] pt-4">
                <MetaItem label="Organismo" value={opportunity.organismo ?? '—'} />
                <MetaItem label="Tipo de llamado" value={opportunity.tenderType ?? '—'} />
                <MetaItem
                  label="Fecha de publicación"
                  value={formatDateDMY(opportunity.publicationDate)}
                />
                <MetaItem label="Fuente" value={opportunity.sourceType} />
              </div>

              <div className="border-t border-[#e5e7eb] pt-4">
                {opportunity.stageGatePassed === false ? (
                  <Badge className="bg-red-100 text-red-700">❌ Adjudicación/cierre</Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700">✅ Llamado abierto</Badge>
                )}
                {opportunity.stageGateReason && (
                  <p className="mt-2 text-sm text-[#6b7280]">{opportunity.stageGateReason}</p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                    Score IA
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={`rounded-lg px-3 py-1 text-3xl font-bold ${scoreColorClass(opportunity.score)}`}>
                      {opportunity.score}
                    </span>
                    <span className="text-sm text-[#6b7280]">/ 10</span>
                  </div>
                </div>
                <CategoryBadge category={opportunity.category} />
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-[#e5e7eb]">
                <div className="h-full rounded-full bg-[#2563eb]" style={{ width: scoreWidth }} />
              </div>

              {opportunity.summary && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                    Resumen IA
                  </div>
                  <p className="mt-1 text-sm text-[#111827]">{opportunity.summary}</p>
                </div>
              )}

              {opportunity.recommendedPlay && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                  <div className="text-sm font-semibold text-[#1e3a5f]">💡 Jugada recomendada</div>
                  <p className="mt-1 text-sm text-[#111827]">{opportunity.recommendedPlay}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {opportunity.description && (
            <Card>
              <CardBody>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-[#111827]">
                    Descripción original
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-[#374151]">
                    {opportunity.description}
                  </p>
                </details>
              </CardBody>
            </Card>
          )}

          {rawOutput && (
            <Card>
              <CardBody>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-[#111827]">
                    Salida cruda de la IA (debug)
                  </summary>
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-[#0f172a] p-4 text-xs text-white">
                    {rawOutput}
                  </pre>
                </details>
              </CardBody>
            </Card>
          )}

          <ProposalGenerator
            opportunityId={opportunity.id}
            opportunity={{
              title: opportunity.title,
              organismo: opportunity.organismo ?? '',
            }}
            savedProposal={savedProposal}
          />
        </div>

        {/* Right column — review panel */}
        <div className="space-y-4">
          <Card>
            <CardBody>
              <h2 className="mb-4 font-semibold text-[#111827]">Revisión</h2>
              <ReviewPanel
                id={opportunity.id}
                status={opportunity.status}
                owner={opportunity.owner}
                nextAction={opportunity.nextAction}
                nextFollowUpDate={followUp}
                notes={opportunity.notes}
              />
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2 text-sm text-[#6b7280]">
              <div>
                <span className="font-medium text-[#111827]">Detectada:</span>{' '}
                {formatDateTime(opportunity.detectedAt)}
              </div>
              <div className="break-all">
                <span className="font-medium text-[#111827]">Run ID:</span> {opportunity.runId}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
