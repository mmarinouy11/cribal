// A single 0-10 "Puntaje" for a niche, combining the AI fit score with recurrence
// and recency bonuses. Replaces the separate "Señal" (ALTA/MEDIA/BAJA) concept in
// the UI; signalStrength is still stored for internal use.

interface NicheScoreFields {
  fitScore: number
  failureCount: number
  lastFailureAt: Date
}

export function computeNicheScore(niche: NicheScoreFields): number {
  let score = niche.fitScore

  // Bonus for recurrence.
  if (niche.failureCount >= 3) score = Math.min(10, score + 2)
  else if (niche.failureCount === 2) score = Math.min(10, score + 1)

  // Bonus for a recent last failure.
  const daysSinceLast = Math.floor((Date.now() - niche.lastFailureAt.getTime()) / 86_400_000)
  if (daysSinceLast <= 30) score = Math.min(10, score + 1)

  return score
}

/** Accent color for a niche by its puntaje tier (card left border, etc.). */
export function nicheScoreAccent(score: number): string {
  if (score >= 8) return '#06b6d4' // strong
  if (score >= 6) return '#f59e0b' // medium
  return '#94a3b8' // low
}
