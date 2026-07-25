'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { triggerMarketAnalysis } from '@/lib/actions/market'
import type {
  AdjudicationRecord,
  CompetitorProfile,
  PriceIntelligence,
} from '@/lib/scraper/market-intelligence'

export interface MarketAnalysisView {
  adjudications: AdjudicationRecord[]
  competitors: CompetitorProfile[]
  priceRange: PriceIntelligence
  summary: string | null
  analyzedAt: string
}

interface MarketPanelProps {
  opportunityId: string
  status: string
  analysis: MarketAnalysisView | null
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-UY', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'UYU',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${amount.toLocaleString('es-UY')}`
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">{children}</div>
}

export function MarketPanel({ opportunityId, status, analysis }: MarketPanelProps) {
  const router = useRouter()
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  const unlocked = status === 'RELEVANTE' || status === 'REVISANDO'

  async function runAnalysis(isUpdate: boolean) {
    if (isUpdate && !window.confirm('¿Actualizar análisis? Esta función consume créditos de API.')) {
      return
    }
    setIsAnalyzing(true)
    try {
      const result = await triggerMarketAnalysis(opportunityId)
      if (result.success) {
        setToast({ message: 'Análisis de mercado completado', type: 'success' })
        router.refresh()
      } else {
        setToast({ message: result.error ?? 'No se pudo analizar el mercado', type: 'error' })
      }
    } catch {
      setToast({ message: 'No se pudo analizar el mercado', type: 'error' })
    } finally {
      setIsAnalyzing(false)
    }
  }

  if (!unlocked) {
    return (
      <Card>
        <p className="text-sm text-[#6b7280]">
          🔒 Análisis de mercado disponible para oportunidades en estado Relevante o Revisando.
          Cambiá el estado para habilitar esta función.
        </p>
      </Card>
    )
  }

  if (isAnalyzing) {
    return (
      <Card>
        <div className="flex items-center gap-3 py-6">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#1e3a5f] border-t-transparent" />
          <span className="text-sm text-[#111827]">
            Analizando mercado… esto puede tomar 30-60 segundos
          </span>
        </div>
      </Card>
    )
  }

  if (!analysis) {
    return (
      <>
        <Card>
          <h2 className="font-semibold text-[#111827]">📊 Análisis de mercado</h2>
          <p className="mt-2 text-sm text-[#6b7280]">
            Buscá licitaciones históricas similares, identificá competidores y obtené
            referencias de precio para preparar tu oferta.
          </p>
          <div className="mt-4">
            <Button onClick={() => runAnalysis(false)}>🔍 Analizar mercado</Button>
          </div>
          <p className="mt-3 text-xs text-[#d97706]">
            ⚠️ Esta función consume créditos de API. Usala cuando hayas decidido postular.
          </p>
        </Card>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </>
    )
  }

  const { adjudications, competitors, priceRange, summary } = analysis
  const currency = priceRange.currency

  // Position of the suggested range within the [min, max] band, as percentages.
  const span = Math.max(1, priceRange.max - priceRange.min)
  const lowPct = Math.max(0, ((priceRange.suggestedRange.low - priceRange.min) / span) * 100)
  const highPct = Math.min(100, ((priceRange.suggestedRange.high - priceRange.min) / span) * 100)

  return (
    <div className="space-y-6">
      {/* Adjudicaciones similares */}
      <Card>
        <h2 className="mb-3 font-semibold text-[#111827]">
          Adjudicaciones similares ({adjudications.length})
        </h2>
        {adjudications.length === 0 ? (
          <p className="text-sm text-[#6b7280]">No se encontraron adjudicaciones similares.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[#6b7280]">
                  <th className="py-2 pr-4">Organismo</th>
                  <th className="py-2 pr-4">Objeto</th>
                  <th className="py-2 pr-4">Adjudicado a</th>
                  <th className="py-2 pr-4">Monto</th>
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb]">
                {adjudications.map((adj, i) => (
                  <tr key={`${adj.tenderId}-${i}`}>
                    <td className="py-2 pr-4 text-[#6b7280]">{adj.organismo || '—'}</td>
                    <td className="py-2 pr-4 text-[#111827]">
                      {adj.objeto.length > 50 ? `${adj.objeto.slice(0, 50)}…` : adj.objeto}
                    </td>
                    <td className="py-2 pr-4 text-[#111827]">{adj.adjudicatedTo}</td>
                    <td className="py-2 pr-4 text-[#111827]">
                      {adj.amount !== null ? formatMoney(adj.amount, adj.currency) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-[#6b7280]">
                      {adj.date ? new Date(adj.date).toLocaleDateString('es-UY') : '—'}
                    </td>
                    <td className="py-2">
                      <a
                        href={adj.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#2563eb] hover:underline"
                      >
                        Ver
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Mapa de competidores */}
      <Card>
        <h2 className="mb-3 font-semibold text-[#111827]">
          Mapa de competidores ({competitors.length})
        </h2>
        {competitors.length === 0 ? (
          <p className="text-sm text-[#6b7280]">No se identificaron competidores.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {competitors.map((comp, i) => (
              <div key={`${comp.rut}-${i}`} className="rounded-lg border border-[#e5e7eb] p-4">
                <p className="font-semibold text-[#1e3a5f]">{comp.name}</p>
                <p className="mt-1 text-sm text-[#334155]">
                  Participaciones: {comp.timesParticipated} · Ganadas: {comp.timesWon} · Win
                  rate: {Math.round(comp.winRate * 100)}%
                </p>
                <p className="text-sm text-[#334155]">
                  Monto total ganado: {formatMoney(comp.totalAmountWon, currency)}
                </p>
                {comp.organisms.length > 0 && (
                  <p className="mt-1 text-xs text-[#6b7280]">
                    Organismos: {comp.organisms.join(', ')}
                  </p>
                )}
                {comp.lastSeen && (
                  <p className="text-xs text-[#9ca3af]">
                    Última aparición: {new Date(comp.lastSeen).toLocaleDateString('es-UY')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Inteligencia de precios */}
      <Card>
        <h2 className="mb-3 font-semibold text-[#111827]">Inteligencia de precios</h2>
        {priceRange.sampleSize === 0 ? (
          <p className="text-sm text-[#6b7280]">
            Sin datos de precios suficientes para esta licitación.
          </p>
        ) : (
          <div>
            <p className="mb-2 text-sm text-[#6b7280]">
              Precio unitario histórico ({priceRange.sampleSize} muestras)
            </p>
            <div className="relative mt-4 h-3 w-full rounded-full bg-[#e5e7eb]">
              <div
                className="absolute top-0 h-3 rounded-full bg-[#2563eb]"
                style={{ left: `${lowPct}%`, width: `${Math.max(4, highPct - lowPct)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-[#6b7280]">
              <span>{formatMoney(priceRange.min, currency)}</span>
              <span>{formatMoney(priceRange.max, currency)}</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-[#1e3a5f]">
              Sugerido: {formatMoney(priceRange.suggestedRange.low, currency)} –{' '}
              {formatMoney(priceRange.suggestedRange.high, currency)} {currency}
            </p>
          </div>
        )}
      </Card>

      {/* Análisis IA */}
      {summary && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
          <h2 className="mb-2 font-semibold text-[#1e3a5f]">Análisis IA</h2>
          <div className="whitespace-pre-wrap text-sm text-[#111827]">{summary}</div>
        </div>
      )}

      <div>
        <Button variant="secondary" onClick={() => runAnalysis(true)}>
          Actualizar análisis
        </Button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
