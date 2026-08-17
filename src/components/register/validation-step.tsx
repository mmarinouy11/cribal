'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchValidationSample, validateSampleWithAI } from '@/lib/actions/register'
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
  feeds: string[]
  onFeedsChange: (feeds: string[]) => void
  appliedExclusions: string[]
  onAppliedExclusionsChange: (keywords: string[]) => void
}

const MIN_UNMARKED_FOR_AI = 5

export function ValidationStep({
  companyName,
  description,
  capabilities,
  feeds,
  onFeedsChange,
  appliedExclusions,
  onAppliedExclusionsChange,
}: ValidationStepProps) {
  const [sample, setSample] = useState<ValidationItem[]>([])
  const [loadingSample, setLoadingSample] = useState(true)
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({})
  const [validatingAI, setValidatingAI] = useState(false)
  const [showSelector, setShowSelector] = useState(false)
  const [suggestedExclusions, setSuggestedExclusions] = useState<string[] | null>(null)
  const [keptCategories, setKeptCategories] = useState<Set<string>>(new Set())

  const feedsKey = useMemo(() => feeds.join('||'), [feeds])
  const requestRef = useRef(0)

  // (Re)load the historical sample whenever the active categories change.
  useEffect(() => {
    const id = ++requestRef.current
    if (feeds.length === 0) {
      setSample([])
      setLoadingSample(false)
      return
    }
    setLoadingSample(true)
    const timer = setTimeout(async () => {
      try {
        const items = await fetchValidationSample(feeds)
        if (requestRef.current !== id) return
        setSample(items)
        // Drop marks/reasons for items no longer in the sample.
        const ids = new Set(items.map((i) => i.id))
        setMarks((prev) => {
          const next: Record<string, Mark> = {}
          for (const [key, value] of Object.entries(prev)) if (ids.has(key)) next[key] = value
          return next
        })
      } catch {
        if (requestRef.current === id) setSample([])
      } finally {
        if (requestRef.current === id) setLoadingSample(false)
      }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedsKey])

  const relevantItems = sample.filter((i) => marks[i.id] === 'relevant')
  const notRelevantItems = sample.filter((i) => marks[i.id] === 'not_relevant')
  const unmarkedItems = sample.filter((i) => !marks[i.id])
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

  async function runAiValidation() {
    setValidatingAI(true)
    try {
      const classifications = await validateSampleWithAI(unmarkedItems, {
        name: companyName,
        description,
        capabilities,
      })
      setMarks((prev) => {
        const next = { ...prev }
        for (const c of classifications) next[c.id] = c.relevant ? 'relevant' : 'not_relevant'
        return next
      })
      setAiReasons((prev) => {
        const next = { ...prev }
        for (const c of classifications) if (c.reason) next[c.id] = c.reason
        return next
      })
    } catch {
      // Silent: the user can still mark items by hand.
    } finally {
      setValidatingAI(false)
    }
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
          Revisá las categorías inferidas y marcá una muestra de licitaciones reales como
          relevantes o no. Con eso ajustamos tus filtros.
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
            Muestra histórica de licitaciones adjudicadas
            {!loadingSample && sample.length > 0 && ` (${sample.length})`}
          </h3>
          <p className="text-xs text-[#6b7280]">
            Basada en las categorías que configuraste. Marcá cada una:
          </p>
        </div>

        {loadingSample ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-[#f1f5f9]" />
            ))}
          </div>
        ) : sample.length === 0 ? (
          <p className="rounded-lg border border-[#e0f2fe] bg-[#f8fafc] px-4 py-3 text-sm text-[#6b7280]">
            No encontramos licitaciones históricas para estas categorías. Podés agregar más
            categorías o continuar.
          </p>
        ) : (
          <div className="space-y-2">
            {sample.map((item) => {
              const mark = marks[item.id]
              const reason = aiReasons[item.id]
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-[#e0f2fe] px-3 py-2"
                  title={reason || undefined}
                >
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
                    {reason && (
                      <i
                        className="ti ti-info-circle text-[#94a3b8]"
                        aria-hidden
                        title={reason}
                      />
                    )}
                  </div>
                  <div className="mt-1.5 text-sm text-[#0c1e3c]">
                    <span className="font-medium">{item.title || 'Sin título'}</span>
                    {item.organismo && <span className="text-[#6b7280]"> · {item.organismo}</span>}{' '}
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
                </div>
              )
            })}
          </div>
        )}

        {/* AI validation (optional, spends tokens) */}
        {!loadingSample && unmarkedItems.length >= MIN_UNMARKED_FOR_AI && (
          <button
            type="button"
            onClick={runAiValidation}
            disabled={validatingAI}
            className="inline-flex items-center gap-2 rounded-lg border border-[#0c1e3c] bg-white px-3 py-2 text-sm font-medium text-[#0c1e3c] hover:bg-[#f0f9ff] disabled:opacity-60"
          >
            {validatingAI && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0c1e3c] border-t-transparent" />
            )}
            {validatingAI ? 'Clasificando…' : 'Validar con IA'}
          </button>
        )}
      </section>

      {/* Adjustments */}
      {sample.length > 0 && (
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
                  <p className="text-sm text-[#0c1e3c]">Basado en tus marcaciones, sugerimos excluir:</p>
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
                La categoría <span className="font-medium">{feedToDetailedLabel(stat.feedSource)}</span>{' '}
                tiene mayoría de licitaciones no relevantes para tu empresa ({stat.notRelevant} de{' '}
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
                  onClick={() =>
                    setKeptCategories((prev) => new Set(prev).add(stat.feedSource))
                  }
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
