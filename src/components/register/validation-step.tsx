'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAndClassifyValidationSample } from '@/lib/actions/register'
import {
  inferExclusionKeywords,
  categoriesToDrop,
  type ValidationItem,
  type Mark,
} from '@/lib/register/validation'
import { feedToLabel, feedToDetailedLabel } from '@/lib/arce/catalog'
import { CategorySelector } from '@/components/register/category-selector'

interface ValidationStepProps {
  companyName: string
  description: string
  capabilities: string[]
  relevantKeywords: string[]
  feeds: string[]
  onFeedsChange: (feeds: string[]) => void
  appliedExclusions: string[]
  onAppliedExclusionsChange: (keywords: string[]) => void
}

export function ValidationStep({
  companyName,
  description,
  capabilities,
  relevantKeywords,
  feeds,
  onFeedsChange,
  appliedExclusions,
  onAppliedExclusionsChange,
}: ValidationStepProps) {
  const [sample, setSample] = useState<ValidationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [usedFallback, setUsedFallback] = useState(false)
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({})
  const [showSelector, setShowSelector] = useState(false)
  const [suggestedExclusions, setSuggestedExclusions] = useState<string[] | null>(null)
  const [keptCategories, setKeptCategories] = useState<Set<string>>(new Set())

  const feedsKey = useMemo(() => feeds.join('||'), [feeds])
  const keywordsKey = useMemo(() => relevantKeywords.join('||'), [relevantKeywords])
  const requestRef = useRef(0)

  // (Re)load + classify the sample whenever the active categories change.
  useEffect(() => {
    const id = ++requestRef.current
    if (feeds.length === 0) {
      setSample([])
      setMarks({})
      setAiReasons({})
      setUsedFallback(false)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const result = await fetchAndClassifyValidationSample(feeds, relevantKeywords, {
          name: companyName,
          description,
          capabilities,
        })
        if (requestRef.current !== id) return
        setSample(result.items)
        setUsedFallback(result.usedFallback)
        // Pre-mark according to Claude's classification; reset overrides on reload.
        const nextMarks: Record<string, Mark> = {}
        const nextReasons: Record<string, string> = {}
        for (const item of result.items) {
          nextMarks[item.id] = item.aiRelevant ? 'relevant' : 'not_relevant'
          if (item.aiReason) nextReasons[item.id] = item.aiReason
        }
        setMarks(nextMarks)
        setAiReasons(nextReasons)
        setSuggestedExclusions(null)
      } catch {
        if (requestRef.current === id) {
          setSample([])
          setMarks({})
          setAiReasons({})
          setUsedFallback(false)
        }
      } finally {
        if (requestRef.current === id) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedsKey, keywordsKey])

  const relevantItems = sample.filter((i) => marks[i.id] === 'relevant')
  const notRelevantItems = sample.filter((i) => marks[i.id] === 'not_relevant')
  const canAnalyze = relevantItems.length > 0 && notRelevantItems.length > 0

  function addFeed(url: string) {
    if (!feeds.includes(url)) onFeedsChange([...feeds, url])
  }
  function removeFeed(url: string) {
    onFeedsChange(feeds.filter((f) => f !== url))
    setKeptCategories((prev) => {
      const next = new Set(prev)
      next.delete(url)
      return next
    })
  }

  function setMark(id: string, mark: Exclude<Mark, null>) {
    setMarks((prev) => ({ ...prev, [id]: prev[id] === mark ? null : mark }))
  }

  function analyzeMarks() {
    setSuggestedExclusions(inferExclusionKeywords(relevantItems, notRelevantItems))
  }

  function removeSuggestion(keyword: string) {
    setSuggestedExclusions((prev) => (prev ? prev.filter((k) => k !== keyword) : prev))
  }

  function applySuggestions() {
    if (!suggestedExclusions || suggestedExclusions.length === 0) return
    const merged = Array.from(new Set([...appliedExclusions, ...suggestedExclusions]))
    onAppliedExclusionsChange(merged)
    setSuggestedExclusions(null)
  }

  const dropSuggestions = canAnalyze
    ? categoriesToDrop(sample, marks).filter((s) => !keptCategories.has(s.feedSource))
    : []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#0c1e3c]">Validá tu configuración</h2>
        <p className="mt-1 text-sm text-[#6b7280]">
          Revisá las categorías inferidas y ajustá la pre-clasificación de una muestra de
          licitaciones reales. Con eso afinamos tus filtros.
        </p>
      </div>

      {/* Section A — active categories */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[#0c1e3c]">Categorías activas</h3>
        <div className="flex flex-wrap gap-2">
          {feeds.length === 0 && (
            <span className="text-sm text-[#6b7280]">No hay categorías activas.</span>
          )}
          {feeds.map((feed) => (
            <span
              key={feed}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#e0f2fe] bg-[#f0f9ff] px-3 py-1 text-sm text-[#0c1e3c]"
            >
              {feedToLabel(feed)}
              <button
                type="button"
                onClick={() => removeFeed(feed)}
                aria-label={`Quitar ${feedToLabel(feed)}`}
                className="text-[#94a3b8] hover:text-[#dc2626]"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setShowSelector((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#06b6d4] px-3 py-1 text-sm text-[#0e7490] hover:bg-[#f0f9ff]"
          >
            <i className="ti ti-plus" aria-hidden /> Agregar categoría
          </button>
        </div>

        {showSelector && (
          <CategorySelector activeFeeds={feeds} onAdd={addFeed} onRemove={removeFeed} />
        )}
      </section>

      {/* Section C — historical sample */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[#0c1e3c]">
            Muestra de licitaciones reales
            {!loading && sample.length > 0 && ` (${sample.length})`}
          </h3>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-[#e0f2fe] bg-[#f8fafc] px-4 py-10 text-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#06b6d4] border-t-transparent" />
            <p className="text-sm font-medium text-[#0c1e3c]">
              Analizando licitaciones históricas para tu empresa…
            </p>
            <p className="text-xs text-[#6b7280]">Esto toma unos segundos.</p>
          </div>
        ) : sample.length === 0 ? (
          <p className="rounded-lg border border-[#e0f2fe] bg-[#f8fafc] px-4 py-3 text-sm text-[#6b7280]">
            No encontramos licitaciones históricas para estas categorías. Podés agregar más
            categorías o continuar.
          </p>
        ) : (
          <>
            <p className="text-xs text-[#6b7280]">
              El sistema pre-clasificó los resultados según tu perfil. Podés ajustar cualquier
              marcación.
            </p>

            {usedFallback && (
              <p className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e]">
                No encontramos suficientes licitaciones que coincidan exactamente con tu perfil.
                Mostramos una muestra más amplia para que puedas ajustar los filtros.
              </p>
            )}

            <div className="space-y-2">
              {sample.map((item) => {
                const mark = marks[item.id]
                const reason = aiReasons[item.id]
                return (
                  <div key={item.id} className="rounded-lg border border-[#e0f2fe] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMark(item.id, 'relevant')}
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          mark === 'relevant'
                            ? 'bg-[#065f46] text-white'
                            : 'border border-[#e0f2fe] text-[#065f46] hover:bg-[#ecfdf5]'
                        }`}
                      >
                        ✓ Relevante
                      </button>
                      <button
                        type="button"
                        onClick={() => setMark(item.id, 'not_relevant')}
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          mark === 'not_relevant'
                            ? 'bg-[#b91c1c] text-white'
                            : 'border border-[#e0f2fe] text-[#b91c1c] hover:bg-[#fef2f2]'
                        }`}
                      >
                        ✗ No relevante
                      </button>
                    </div>
                    <div className="mt-1.5 text-sm text-[#0c1e3c]">
                      <span className="font-medium">{item.title || 'Sin título'}</span>
                      {item.organismo && (
                        <span className="text-[#6b7280]"> · {item.organismo}</span>
                      )}{' '}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0e7490] hover:underline"
                        >
                          Ver →
                        </a>
                      )}
                    </div>
                    {reason && (
                      <p className="mt-0.5 text-xs italic text-[#94a3b8]">&ldquo;{reason}&rdquo;</p>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

      {/* Adjustments */}
      {!loading && sample.length > 0 && (
        <section className="space-y-3 rounded-lg border border-[#e0f2fe] bg-[#f8fafc] p-4">
          <h3 className="text-sm font-semibold text-[#0c1e3c]">Ajustes sugeridos</h3>

          {!canAnalyze ? (
            <p className="text-xs text-[#6b7280]">
              Marcá al menos una licitación como relevante y otra como no relevante para recibir
              sugerencias de exclusión.
            </p>
          ) : (
            <button
              type="button"
              onClick={analyzeMarks}
              className="rounded-lg border border-[#e0f2fe] bg-white px-3 py-1.5 text-sm font-medium text-[#0c1e3c] hover:bg-[#f0f9ff]"
            >
              Analizar mis marcaciones
            </button>
          )}

          {suggestedExclusions !== null && (
            <div className="space-y-2">
              {suggestedExclusions.length === 0 ? (
                <p className="text-xs text-[#6b7280]">
                  No encontramos términos claros para excluir a partir de tus marcaciones.
                </p>
              ) : (
                <>
                  <p className="text-sm text-[#0c1e3c]">
                    Basado en tus marcaciones, sugerimos excluir:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedExclusions.map((keyword) => (
                      <span
                        key={keyword}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#fecaca] bg-[#fef2f2] px-3 py-1 text-sm text-[#b91c1c]"
                      >
                        {keyword}
                        <button
                          type="button"
                          onClick={() => removeSuggestion(keyword)}
                          aria-label={`Quitar ${keyword}`}
                          className="text-[#f87171] hover:text-[#b91c1c]"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={applySuggestions}
                    className="rounded-lg bg-[#06b6d4] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0891b2]"
                  >
                    Aplicar sugerencias
                  </button>
                </>
              )}
            </div>
          )}

          {appliedExclusions.length > 0 && (
            <p className="text-xs text-[#065f46]">
              Keywords de exclusión aplicados: {appliedExclusions.join(', ')}
            </p>
          )}

          {/* Category drop suggestions */}
          {dropSuggestions.map((stat) => (
            <div
              key={stat.feedSource}
              className="space-y-2 rounded-lg border border-[#fde68a] bg-[#fffbeb] p-3"
            >
              <p className="text-sm text-[#92400e]">
                La categoría{' '}
                <span className="font-medium">{feedToDetailedLabel(stat.feedSource)}</span> tiene
                mayoría de licitaciones no relevantes para tu empresa ({stat.notRelevant} de{' '}
                {stat.total}). ¿Querés eliminarla?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => removeFeed(stat.feedSource)}
                  className="rounded-lg bg-[#b91c1c] px-3 py-1 text-sm font-medium text-white hover:bg-[#991b1b]"
                >
                  Sí, eliminar
                </button>
                <button
                  type="button"
                  onClick={() => setKeptCategories((prev) => new Set(prev).add(stat.feedSource))}
                  className="rounded-lg border border-[#e0f2fe] bg-white px-3 py-1 text-sm font-medium text-[#0c1e3c] hover:bg-[#f0f9ff]"
                >
                  Mantener
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
