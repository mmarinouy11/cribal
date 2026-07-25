'use client'

import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

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

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />
}
