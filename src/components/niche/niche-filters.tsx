'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SIGNAL_OPTIONS, NICHE_CATEGORY_OPTIONS, NICHE_STATUS_OPTIONS } from './niche-badges'

const FAILURE_TYPE_OPTIONS = [
  { value: 'DESIERTA', label: 'Desiertas' },
  { value: 'OFERTAS_RECHAZADAS', label: 'Ofertas rechazadas' },
]

function Select({
  label,
  param,
  allLabel,
  options,
}: {
  label: string
  param: string
  allLabel: string
  options: { value: string; label: string }[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const value = searchParams.get(param) ?? ''

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set(param, next)
    else params.delete(param)
    router.push(`/nichos?${params.toString()}`)
  }

  return (
    <label className="flex flex-col text-xs font-medium text-[#6b7280]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 rounded-lg border border-[#e0f2fe] bg-white px-3 text-sm text-[#0c1e3c]"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function NicheFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [organismo, setOrganismo] = useState(searchParams.get('organismo') ?? '')

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    if (organismo) params.set('organismo', organismo)
    else params.delete('organismo')
    router.push(`/nichos?${params.toString()}`)
  }

  function clearFilters() {
    setOrganismo('')
    router.push('/nichos')
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#e0f2fe] bg-[#f8fafc] px-4 py-3">
      <Select label="Señal" param="signal" allLabel="Todas" options={SIGNAL_OPTIONS} />
      <Select label="Categoría" param="category" allLabel="Todas" options={NICHE_CATEGORY_OPTIONS} />
      <Select label="Tipo de fallo" param="failureType" allLabel="Todos" options={FAILURE_TYPE_OPTIONS} />
      <Select label="Estado" param="status" allLabel="Todos" options={NICHE_STATUS_OPTIONS} />

      <form onSubmit={handleSearch} className="flex flex-col text-xs font-medium text-[#6b7280]">
        Organismo
        <input
          type="text"
          value={organismo}
          onChange={(e) => setOrganismo(e.target.value)}
          placeholder="Buscar organismo…"
          className="mt-1 h-9 min-w-[180px] rounded-lg border border-[#e0f2fe] bg-white px-3 text-sm text-[#0c1e3c]"
        />
      </form>

      <button
        type="button"
        onClick={clearFilters}
        className="h-9 self-end text-[13px] text-[#06b6d4] hover:underline"
      >
        Limpiar filtros
      </button>
    </div>
  )
}
