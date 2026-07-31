import { cn } from '@/lib/cn'

/** Tailwind classes for a score, following the brand color scale. */
export function scoreColorClass(score: number): string {
  if (score >= 9) return 'bg-[#d1fae5] text-[#065f46]'
  if (score >= 7) return 'bg-[#cffafe] text-[#0e7490]'
  if (score >= 5) return 'bg-[#fef3c7] text-[#92400e]'
  return 'bg-[#f1f5f9] text-[#94a3b8]'
}

/** Fixed-size rounded pill (32x22) so score badges align in table columns. */
export function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] w-8 items-center justify-center rounded-full text-xs font-bold',
        scoreColorClass(score)
      )}
    >
      {score}
    </span>
  )
}
