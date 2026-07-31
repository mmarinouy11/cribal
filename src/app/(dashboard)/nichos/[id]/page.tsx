import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { NicheStatusSelect } from '@/components/niche/niche-status-select'
import { NicheAnalyzeButton } from '@/components/niche/niche-analyze-button'
import { NicheNotes } from '@/components/niche/niche-notes'
import {
  SignalBadge,
  NicheCategoryBadge,
  FailureTypeTag,
} from '@/components/niche/niche-badges'
import { formatDateDMY, formatRelativeTime } from '@/lib/format'

/** Minimal markdown: **bold** inline + line breaks. */
function renderAnalysis(text: string): ReactNode[] {
  return text.split('\n').map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
    return (
      <p key={lineIndex} className={line.trim() === '' ? 'h-2' : 'text-sm text-[#0c1e3c]'}>
        {parts.map((part, partIndex) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={partIndex} className="font-semibold text-[#0c1e3c]">
              {part.slice(2, -2)}
            </strong>
          ) : (
            <span key={partIndex}>{part}</span>
          )
        )}
      </p>
    )
  })
}

export default async function NicheDetailPage({ params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) redirect('/login')

  const niche = await prisma.niche.findFirst({
    where: { id: params.id, companyId: session.user.companyId },
    include: { failures: { orderBy: { publicationDate: 'desc' } } },
  })
  if (!niche) notFound()

  return (
    <div className="space-y-6">
      <Link href="/nichos" className="text-sm text-[#0e7490] hover:underline">
        ← Volver a nichos
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <SignalBadge signal={niche.signalStrength} />
            <NicheCategoryBadge category={niche.category} />
            <span className="text-sm font-semibold text-[#0c1e3c]">Encaje {niche.fitScore}/10</span>
          </div>
          <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">
            {niche.label}
          </h1>
          <p className="text-sm text-[#6b7280]">
            {niche.organismo}
            {niche.articleCode ? ` · Cód. Artículo ${niche.articleCode}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#6b7280]">
          Estado
          <NicheStatusSelect id={niche.id} status={niche.status} />
        </div>
      </header>

      {niche.category === 'ADYACENTE' && niche.missingCapability && (
        <div className="rounded-xl border border-[#ddd6fe] bg-[#f5f3ff] p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#5b21b6]">
            <i className="ti ti-stairs-up" aria-hidden />
            Qué le faltaría a la empresa
          </h2>
          <p className="mt-2 text-sm text-[#4c1d95]">{niche.missingCapability}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Timeline de fallos */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-[#0c1e3c]">
                Historial de fallos ({niche.failures.length})
              </h2>
            </CardHeader>
            <CardBody>
              <ol className="space-y-4">
                {niche.failures.map((failure) => (
                  <li key={failure.id} className="flex gap-3">
                    <div className="mt-1 flex flex-col items-center">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#06b6d4]" />
                      <span className="mt-1 w-px flex-1 bg-[#e0f2fe]" />
                    </div>
                    <div className="flex-1 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#0c1e3c]">
                          {formatDateDMY(failure.publicationDate)}
                        </span>
                        <FailureTypeTag type={failure.failureType} count={1} />
                      </div>
                      <p className="mt-1 text-sm text-[#334155]">{failure.title}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-[#6b7280]">
                        <span className="font-mono">ID ARCE {failure.tenderId}</span>
                        <a
                          href={failure.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0e7490] hover:underline"
                        >
                          Ver en ARCE →
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          {/* Análisis IA */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[#0c1e3c]">Análisis con IA</h2>
                <NicheAnalyzeButton nicheId={niche.id} hasAnalysis={Boolean(niche.aiAnalysis)} />
              </div>
            </CardHeader>
            <CardBody>
              {niche.aiAnalysis ? (
                <div className="space-y-1">
                  {renderAnalysis(niche.aiAnalysis)}
                  {niche.analyzedAt && (
                    <p className="mt-3 text-xs text-[#94a3b8]">
                      Generado {formatRelativeTime(niche.analyzedAt)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[#6b7280]">
                  Todavía no analizaste este nicho. Generá un análisis para entender por qué falló y
                  cómo entrar.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Panel lateral */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-[#0c1e3c]">Resumen</h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm text-[#334155]">
              <div className="flex justify-between">
                <span className="text-[#6b7280]">Fallos totales</span>
                <span className="font-medium text-[#0c1e3c]">{niche.failureCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6b7280]">Desiertas</span>
                <span className="font-medium text-[#0c1e3c]">{niche.desiertaCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6b7280]">Ofertas rechazadas</span>
                <span className="font-medium text-[#0c1e3c]">{niche.rechazadaCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6b7280]">Primer fallo</span>
                <span className="font-medium text-[#0c1e3c]">
                  {formatDateDMY(niche.firstFailureAt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6b7280]">Último fallo</span>
                <span className="font-medium text-[#0c1e3c]">
                  {formatDateDMY(niche.lastFailureAt)}
                </span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-[#0c1e3c]">Notas</h2>
            </CardHeader>
            <CardBody>
              <NicheNotes nicheId={niche.id} initialNotes={niche.notes ?? ''} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
