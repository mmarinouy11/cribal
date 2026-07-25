import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[#e5e7eb] bg-white shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardBody({ children, className, ...props }: CardProps) {
  return (
    <div className={cn('p-5', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className, ...props }: CardProps) {
  return (
    <div
      className={cn('border-b border-[#e5e7eb] px-5 py-4', className)}
      {...props}
    >
      {children}
    </div>
  )
}
