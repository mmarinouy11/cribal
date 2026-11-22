import { NicheCategory } from '@prisma/client'

/**
 * User-facing names for the niche levels. The stored enum values are NOT
 * changed (no migration); only what the user reads changes. Single source of
 * truth for the UI, emails and any user-visible copy.
 *
 * NUCLEO  → "Tu especialidad" (what the company already does)
 * ADYACENTE → "Cercano" (neighbouring lines it could grow into)
 * FUERA   → "Fuera de foco" (further afield; normally filtered out of the UI)
 */
export const NICHE_CATEGORY_LABELS: Record<NicheCategory, string> = {
  NUCLEO: 'Tu especialidad',
  ADYACENTE: 'Cercano',
  FUERA: 'Fuera de foco',
}

export function nicheCategoryLabel(category: NicheCategory): string {
  return NICHE_CATEGORY_LABELS[category]
}
