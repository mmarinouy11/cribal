// Human-facing label for an opportunity's AI category. New categories are short
// Spanish labels chosen per tender (e.g. "Aire acondicionado"), shown as-is.
// Legacy fixed IT codes (from when Cribal was IT-only) are mapped to Spanish,
// and the old "no_relevante" sentinel is treated as "no category". Returns null
// when there is nothing to show, so callers can omit the badge entirely.

const LEGACY_LABELS: Record<string, string> = {
  desarrollo_software: 'Desarrollo',
  soporte_tecnico: 'Soporte TI',
  cloud: 'Cloud',
  datos_analytics: 'Datos',
  ciberseguridad: 'Seguridad',
  qa_testing: 'QA',
  servicios_gestionados: 'Servicios gestionados',
  licencias: 'Licencias',
  consultoria: 'Consultoría',
}

export function categoryLabel(category: string | null | undefined): string | null {
  const value = category?.trim()
  if (!value || value === 'no_relevante') return null
  return LEGACY_LABELS[value] ?? value
}
