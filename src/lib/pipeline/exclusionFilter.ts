import type { NormalizedTender } from './normalizer'

// Base exclusion keywords: reject if ANY of these appear in title + description.
export const BASE_EXCLUSION_KEYWORDS: string[] = [
  // Hardware / Devices
  'notebook',
  'laptop',
  'computadora personal',
  'impresora',
  'scanner',
  'switch de red',
  'router',
  'access point',
  'rack',
  'equipamiento de red',
  'equipamiento para redes',
  // Non-IT
  'retroexcavadora',
  'camión',
  'camioneta',
  'vehículo',
  'cantina',
  'jardinería',
  'podas',
  'pasajes',
  'material médico',
  'quirúrgico',
  'alarma kidde',
]

// Context signals that make an excluded-product mention a license-only purchase.
const LICENSE_ONLY_SIGNALS: string[] = [
  'licencia',
  'renovación',
  'suscripción',
  'mantenimiento correctivo',
  'soporte de producto',
]

// Context signals that indicate a broader scope worth keeping.
const BROADER_SCOPE_SIGNALS: string[] = [
  'servicio gestionado',
  'migración',
  'implementación',
  'integración',
  'soporte técnico',
]

export interface ExclusionFilterResult {
  passed: NormalizedTender[]
  rejected: { tender: NormalizedTender; reason: string }[]
}

/**
 * Filter out generic noise (hardware, vehicles, medical supplies, …) and
 * specifically excluded products.
 *
 * The base exclusion list is generic noise for most service companies, but it
 * must not fight a company's own focus: any base term that appears in the
 * company's relevant keywords is dropped from the exclusion set (e.g. a printer
 * reseller whose relevant keyword is "impresora" keeps printer tenders).
 *
 * After base exclusions, the special product logic applies: an excluded product
 * is only rejected when the context is license/renewal-only and there is no
 * broader managed-service/implementation/integration scope.
 */
export function filterExclusions(
  tenders: NormalizedTender[],
  excludedProducts: string[],
  relevantKeywords: string[] = []
): ExclusionFilterResult {
  const relevant = relevantKeywords.map((k) => k.toLowerCase()).filter(Boolean)
  const baseExclusions = BASE_EXCLUSION_KEYWORDS.map((k) => k.toLowerCase()).filter(
    // Do not exclude a term the company explicitly marked relevant.
    (exclusion) => !relevant.some((keyword) => keyword.includes(exclusion))
  )
  const products = excludedProducts.map((p) => p.toLowerCase())

  const passed: NormalizedTender[] = []
  const rejected: { tender: NormalizedTender; reason: string }[] = []

  for (const tender of tenders) {
    const haystack = `${tender.title} ${tender.description}`.toLowerCase()

    // 1. Base exclusion keywords.
    const matchedExclusion = baseExclusions.find((keyword) => haystack.includes(keyword))
    if (matchedExclusion) {
      rejected.push({
        tender,
        reason: `Exclusión por palabra clave: "${matchedExclusion}"`,
      })
      continue
    }

    // 2. Excluded product special logic.
    const matchedProduct = products.find((product) => haystack.includes(product))
    if (matchedProduct) {
      const hasBroaderScope = BROADER_SCOPE_SIGNALS.some((s) => haystack.includes(s))
      const hasLicenseOnly = LICENSE_ONLY_SIGNALS.some((s) => haystack.includes(s))

      // Reject only when the scope is license-only and there is no broader scope.
      if (hasLicenseOnly && !hasBroaderScope) {
        rejected.push({
          tender,
          reason: `Producto excluido "${matchedProduct}" solo en contexto de licencia/renovación`,
        })
        continue
      }
    }

    passed.push(tender)
  }

  console.log(
    `[CRIBAL][EXCLUSIONES] ${tenders.length} → ${passed.length} items tras filtro de exclusiones`
  )

  return { passed, rejected }
}
