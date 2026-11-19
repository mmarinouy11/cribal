'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deriveConfigFromArticles,
  type DerivedConfig,
  type KeywordOption,
  type SelectedArticle,
} from '@/lib/catalog/derive-config'
import { normalizeText } from '@/lib/text/normalize'

// Shape returned by GET /api/catalog/search.
interface CatalogItem {
  id: number
  name: string
  familyNumber: number
  familyName: string
  subfamilyName: string
}
interface SearchResponse {
  total: number
  items: CatalogItem[]
}

export interface AppliedCatalogConfig {
  feeds: string[]
  keywords: string[]
  articleIds: number[]
}

interface CatalogSearchProps {
  // Single-word profile keywords to auto-search on mount ("Sugeridos según tu perfil").
  initialTerms?: string[]
  existingKeywords?: string[]
  existingFeeds?: string[]
  onApply: (result: AppliedCatalogConfig) => void
}

const MIN_QUERY_LENGTH = 3
const DEBOUNCE_MS = 300
const SUGGESTION_TERMS = 5

/** True for the generic service subfamilies (family 3, subfamilies 8 and 9). */
function isServiceItem(item: CatalogItem): boolean {
  const subNum = Number(item.subfamilyName.match(/^(\d+)/)?.[1])
  return item.familyNumber === 3 && (subNum === 8 || subNum === 9)
}

/** Strip an ARCE "N-" code prefix for display. */
function cleanSubfamily(name: string): string {
  const stripped = name.replace(/^\d+\s*-\s*/, '').trim()
  return stripped || 'Sin subfamilia'
}

async function fetchCatalog(query: string, limit: number): Promise<SearchResponse> {
  const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}&limit=${limit}`)
  if (!res.ok) return { total: 0, items: [] }
  return (await res.json()) as SearchResponse
}

export function CatalogSearch({
  initialTerms = [],
  existingKeywords = [],
  existingFeeds = [],
  onApply,
}: CatalogSearchProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggested, setSuggested] = useState<SearchResponse | null>(null)
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null)

  const [selected, setSelected] = useState<Map<number, SelectedArticle>>(new Map())
  const [searchedTerms, setSearchedTerms] = useState<string[]>([])
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [showExact, setShowExact] = useState(false)

  const requestRef = useRef(0)
  const activeQuery = normalizeText(query).length >= MIN_QUERY_LENGTH

  // Auto-search up to 5 single-word profile keywords on mount.
  useEffect(() => {
    const terms = initialTerms
      .map((t) => t.trim())
      .filter((t) => t.length >= MIN_QUERY_LENGTH && !t.includes(' '))
      .slice(0, SUGGESTION_TERMS)
    if (terms.length === 0) return
    let cancelled = false
    void (async () => {
      const responses = await Promise.all(terms.map((t) => fetchCatalog(t, 20)))
      if (cancelled) return
      const byId = new Map<number, CatalogItem>()
      let total = 0
      for (const r of responses) {
        total += r.total
        for (const item of r.items) byId.set(item.id, item)
      }
      setSuggested({ total, items: [...byId.values()] })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search as the user types.
  useEffect(() => {
    if (!activeQuery) {
      setSearchResult(null)
      setLoading(false)
      return
    }
    const id = ++requestRef.current
    setLoading(true)
    const timer = setTimeout(async () => {
      const result = await fetchCatalog(query.trim(), 40)
      if (requestRef.current !== id) return
      setSearchResult(result)
      setLoading(false)
      // Record the term for keyword group 1 ("términos que el usuario buscó").
      const term = normalizeText(query)
      setSearchedTerms((prev) => (prev.includes(term) ? prev : [...prev, term]))
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const displayed: SearchResponse = useMemo(
    () =>
      activeQuery
        ? searchResult ?? { total: 0, items: [] }
        : suggested ?? { total: 0, items: [] },
    [activeQuery, searchResult, suggested]
  )

  // Group displayed items by subfamily.
  const groups = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const item of displayed.items) {
      const key = item.subfamilyName || ''
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [displayed])

  const derived: DerivedConfig = useMemo(
    () =>
      deriveConfigFromArticles(
        [...selected.values()],
        searchedTerms,
        existingKeywords,
        existingFeeds
      ),
    [selected, searchedTerms, existingKeywords, existingFeeds]
  )

  const isChecked = useCallback(
    (opt: KeywordOption): boolean => overrides[opt.value] ?? opt.checked,
    [overrides]
  )
  const toggleKeyword = (opt: KeywordOption) =>
    setOverrides((prev) => ({ ...prev, [opt.value]: !(prev[opt.value] ?? opt.checked) }))

  function toggleArticle(item: CatalogItem) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.set(item.id, { id: item.id, name: item.name, familyNumber: item.familyNumber })
      return next
    })
  }

  function toggleGroup(items: CatalogItem[], allSelected: boolean) {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const item of items) {
        if (allSelected) next.delete(item.id)
        else next.set(item.id, { id: item.id, name: item.name, familyNumber: item.familyNumber })
      }
      return next
    })
  }

  function handleApply() {
    if (selected.size === 0) return
    const allOptions = [
      ...derived.keywords.searched,
      ...derived.keywords.frequent,
      ...derived.keywords.exact,
    ]
    const keywords = Array.from(new Set(allOptions.filter(isChecked).map((o) => o.value)))
    onApply({ feeds: derived.feeds, keywords, articleIds: [...selected.keys()] })
    // Reset for another round; applied feeds/keywords now live in the config.
    setSelected(new Map())
    setOverrides({})
  }

  const serviceCount = displayed.items.filter(isServiceItem).length
  const mostlyServices = displayed.items.length > 0 && serviceCount > displayed.items.length / 2
  const showServicesHint =
    activeQuery && !loading && (displayed.items.length < 5 || mostlyServices)

  const headingLabel = activeQuery ? 'Resultados' : 'Sugeridos según tu perfil'

  return (
    <div className="space-y-4 rounded-lg border border-[#e0f2fe] bg-[#f8fafc] p-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscá por descripción (ej: bicicleta, mantenimiento de software)"
        className="w-full rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] outline-none focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]"
      />

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-4 text-sm text-[#6b7280]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#06b6d4] border-t-transparent" />
          Buscando…
        </div>
      ) : (
        <>
          {displayed.items.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[#0c1e3c]">{headingLabel}</h4>
                {displayed.total > displayed.items.length && (
                  <span className="text-xs text-[#6b7280]">
                    Mostrando {displayed.items.length} de {displayed.total}. Afiná la búsqueda para
                    ver el resto.
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {groups.map(([subfamily, items]) => {
                  const allSelected = items.every((i) => selected.has(i.id))
                  return (
                    <div
                      key={subfamily || 'sin-subfamilia'}
                      className="rounded-lg border border-[#e0f2fe] bg-white"
                    >
                      <div className="flex items-center justify-between border-b border-[#e0f2fe] px-3 py-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                          {cleanSubfamily(subfamily)} ({items.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleGroup(items, allSelected)}
                          className="text-xs font-medium text-[#0e7490] hover:underline"
                        >
                          {allSelected ? 'Quitar todo' : 'Seleccionar todo este grupo'}
                        </button>
                      </div>
                      <div className="divide-y divide-[#f1f5f9]">
                        {items.map((item) => (
                          <label
                            key={item.id}
                            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-[#0c1e3c] hover:bg-[#f8fafc]"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(item.id)}
                              onChange={() => toggleArticle(item)}
                              className="h-4 w-4 rounded border-[#cbd5e1] text-[#06b6d4] focus:ring-[#06b6d4]"
                            />
                            <span className="flex-1">{item.name}</span>
                            <span className="text-xs text-[#94a3b8]">{item.id}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {activeQuery && displayed.items.length === 0 && (
            <p className="text-sm text-[#6b7280]">No se encontraron artículos para esa búsqueda.</p>
          )}

          {showServicesHint && (
            <p className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e]">
              Los servicios suelen estar registrados en ARCE con nombres genéricos. Sumá tus propias
              palabras clave (por ejemplo, tu especialidad) para encontrar las licitaciones que te
              corresponden.
            </p>
          )}
        </>
      )}

      {/* Review panel — the keywords/feeds that will be applied. */}
      {selected.size > 0 && (
        <div className="space-y-3 rounded-lg border border-[#bae6fd] bg-white p-3">
          <p className="text-sm text-[#0c1e3c]">
            {selected.size} artículo{selected.size === 1 ? '' : 's'} seleccionado
            {selected.size === 1 ? '' : 's'}. Revisá los keywords antes de aplicar:
          </p>

          <KeywordGroup
            title="Términos que buscaste"
            options={derived.keywords.searched}
            isChecked={isChecked}
            onToggle={toggleKeyword}
          />
          <KeywordGroup
            title="Palabras frecuentes"
            options={derived.keywords.frequent}
            isChecked={isChecked}
            onToggle={toggleKeyword}
          />

          {derived.keywords.exact.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowExact((v) => !v)}
                className="text-xs font-medium text-[#0e7490] hover:underline"
              >
                {showExact ? 'Ocultar nombres exactos' : 'Ver nombres exactos'}
              </button>
              {showExact && (
                <div className="mt-2">
                  <KeywordGroup
                    title="Nombres exactos de los artículos"
                    options={derived.keywords.exact}
                    isChecked={isChecked}
                    onToggle={toggleKeyword}
                  />
                </div>
              )}
            </div>
          )}

          {derived.feeds.length > 0 && (
            <p className="text-xs text-[#6b7280]">
              Se agregarán {derived.feeds.length} categoría{derived.feeds.length === 1 ? '' : 's'} a
              nivel familia.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleApply}
        disabled={selected.size === 0}
        className="w-full rounded-lg bg-[#06b6d4] py-2 text-sm font-medium text-white hover:bg-[#0891b2] disabled:opacity-50"
      >
        Agregar a mi configuración ({selected.size})
      </button>
    </div>
  )
}

interface KeywordGroupProps {
  title: string
  options: KeywordOption[]
  isChecked: (opt: KeywordOption) => boolean
  onToggle: (opt: KeywordOption) => void
}

function KeywordGroup({ title, options, isChecked, onToggle }: KeywordGroupProps) {
  if (options.length === 0) return null
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const checked = isChecked(opt)
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                checked
                  ? 'bg-[#06b6d4] text-white'
                  : 'border border-[#e0f2fe] bg-white text-[#64748b]'
              }`}
            >
              {checked ? '✓ ' : ''}
              {opt.value}
            </button>
          )
        })}
      </div>
    </div>
  )
}
