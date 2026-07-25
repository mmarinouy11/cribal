import { cn } from '@/lib/cn'

// Button styling lives in a plain (non-'use client') module so that Server
// Components can import and call `buttonClass` directly. Exporting a plain
// function from a 'use client' module turns it into a client-reference proxy in
// the server bundle, which throws "is not a function" when called server-side.

export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'sm' | 'md'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-[#1e3a5f] text-white hover:bg-[#16304e] disabled:opacity-60',
  secondary:
    'bg-white text-[#111827] border border-[#e5e7eb] hover:bg-[#f8fafc] disabled:opacity-60',
  danger: 'bg-[#dc2626] text-white hover:bg-[#b91c1c] disabled:opacity-60',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
}

/** Shared class string so styled links can look like buttons too. */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md'
): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size]
  )
}
