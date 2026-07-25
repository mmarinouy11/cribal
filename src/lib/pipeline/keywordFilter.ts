import type { NormalizedTender } from './normalizer'

// Base relevant keywords, applied for every company regardless of its config.
export const BASE_RELEVANT_KEYWORDS: string[] = [
  // Software / Platforms
  'software',
  'aplicación',
  'aplicativo',
  'plataforma',
  'sistema',
  'integración',
  'implementación',
  'mantenimiento software',
  'mantenimiento de sistemas',
  'mantenimiento correctivo',
  'mantenimiento evolutivo',
  'soporte y mantenimiento',
  // Technical Support / Service Desk
  'soporte técnico',
  'soporte funcional',
  'soporte informático',
  'mesa de ayuda',
  'mesa de servicios',
  'help desk',
  'service desk',
  'atención a usuarios',
  'asistencia a usuarios',
  'soporte a usuarios',
  'primer nivel',
  'segundo nivel',
  'nivel 1',
  'nivel 2',
  'niveles 1 y 2',
  'nivel i',
  'nivel ii',
  'l1',
  'l2',
  'soporte l1',
  'soporte l2',
  'gestión de incidentes',
  'resolución de incidentes',
  'servicio de soporte',
  'servicios de soporte',
  'servicio de asistencia',
  'operación de servicios',
  // Cloud / Infrastructure / DevOps
  'cloud',
  'aws',
  'azure',
  'gcp',
  'vmware',
  'virtualización',
  'kubernetes',
  'docker',
  'devops',
  // Cybersecurity
  'ciberseguridad',
  'seguridad informática',
  'edr',
  'fortinet',
  'crowdstrike',
  // Data / Analytics
  'data',
  'analytics',
  'power bi',
  'cognos',
  'infosphere',
  'spss',
  // Enterprise Systems / QA
  'gis',
  'ibm',
  'oracle',
  'sap',
  'salesforce',
  'servicenow',
  'testing',
  'qa',
  // Other IT
  'licencia',
  'licencias',
  'licenciamiento',
  'pacs',
  'cpd',
  'redes de datos',
  'pasarela de pagos',
  'monitoreo',
  // Microsoft specific
  'microsoft',
  'office 365',
  'office365',
  'windows server',
  'sql server',
  'dynamics',
  'teams',
]

export interface KeywordFilterResult {
  passed: NormalizedTender[]
  rejected: { tender: NormalizedTender; reason: string }[]
}

/**
 * Deterministic relevance filter. An item passes if the lowercased
 * title + description contains at least one relevant keyword.
 */
export function filterByKeywords(
  tenders: NormalizedTender[],
  additionalRelevant: string[],
  _additionalExcluded: string[]
): KeywordFilterResult {
  const relevant = [...BASE_RELEVANT_KEYWORDS, ...additionalRelevant].map((k) =>
    k.toLowerCase()
  )

  const passed: NormalizedTender[] = []
  const rejected: { tender: NormalizedTender; reason: string }[] = []

  for (const tender of tenders) {
    const haystack = `${tender.title} ${tender.description}`.toLowerCase()
    const matches = relevant.some((keyword) => haystack.includes(keyword))

    if (matches) {
      passed.push(tender)
    } else {
      rejected.push({
        tender,
        reason: `Sin keywords relevantes: revisado ${relevant.length} términos`,
      })
    }
  }

  console.log(
    `[CRIBAL][KEYWORDS] ${tenders.length} → ${passed.length} items con keywords relevantes`
  )

  return { passed, rejected }
}
