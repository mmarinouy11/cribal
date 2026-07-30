'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const STORAGE_KEY = 'cribal_onboarding_dismissed'

export function OnboardingBanner() {
  // Start hidden to avoid a hydration mismatch; reveal after reading localStorage.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(STORAGE_KEY) !== 'true') {
      setVisible(true)
    }
  }, [])

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-[#0c1e3c]">
        <p className="font-semibold">🎉 ¡Bienvenido a Cribal!</p>
        <p className="mt-0.5 text-[#334155]">
          El pipeline correrá automáticamente esta noche. Mientras tanto, completá tu perfil
          de empresa para mejorar las propuestas generadas.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link
          href="/perfil"
          className="rounded-lg bg-[#0c1e3c] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16304e]"
        >
          Completar perfil →
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg border border-[#e0f2fe] bg-white px-3 py-1.5 text-sm text-[#6b7280] hover:bg-[#f0f9ff]"
        >
          Descartar
        </button>
      </div>
    </div>
  )
}
