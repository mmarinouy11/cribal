'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'

interface ClickableRowProps {
  href: string
  children: ReactNode
  className?: string
}

/** Table row that navigates to `href` on click. */
export function ClickableRow({ href, children, className }: ClickableRowProps) {
  const router = useRouter()
  return (
    <tr
      onClick={() => router.push(href)}
      className={cn('cursor-pointer hover:bg-[#f0f9ff]', className)}
    >
      {children}
    </tr>
  )
}
