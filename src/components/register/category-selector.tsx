'use client'

import { useMemo, useState } from 'react'
import {
  ARCE_FAMILIES,
  familyFeedUrl,
  subfamilyFeedUrl,
  textFeedUrl,
  searchCatalog,
} from '@/lib/arce/catalog'

interface CategorySelectorProps {
  activeFeeds: string[]
  onAdd: (feedUrl: string) => void
  onRemove: (feedUrl: string) => void
}

type SelectorMode = 'tree' | 'text'

const ARCE_CONSULTAS_URL = 'https://www.comprasestatales.gub.uy/consultas'

export function CategorySelector({ activeFeeds, onAdd, onRemove }: CategorySelectorProps) {
  const [mode, setMode] = useState<SelectorMode>('tree')
  const [openFamily, setOpenFamily] = useState<number | null>(null)
  const [query, setQuery] = useState('')

  const activeSet = useMemo(() => new Set(activeFeeds), [activeFeeds])
  const results = useMemo(() => searchCatalog(query), [query])

  function toggleFeed(feedUrl: string, checked: boolean) {
    if (checked) onAdd(feedUrl)
    else onRemove(feedUrl)
  }

  return (
    <div className="rounded-lg border border-[#e0f2fe] bg-[#f8fafc] p-4">
      {/* Mode toggle */}
      <div className="mb-3 inline-flex rounded-lg border border-[#e0f2fe] bg-white p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setMode('tree')}
          className={`rounded-md px-3 py-1 ${mode === 'tree' ? 'bg-[#06b6d4] text-white' : 'text-[#0c1e3c]'}`}
        >
          Árbol de categorías
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`rounded-md px-3 py-1 ${mode === 'text' ? 'bg-[#06b6d4] text-white' : 'text-[#0c1e3c]'}`}
        >
          Buscar por texto
        </button>
      </div>

      {mode === 'tree' ? (
        <div className="space-y-1">
          {Object.entries(ARCE_FAMILIES).map(([famKey, family]) => {
            const familia = Number(famKey)
            const subEntries = Object.entries(family.subfamilies)
            const isOpen = openFamily === familia
            const familyFeed = familyFeedUrl(familia)
            const familyActive = activeSet.has(familyFeed)
            return (
              <div key={familia} className="rounded-lg border border-[#e0f2fe] bg-white">
                <button
                  type="button"
                  onClick={() => setOpenFamily((prev) => (prev === familia ? null : familia))}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-[#0c1e3c]"
                >
                  <span>
                    {family.name} <span className="text-[#94a3b8]">(Fam. {familia})</span>
                  </span>
                  <i
                    className={`ti ti-chevron-${isOpen ? 'up' : 'down'} text-[#94a3b8]`}
                    aria-hidden
                  />
                </button>
                {isOpen && (
                  <div className="space-y-1 border-t border-[#e0f2fe] px-3 py-2">
                    {subEntries.length === 0 ? (
                      // Families without subfamilies expose their own feed directly.
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-[#334155]">
                        <input
                          type="checkbox"
                          checked={familyActive}
                          onChange={(e) => toggleFeed(familyFeed, e.target.checked)}
                          className="h-4 w-4 rounded border-[#cbd5e1] text-[#06b6d4] focus:ring-[#06b6d4]"
                        />
                        Toda la familia
                      </label>
                    ) : (
                      subEntries.map(([subKey, subName]) => {
                        const subfamilia = Number(subKey)
                        const feed = subfamilyFeedUrl(familia, subfamilia)
                        return (
                          <label
                            key={subfamilia}
                            className="flex cursor-pointer items-center gap-2 text-sm text-[#334155]"
                          >
                            <input
                              type="checkbox"
                              checked={activeSet.has(feed)}
                              onChange={(e) => toggleFeed(feed, e.target.checked)}
                              className="h-4 w-4 rounded border-[#cbd5e1] text-[#06b6d4] focus:ring-[#06b6d4]"
                            />
                            {subName}
                          </label>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar categoría (ej: mantenimiento, alimentos, obras…)"
            className="w-full rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] outline-none focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]"
          />

          {query.trim() && (
            <div className="space-y-1">
              {results.map((result) => {
                const active = activeSet.has(result.feedUrl)
                return (
                  <button
                    key={result.feedUrl}
                    type="button"
                    disabled={active}
                    onClick={() => onAdd(result.feedUrl)}
                    className="flex w-full items-center justify-between rounded-lg border border-[#e0f2fe] bg-white px-3 py-2 text-left text-sm text-[#0c1e3c] hover:bg-[#f0f9ff] disabled:opacity-50"
                  >
                    <span>{result.label}</span>
                    <span className="text-xs text-[#0e7490]">{active ? 'Agregada' : 'Agregar +'}</span>
                  </button>
                )
              })}

              {/* Always offer adding the query as a free-text search feed. */}
              <button
                type="button"
                onClick={() => {
                  onAdd(textFeedUrl(query))
                  setQuery('')
                }}
                className="flex w-full items-center justify-between rounded-lg border border-dashed border-[#06b6d4] bg-white px-3 py-2 text-left text-sm text-[#0c1e3c] hover:bg-[#f0f9ff]"
              >
                <span>
                  Agregar búsqueda libre: <span className="font-medium">&quot;{query.trim()}&quot;</span>
                </span>
                <span className="text-xs text-[#0e7490]">Agregar +</span>
              </button>

              <a
                href={ARCE_CONSULTAS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-sm font-medium text-[#0e7490] hover:underline"
              >
                Buscar en ARCE →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
