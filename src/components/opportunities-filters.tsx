'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { STATUS_OPTIONS } from '@/components/ui/status-badge'
import { CATEGORY_OPTIONS } from '@/components/ui/category-badge'
import { cn } from '@/lib/cn'

const SCORE_OPTIONS = [6, 7, 8, 9]

export function OpportunitiesFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const selectedStatuses = (searchParams.get('status') ?? '')
    .split(',')
    .filter(Boolean)
  const minScore = searchParams.get('minScore') ?? ''
  const category = searchParams.get('category') ?? ''
  const [search, setSearch] = useState(searchParams.get('q') ?? '')

  function pushParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    params.delete('page') // Reset to first page whenever a filter changes.
    router.push(`/oportunidades?${params.toString()}`)
  }

  function toggleStatus(value: string) {
    const next = selectedStatuses.includes(value)
      ? selectedStatuses.filter((s) => s !== value)
      : [...selectedStatuses, value]
    pushParams((params) => {
      if (next.length > 0) params.set('status', next.join(','))
      else params.delete('status')
    })
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    pushParams((params) => {
      if (search) params.set('q', search)
      else params.delete('q')
    })
  }

  function clearFilters() {
    setSearch('')
    router.push('/oportunidades')
  }

  return (
    <div className="space-y-3 rounded-xl border border-[#e0f2fe] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => {
          const active = selectedStatuses.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleStatus(option.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-[#0c1e3c] bg-[#0c1e3c] text-white'
                  : 'border-[#e0f2fe] bg-white text-[#6b7280] hover:bg-[#f0f9ff]'
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs font-medium text-[#6b7280]">
          Score mínimo
          <select
            value={minScore}
            onChange={(e) =>
              pushParams((params) => {
                if (e.target.value) params.set('minScore', e.target.value)
                else params.delete('minScore')
              })
            }
            className="mt-1 rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c]"
          >
            <option value="">Todos</option>
            {SCORE_OPTIONS.map((score) => (
              <option key={score} value={score}>
                {score}+
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-xs font-medium text-[#6b7280]">
          Categoría
          <select
            value={category}
            onChange={(e) =>
              pushParams((params) => {
                if (e.target.value) params.set('category', e.target.value)
                else params.delete('category')
              })
            }
            className="mt-1 rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c]"
          >
            <option value="">Todas</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <form onSubmit={handleSearch} className="flex flex-1 flex-col text-xs font-medium text-[#6b7280]">
          Buscar
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Título u organismo…"
            className="mt-1 min-w-[200px] rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c]"
          />
        </form>

        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-[#e0f2fe] bg-white px-3 py-2 text-sm text-[#6b7280] hover:bg-[#f0f9ff]"
        >
          Limpiar filtros
        </button>
      </div>
    </div>
  )
}
