'use client'

import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { buttonClass, type ButtonVariant, type ButtonSize } from './button-styles'

// Types only — safe to re-export from a client module. Import the `buttonClass`
// value from './button-styles' (a plain module) in Server Components.
export type { ButtonVariant, ButtonSize }

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
