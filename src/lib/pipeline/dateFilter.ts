import type { NormalizedTender } from './normalizer'

/**
 * Keep tenders published within the last `lookbackDays` days. Items without a
 * publication date are kept (we don't discard for a missing date).
 */
export function filterByDate(
  tenders: NormalizedTender[],
  lookbackDays: number
): NormalizedTender[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - lookbackDays)

  const passed = tenders.filter(
    (tender) => tender.publicationDate === null || tender.publicationDate >= cutoff
  )

  console.log(
    `[CRIBAL][FECHA] ${tenders.length} → ${passed.length} items dentro de la ventana de ${lookbackDays} día(s)`
  )

  return passed
}
