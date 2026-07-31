import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Prisma,
  NicheCategory,
  NicheStatus,
  SignalStrength,
  FailureType,
  type Niche,
  type FailedTender,
} from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card } from '@/components/ui/card'
import { NicheFilters } from '@/components/niche/niche-filters'
import { NicheStatusSelect } from '@/components/niche/niche-status-select'
import {
  SignalBadge,
  NicheCategoryBadge,
  FailureTypeTag,
  RecallTag,
  SIGNAL_META,
} from '@/components/niche/niche-badges'
import { formatRelativeTime } from '@/lib/format'

type SearchParams = { [key: string]: string | string[] | undefined }

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const SIGNAL_RANK: Record<SignalStrength, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 }
// ADYACENTE ranks before NUCLEO on a signal tie: it is what the user cannot find
// through any other channel.
const CATEGORY_RANK: Record<NicheCategory, number> = { ADYACENTE: 0, NUCLEO: 1, FUERA: 2 }

const RECALL_WINDOW_DAYS = 60

function isValidEnum<T extends Record<string, string>>(
  enumObj: T,
  value: string | undefined
): value is T[keyof T] {
  return value !== undefined && Object.values(enumObj).includes(value)
}

function monthsBetween(first: Date, last: Date): number {
  return Math.max(
    0,
    (last.getFullYear() - first.getFullYear()) * 12 + (last.getMonth() - first.getMonth())
  )
}

function daysAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
}

export default async function NichesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const session = await auth()
  if (!session) redirect('/login')
  const companyId = session.user.companyId

  const signal = firstValue(searchParams.signal)
  const category = firstValue(searchParams.category)
  const failureType = firstValue(searchParams.failureType)
  const status = firstValue(searchParams.status)
  const organismo = firstValue(searchParams.organismo)

  // Category=FUERA is an audit view: it lists the discarded failures (which never
  // become niches) so the user can spot misclassifications.
  const isFueraAudit = category === NicheCategory.FUERA

  let niches: Niche[] = []
  let discarded: FailedTender[] = []

  if (isFueraAudit) {
    const fWhere: Prisma.FailedTenderWhereInput = { companyId, nicheCategory: NicheCategory.FUERA }
    if (isValidEnum(FailureType, failureType)) fWhere.failureType = failureType
    if (organismo) fWhere.organismo = { contains: organismo, mode: 'insensitive' }
    discarded = await prisma.failedTender.findMany({
      where: fWhere,
      orderBy: { publicationDate: 'desc' },
      take: 200,
    })
  } else {
    const where: Prisma.NicheWhereInput = { companyId }
    if (isValidEnum(SignalStrength, signal)) where.signalStrength = signal
    if (category === NicheCategory.NUCLEO || category === NicheCategory.ADYACENTE) {
      where.category = category
    }
    if (isValidEnum(NicheStatus, status)) {
      where.status = status
    } else {
      // By default hide discarded/archived niches; a status filter overrides this.
      where.status = { notIn: [NicheStatus.DESCARTADO, NicheStatus.ARCHIVADO] }
    }
    if (isValidEnum(FailureType, failureType)) {
      if (failureType === FailureType.DESIERTA) where.desiertaCount = { gt: 0 }
      else where.rechazadaCount = { gt: 0 }
    }
    if (organismo) where.organismo = { contains: organismo, mode: 'insensitive' }

    niches = await prisma.niche.findMany({ where })

    // Sort: signal desc → category (adyacente first) → lastFailureAt desc.
    niches.sort((a, b) => {
      if (SIGNAL_RANK[a.signalStrength] !== SIGNAL_RANK[b.signalStrength]) {
        return SIGNAL_RANK[a.signalStrength] - SIGNAL_RANK[b.signalStrength]
      }
      if (CATEGORY_RANK[a.category] !== CATEGORY_RANK[b.category]) {
        return CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]
      }
      return b.lastFailureAt.getTime() - a.lastFailureAt.getTime()
    })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">
          Nichos de oportunidad
        </h1>
        <p className="max-w-3xl text-[13px] text-[#6b7280]">
          Licitaciones que quedaron desiertas o cuyas ofertas fueron rechazadas. Demanda estatal
          insatisfecha, incluyendo rubros donde tu empresa todavía no opera.
        </p>
      </header>

      <NicheFilters />

      {isFueraAudit ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-[#e0f2fe] bg-[#f8fafc] px-4 py-3 text-[13px] text-[#6b7280]">
            Fallos descartados por la IA como fuera del alcance de la empresa. No generan nichos;
            se listan para auditar posibles errores de clasificación.
          </p>
          {discarded.length === 0 ? (
            <Card>
              <p className="px-5 py-12 text-center text-sm text-[#6b7280]">
                No hay fallos descartados.
              </p>
            </Card>
          ) : (
            discarded.map((failure) => (
              <div
                key={failure.id}
                className="rounded-xl border border-[#e0f2fe] bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <NicheCategoryBadge category="FUERA" />
                    <FailureTypeTag type={failure.failureType} count={1} />
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-[#6b7280]">
                    Encaje {failure.fitScore}/10
                  </span>
                </div>
                <h2 className="mt-3 font-medium text-[#0c1e3c]">{failure.title}</h2>
                {failure.organismo && (
                  <p className="mt-1 text-sm text-[#6b7280]">{failure.organismo}</p>
                )}
                {failure.fitReason && (
                  <p className="mt-2 text-sm text-[#334155]">{failure.fitReason}</p>
                )}
                <div className="mt-3">
                  <a
                    href={failure.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] font-medium text-[#0e7490] hover:underline"
                  >
                    Ver en ARCE →
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      ) : niches.length === 0 ? (
        <Card>
          <p className="px-5 py-12 text-center text-sm text-[#6b7280]">
            Todavía no detectamos nichos. El pipeline los busca en cada ejecución.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {niches.map((niche) => {
            const months = monthsBetween(niche.firstFailureAt, niche.lastFailureAt)
            const showRecall =
              niche.failureCount === 1 && daysAgo(niche.lastFailureAt) < RECALL_WINDOW_DAYS
            const showMissing =
              niche.category === 'ADYACENTE' && Boolean(niche.missingCapability)

            return (
              <div
                key={niche.id}
                className="rounded-xl border border-[#e0f2fe] border-l-4 bg-white p-5 shadow-sm"
                style={{ borderLeftColor: SIGNAL_META[niche.signalStrength].borderColor }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SignalBadge signal={niche.signalStrength} />
                    <NicheCategoryBadge category={niche.category} />
                    {showRecall && <RecallTag />}
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-[#0c1e3c]">
                    Encaje {niche.fitScore}/10
                  </span>
                </div>

                <h2 className="mt-3 font-semibold text-[#0c1e3c]">{niche.label}</h2>
                {niche.objectDescription && (
                  <p className="mt-1 text-sm text-[#334155]">{niche.objectDescription}</p>
                )}
                <p className="mt-1 text-sm text-[#6b7280]">
                  {niche.failureCount} llamado{niche.failureCount === 1 ? '' : 's'} fallido
                  {niche.failureCount === 1 ? '' : 's'}
                  {months > 0 ? ` en ${months} mes${months === 1 ? '' : 'es'}` : ''} · último{' '}
                  {formatRelativeTime(niche.lastFailureAt)}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <FailureTypeTag type="DESIERTA" count={niche.desiertaCount} />
                  <FailureTypeTag type="OFERTAS_RECHAZADAS" count={niche.rechazadaCount} />
                </div>

                {showMissing && (
                  <p className="mt-3 text-sm text-[#5b21b6]">
                    <span className="font-medium">Faltaría:</span> {niche.missingCapability}
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between">
                  <Link
                    href={`/nichos/${niche.id}`}
                    className="text-[13px] font-medium text-[#06b6d4] hover:underline"
                  >
                    Ver detalle →
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                    Estado
                    <NicheStatusSelect id={niche.id} status={niche.status} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
