'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAndClassifyValidationSample } from '@/lib/actions/register'
import { suggestAdjustmentsFromMarks } from '@/lib/actions/onboarding-suggestions'
import {
  categoriesToDrop,
  type ValidationItem,
  type ClassifiedValidationItem,
  type Mark,
  type UserExample,
} from '@/lib/register/validation'
import type { AdjustmentSuggestions, AdjustmentSuggestion } from '@/lib/suggestions/types'
import { getTenderDisplayText, getTenderObjectText } from '@/lib/tenders/object-text'
import { feedToLabel, feedToDetailedLabel } from '@/lib/arce/catalog'
import { CategorySelector } from '@/components/register/category-selector'
import { CatalogSearch, type AppliedCatalogConfig } from '@/components/register/catalog-search'
import { TagInput } from '@/components/ui/tag-input'

interface ValidationStepProps {
  companyName: string
  description: string
  capabilities: string[]
  relevantKeywords: string[]
  feeds: string[]
  generating: boolean
  onFeedsChange: (feeds: string[]) => void
  // Edit the company's relevant keywords (catalog-derived or free-text).
  onKeywordsChange: (keywords: string[]) => void
  // Catalog articles the user picked in onboarding (persisted on the company).
  catalogArticleIds: number[]
  onCatalogArticleIdsChange: (ids: number[]) => void
  appliedExclusions: string[]
  onAppliedExclusionsChange: (keywords: string[]) => void
  // Reports the reviewed sample with the effective relevance (user mark wins),
  // so the wizard can persist relevant + open items as opportunities on submit.
  onValidatedItemsChange: (items: ClassifiedValidationItem[]) => void
}

export function ValidationStep({
  companyName,
  description,
  capabilities,
  relevantKeywords,
  feeds,
  generating,
  onFeedsChange,
  onKeywordsChange,
  catalogArticleIds,
  onCatalogArticleIdsChange,
  appliedExclusions,
  onAppliedExclusionsChange,
  onValidatedItemsChange,
}: ValidationStepProps) {
  const [sample, setSample] = useState<ValidationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [usedFallback, setUsedFallback] = useState(false)
  // AI pre-classification vs the user's explicit marks. The user's marks win and
  // persist across reloads (they are the criterion the AI must follow).
  const [aiMarks, setAiMarks] = useState<Record<string, Mark>>({})
  const [userMarks, setUserMarks] = useState<Record<string, Mark>>({})
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({})
  const [showCatalog, setShowCatalog] = useState(false)
  const [showSelector, setShowSelector] = useState(false)
  const [suggestions, setSuggestions] = useState<AdjustmentSuggestions | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestError, setSuggestError] = useState(false)
  const [applied, setApplied] = useState(false)
  // uiKey → checked. "add" default checked, "exc" default unchecked.
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [keptCategories, setKeptCategories] = useState<Set<string>>(new Set())
  // Bump to reload the sample on demand (never automatically on keyword/feed edits).
  const [reloadToken, setReloadToken] = useState(0)

  const requestRef = useRef(0)
  // Latest values read inside the reload effect without making it a dependency.
  const liveRef = useRef({ feeds, relevantKeywords, appliedExclusions, marks: {} as Record<string, Mark> })

  // Effective mark per id: the user's explicit mark overrides the AI's.
  const marks = useMemo<Record<string, Mark>>(() => ({ ...aiMarks, ...userMarks }), [aiMarks, userMarks])
  liveRef.current = { feeds, relevantKeywords, appliedExclusions, marks }

  // (Re)load + classify the sample: once on mount (after generation) and only
  // when the user explicitly asks ("Probar de nuevo con estos ajustes").
  useEffect(() => {
    const id = ++requestRef.current
    // Wait until config generation has finished: fetching mid-generation would
    // run with an empty/incomplete keyword list and produce an irrelevant sample.
    if (generating) {
      setLoading(true)
      return
    }
    const { feeds: curFeeds, relevantKeywords: curKeywords, appliedExclusions: curExclusions, marks: curMarks } =
      liveRef.current
    if (curFeeds.length === 0) {
      setSample([])
      setAiMarks({})
      setAiReasons({})
      setUsedFallback(false)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        // The user's current marks become examples so the AI follows the user.
        const userExamples: UserExample[] = sample
          .filter((i) => curMarks[i.id] === 'relevant' || curMarks[i.id] === 'not_relevant')
          .map((i) => ({ object: getTenderObjectText(i) || i.object, relevant: curMarks[i.id] === 'relevant' }))
          .slice(0, 10)

        const result = await fetchAndClassifyValidationSample(
          curFeeds,
          curKeywords,
          { name: companyName, description, capabilities },
          { exclusions: curExclusions, userExamples }
        )
        if (requestRef.current !== id) return
        setSample(result.items)
        setUsedFallback(result.usedFallback)
        // Replace the AI marks; the user's own marks persist and still win.
        const nextAi: Record<string, Mark> = {}
        const nextReasons: Record<string, string> = {}
        for (const item of result.items) {
          nextAi[item.id] = item.aiRelevant ? 'relevant' : 'not_relevant'
          if (item.aiReason) nextReasons[item.id] = item.aiReason
        }
        setAiMarks(nextAi)
        setAiReasons(nextReasons)
        setSuggestions(null)
        setSuggestError(false)
        setChecked({})
      } catch {
        if (requestRef.current === id) {
          setSample([])
          setAiMarks({})
          setAiReasons({})
          setUsedFallback(false)
        }
      } finally {
        if (requestRef.current === id) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, reloadToken])

  const relevantItems = sample.filter((i) => marks[i.id] === 'relevant')
  const notRelevantItems = sample.filter((i) => marks[i.id] === 'not_relevant')
  const canAnalyze = relevantItems.length > 0 && notRelevantItems.length > 0

  // Report the reviewed items upward with the effective relevance (the user's
  // mark overrides Claude's suggestion), so the wizard can persist relevant +
  // open items as opportunities when the account is created.
  useEffect(() => {
    const validated: ClassifiedValidationItem[] = sample.map((item) => ({
      ...item,
      aiRelevant: marks[item.id] === 'relevant',
      aiReason: aiReasons[item.id] ?? '',
    }))
    onValidatedItemsChange(validated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, marks, aiReasons])

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

  // Apply a catalog selection: merge feeds, keywords and article ids. Both the
  // feeds and keywords change in one render, so the sample reloads only once.
  function handleCatalogApply(result: AppliedCatalogConfig) {
    const mergedFeeds = Array.from(new Set([...feeds, ...result.feeds]))
    if (mergedFeeds.length !== feeds.length) onFeedsChange(mergedFeeds)

    const mergedKeywords = Array.from(new Set([...relevantKeywords, ...result.keywords]))
    if (mergedKeywords.length !== relevantKeywords.length) onKeywordsChange(mergedKeywords)

    const mergedIds = Array.from(new Set([...catalogArticleIds, ...result.articleIds]))
    if (mergedIds.length !== catalogArticleIds.length) onCatalogArticleIdsChange(mergedIds)
  }

  function setMark(id: string, mark: Exclude<Mark, null>) {
    // Toggle the user's explicit mark (which overrides the AI and persists).
    setUserMarks((prev) => ({ ...prev, [id]: prev[id] === mark ? null : mark }))
  }

  // One AI call, then code-validated suggestions (never a sample reclassification).
  async function analyzeMarks() {
    setAnalyzing(true)
    setSuggestError(false)
    setApplied(false)
    setSuggestions(null)
    try {
      const marked = sample
        .filter((i) => marks[i.id] === 'relevant' || marks[i.id] === 'not_relevant')
        .map((i) => ({ id: i.id, title: i.title, object: i.object, relevant: marks[i.id] === 'relevant' }))
      const result = await suggestAdjustmentsFromMarks(
        { name: companyName, description, keywords: relevantKeywords, exclusions: appliedExclusions },
        marked
      )
      if (result.status === 'error') {
        setSuggestError(true)
        return
      }
      if (result.status === 'empty') {
        setSuggestions({ add: [], exclude: [] })
        return
      }
      setSuggestions(result.suggestions)
      const next: Record<string, boolean> = {}
      for (const s of result.suggestions.add) next[`add:${s.phrase}`] = true
      for (const s of result.suggestions.exclude) next[`exc:${s.phrase}`] = false
      setChecked(next)
    } finally {
      setAnalyzing(false)
    }
  }

  function toggleChecked(uiKey: string) {
    setChecked((prev) => ({ ...prev, [uiKey]: !prev[uiKey] }))
  }

  // Apply only updates the wizard state; it never reloads/reclassifies the sample.
  function applySuggestions() {
    if (!suggestions) return
    const addToKeywords = suggestions.add
      .filter((s) => checked[`add:${s.phrase}`])
      .map((s) => s.phrase)
    const addToExclusions = suggestions.exclude
      .filter((s) => checked[`exc:${s.phrase}`])
      .map((s) => s.phrase)

    if (addToKeywords.length > 0) {
      onKeywordsChange(Array.from(new Set([...relevantKeywords, ...addToKeywords])))
    }
    if (addToExclusions.length > 0) {
      onAppliedExclusionsChange(Array.from(new Set([...appliedExclusions, ...addToExclusions])))
    }
    setSuggestions(null)
    setChecked({})
    setApplied(true)
  }

  // The only path that re-runs the sample classification (costs AI/time).
  function retryWithAdjustments() {
    setApplied(false)
    setSuggestions(null)
    setReloadToken((t) => t + 1)
  }

  const hasSuggestions =
    suggestions !== null && (suggestions.add.length > 0 || suggestions.exclude.length > 0)

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
            onClick={() => setShowCatalog((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#06b6d4] px-3 py-1 text-sm text-[#0e7490] hover:bg-[#f0f9ff]"
          >
            <i className="ti ti-plus" aria-hidden /> Agregar categoría
          </button>
        </div>

        {showCatalog && (
          <CatalogSearch
            initialTerms={relevantKeywords}
            existingKeywords={relevantKeywords}
            existingFeeds={feeds}
            onApply={handleCatalogApply}
          />
        )}

        <button
          type="button"
          onClick={() => setShowSelector((v) => !v)}
          className="text-xs font-medium text-[#0e7490] hover:underline"
        >
          {showSelector ? 'Ocultar explorador por familia' : 'Explorar por familia'}
        </button>

        {showSelector && (
          <CategorySelector activeFeeds={feeds} onAdd={addFeed} onRemove={removeFeed} />
        )}
      </section>

      {/* Section B — relevant keywords (catalog-derived + free text) */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[#0c1e3c]">Palabras clave</h3>
        <p className="text-xs text-[#6b7280]">
          Agregá palabras propias de tu servicio o producto. Complementan lo que inferimos de tu
          descripción y del catálogo.
        </p>
        <TagInput
          values={relevantKeywords}
          onChange={onKeywordsChange}
          placeholder="Agregar palabra clave y Enter"
        />
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
              Mostramos licitaciones recientes de las categorías configuradas — tanto abiertas como
              cerradas. Las cerradas sirven para verificar que el sistema habría detectado
              oportunidades relevantes para tu empresa. El sistema pre-clasificó los resultados
              según tu perfil; podés ajustar cualquier marcación.
            </p>

            {usedFallback ? (
              <p className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e]">
                No encontramos licitaciones que coincidan exactamente con tu perfil. Mostramos una
                muestra más amplia para que puedas ajustar los filtros.
              </p>
            ) : (
              sample.length < 5 && (
                <p className="rounded-lg border border-[#bae6fd] bg-[#f0f9ff] px-3 py-2 text-xs text-[#0e7490]">
                  Se encontraron {sample.length} licitación{sample.length === 1 ? '' : 'es'} que
                  coincide{sample.length === 1 ? '' : 'n'} con tu perfil. El Estado licita pocas
                  unidades de este tipo — igualmente el sistema te alertará cuando aparezca una
                  nueva.
                </p>
              )
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
                      <span className="font-medium">{getTenderDisplayText(item) || 'Sin objeto'}</span>
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
                    <div className="mt-1">
                      {item.isOpen ? (
                        <span className="inline-flex items-center rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-medium text-[#15803d]">
                          Abierta
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-[#64748b]">
                          Cerrada
                        </span>
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
              sugerencias.
            </p>
          ) : (
            <button
              type="button"
              onClick={analyzeMarks}
              disabled={analyzing}
              className="inline-flex items-center gap-2 rounded-lg border border-[#e0f2fe] bg-white px-3 py-1.5 text-sm font-medium text-[#0c1e3c] hover:bg-[#f0f9ff] disabled:opacity-60"
            >
              {analyzing && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0c1e3c] border-t-transparent" />
              )}
              {analyzing ? 'Analizando…' : 'Analizar mis marcaciones'}
            </button>
          )}

          {suggestError && (
            <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#b91c1c]">
              No pudimos analizar tus marcaciones en este momento. Probá de nuevo más tarde.
            </p>
          )}

          {!suggestError && suggestions !== null && !hasSuggestions && (
            <p className="text-xs text-[#6b7280]">No encontramos ajustes claros por ahora.</p>
          )}

          {hasSuggestions && (
            <div className="space-y-4">
              {suggestions.add.length > 0 && (
                <SuggestionGroup
                  title="Palabras clave a agregar"
                  hint="Describen lo que marcaste como relevante."
                  accent="include"
                  items={suggestions.add}
                  checked={checked}
                  prefix="add"
                  onToggle={toggleChecked}
                />
              )}
              {suggestions.exclude.length > 0 && (
                <SuggestionGroup
                  title="Exclusiones sugeridas"
                  hint="Aparecen en lo que marcaste como no relevante. Revisá antes de aplicar."
                  accent="exclude"
                  items={suggestions.exclude}
                  checked={checked}
                  prefix="exc"
                  onToggle={toggleChecked}
                />
              )}
              <button
                type="button"
                onClick={applySuggestions}
                className="rounded-lg bg-[#06b6d4] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0891b2]"
              >
                Aplicar sugerencias
              </button>
            </div>
          )}

          {applied && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#065f46]">✓ Ajustes aplicados</p>
              <button
                type="button"
                onClick={retryWithAdjustments}
                className="rounded-lg border border-[#e0f2fe] bg-white px-3 py-1.5 text-sm font-medium text-[#0c1e3c] hover:bg-[#f0f9ff]"
              >
                Probar de nuevo con estos ajustes
              </button>
              <p className="text-[11px] text-[#94a3b8]">Usa IA y puede tardar unos segundos.</p>
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

interface SuggestionGroupProps {
  title: string
  hint: string
  accent: 'include' | 'exclude'
  items: AdjustmentSuggestion[]
  checked: Record<string, boolean>
  prefix: string
  onToggle: (uiKey: string) => void
}

/** A reviewable group of suggestions (include or exclude) with reason + evidence. */
function SuggestionGroup({
  title,
  hint,
  accent,
  items,
  checked,
  prefix,
  onToggle,
}: SuggestionGroupProps) {
  const accentClass =
    accent === 'include'
      ? 'text-[#065f46] focus:ring-[#10b981]'
      : 'text-[#b91c1c] focus:ring-[#ef4444]'
  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-[#0c1e3c]">{title}</h4>
        <p className="text-xs text-[#6b7280]">{hint}</p>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const uiKey = `${prefix}:${item.phrase}`
          return (
            <label key={uiKey} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={checked[uiKey] ?? false}
                onChange={() => onToggle(uiKey)}
                className={`mt-0.5 h-4 w-4 rounded border-[#cbd5e1] ${accentClass}`}
              />
              <span className="min-w-0">
                <span className="text-sm font-medium text-[#0c1e3c]">{item.phrase}</span>
                {item.reason && (
                  <span className="block text-xs text-[#6b7280]">{item.reason}</span>
                )}
                {item.evidence.length > 0 && (
                  <span className="block text-xs text-[#94a3b8]">
                    Ej.: {item.evidence.map((t) => `“${t.slice(0, 80)}”`).join(' · ')}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
