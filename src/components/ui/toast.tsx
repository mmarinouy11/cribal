'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/cn'

export type ToastType = 'success' | 'error'

interface ToastProps {
  message: string
  type?: ToastType
  onClose: () => void
  duration?: number
}

const TYPE_CLASSES: Record<ToastType, string> = {
  success: 'bg-[#16a34a] text-white',
  error: 'bg-[#dc2626] text-white',
}

/**
 * Simple auto-dismissing toast. Visibility is controlled by the parent: render
 * it when there is a message, and clear the message in `onClose`.
 */
export function Toast({ message, type = 'success', onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  return (
    <div
      role="status"
      className={cn(
        'fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg',
        TYPE_CLASSES[type]
      )}
    >
      {message}
    </div>
  )
}
