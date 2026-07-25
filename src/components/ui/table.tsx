import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-[#f8fafc]">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-[#e5e7eb]">{children}</tbody>
}

interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  children: ReactNode
}

export function Tr({ children, className, ...props }: TrProps) {
  return (
    <tr className={cn('hover:bg-[#f8fafc]', className)} {...props}>
      {children}
    </tr>
  )
}

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode
}

export function Th({ children, className, ...props }: ThProps) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]',
        className
      )}
      {...props}
    >
      {children}
    </th>
  )
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode
}

export function Td({ children, className, ...props }: TdProps) {
  return (
    <td className={cn('px-4 py-3 text-[#111827] align-middle', className)} {...props}>
      {children}
    </td>
  )
}
