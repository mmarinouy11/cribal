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
    <div className="-mx-8 -mt-8 flex h-11 items-center gap-3 border-b border-[#bae6fd] bg-[#e0f2fe] px-8 text-[13px] text-[#0c1e3c]">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <i className="ti ti-confetti text-[#06b6d4]" aria-hidden />
        <span className="truncate">
          Bienvenido a Cribal · El pipeline correrá hoy a las 8:00 AM
        </span>
      </span>
      <Link href="/perfil" className="shrink-0 font-medium text-[#06b6d4] hover:underline">
        Completar perfil →
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Descartar"
        className="shrink-0 text-[#64748b] transition-colors hover:text-[#0c1e3c]"
      >
        <i className="ti ti-x" aria-hidden />
      </button>
    </div>
  )
}
