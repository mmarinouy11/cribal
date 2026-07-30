import { Badge } from './badge'

/** Tailwind classes for a score, following the digest color scale. */
export function scoreColorClass(score: number): string {
  if (score >= 9) return 'bg-[#d1fae5] text-[#065f46]'
  if (score >= 7) return 'bg-[#cffafe] text-[#0e7490]'
  if (score >= 5) return 'bg-[#fef3c7] text-[#d97706]'
  return 'bg-[#f3f4f6] text-[#6b7280]'
}

export function ScoreBadge({ score }: { score: number }) {
  return <Badge className={scoreColorClass(score)}>{score}</Badge>
}
