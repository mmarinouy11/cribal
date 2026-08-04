'use client'

import Link from 'next/link'
import { cn } from '@/lib/cn'

export type DetailTab = 'detalle' | 'mercado' | 'chat' | 'propuesta'

const TABS: { key: DetailTab; label: string }[] = [
  { key: 'detalle', label: 'Detalle' },
  { key: 'mercado', label: 'Mercado' },
  { key: 'chat', label: 'Consultar pliego' },
  { key: 'propuesta', label: 'Propuesta' },
]

export function DetailTabs({
  opportunityId,
  active,
  chatCount = 0,
}: {
  opportunityId: string
  active: DetailTab
  chatCount?: number
}) {
  return (
    <div className="flex gap-1 border-b border-[#e0f2fe]">
      {TABS.map((tab) => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={`/oportunidades/${opportunityId}?tab=${tab.key}`}
            scroll={false}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-[#0c1e3c] text-[#0c1e3c]'
                : 'border-transparent text-[#6b7280] hover:text-[#0c1e3c]'
            )}
          >
            {tab.label}
            {tab.key === 'chat' && chatCount > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                  isActive ? 'bg-[#0c1e3c] text-white' : 'bg-[#e0f2fe] text-[#0e7490]'
                )}
              >
                {chatCount}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
