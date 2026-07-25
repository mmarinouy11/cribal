import type { NormalizedTender } from './normalizer'

// Award / adjudication signals — a match means the publication is closed.
const REJECTION_SIGNALS: string[] = [
  'adjudicación',
  'adjudicar',
  'adjudicada',
  'adjudicado',
  'aprobar la presente adjudicación',
  'empresa adjudicataria',
  'oferta más conveniente',
  'comisión asesora de adjudicaciones',
  'acto de apertura de ofertas',
  'se recibieron propuestas',
  'cuadro comparativo de precios',
  'mejoramiento de ofertas',
  'intervención preventiva de legalidad',
  'tribunal de cuentas',
  'resuelve',
  'aprobar la presente',
]

// Open-tender signals — a match means the publication is still receiving offers.
const ACCEPTANCE_SIGNALS: string[] = [
  'llamado',
  'convocatoria',
  'apertura',
  'recepción de ofertas',
  'pliego de condiciones',
  'objeto del llamado',
  'fecha de apertura',
  'presentación de ofertas',
  'compra directa',
  'licitación pública',
  'licitación abreviada',
]

export interface StageGateResult {
  isOpenTender: boolean
  stage: string           // "Llamado abierto" | "Adjudicación/cierre"
  reason: string          // Spanish explanation
}

/**
 * Decide whether a publication is an open tender or a closed/awarded notice.
 * Rejection signals are checked first; if none match, acceptance signals; if
 * neither match, the tender is accepted (benefit of the doubt).
 */
export function applyStageGate(tender: NormalizedTender): StageGateResult {
  const haystack = `${tender.title} ${tender.description}`.toLowerCase()

  const rejection = REJECTION_SIGNALS.find((signal) => haystack.includes(signal))
  if (rejection) {
    const result: StageGateResult = {
      isOpenTender: false,
      stage: 'Adjudicación/cierre',
      reason: `Señal de cierre detectada: "${rejection}"`,
    }
    console.log(`[CRIBAL][STAGE-GATE] Rechazado: ${tender.title} — ${result.reason}`)
    return result
  }

  const acceptance = ACCEPTANCE_SIGNALS.find((signal) => haystack.includes(signal))
  if (acceptance) {
    return {
      isOpenTender: true,
      stage: 'Llamado abierto',
      reason: `Señal de llamado abierto detectada: "${acceptance}"`,
    }
  }

  return {
    isOpenTender: true,
    stage: 'Llamado abierto',
    reason: 'Sin señales de cierre; se acepta por defecto',
  }
}
