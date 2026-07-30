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
  return <thead className="bg-[#f0f9ff]">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-[#e0f2fe]">{children}</tbody>
}

interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  children: ReactNode
}

export function Tr({ children, className, ...props }: TrProps) {
  return (
    <tr className={cn('hover:bg-[#f0f9ff]', className)} {...props}>
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
    <td className={cn('px-4 py-3 text-[#0c1e3c] align-middle', className)} {...props}>
      {children}
    </td>
  )
}
