'use client'

import Link from 'next/link'
import { cn } from '@/lib/cn'

export type DetailTab = 'detalle' | 'mercado' | 'propuesta'

const TABS: { key: DetailTab; label: string }[] = [
  { key: 'detalle', label: 'Detalle' },
  { key: 'mercado', label: 'Mercado' },
  { key: 'propuesta', label: 'Propuesta' },
]

export function DetailTabs({
  opportunityId,
  active,
}: {
  opportunityId: string
  active: DetailTab
}) {
  return (
    <div className="flex gap-1 border-b border-[#e5e7eb]">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/oportunidades/${opportunityId}?tab=${tab.key}`}
          scroll={false}
          className={cn(
            '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            tab.key === active
              ? 'border-[#1e3a5f] text-[#1e3a5f]'
              : 'border-transparent text-[#6b7280] hover:text-[#111827]'
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}
