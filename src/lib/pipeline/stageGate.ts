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
  // Additional adjudication signals that appear in ARCE adjudication HTML
  // included in RSS descriptions.
  'adjudicada totalmente',
  'adjudicada parcialmente',
  'resolución nro',
  'resolucion nro',
  'fecha de compra',
  'monto total de la compra',
  'fondos rotatorios',
  'ítems adjudicados',
  'items adjudicados',
  'archivo de resolución',
  'archivo de resolucion',
  'proveedor:', // appears in adjudication item listings
]

// Signals used only for the Compra Directa pre-check (a superset tuned for the
// way adjudicated Compras Directas surface in the RSS feed).
const COMPRA_DIRECTA_ADJUDICATION_SIGNALS: string[] = [
  'adjudicada totalmente',
  'adjudicada parcialmente',
  'resolución',
  'resolucion',
  'adjudicataria',
  'proveedor adjudicado',
  'ítems adjudicados',
  'items adjudicados',
  'monto total de la compra',
  'fecha de compra',
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

  // Special case: adjudicated Compras Directas surface in the RSS with the same
  // title format as open ones. Reject them before the generic checks so a closed
  // Compra Directa never reaches the AI.
  const isCompraDirecta =
    tender.tenderType === 'Compra Directa' || tender.title.toLowerCase().includes('compra directa')

  if (isCompraDirecta) {
    const isAdjudicated = COMPRA_DIRECTA_ADJUDICATION_SIGNALS.some((signal) =>
      haystack.includes(signal)
    )
    if (isAdjudicated) {
      const result: StageGateResult = {
        isOpenTender: false,
        stage: 'Compra Directa adjudicada',
        reason: 'Rechazado: Compra Directa ya adjudicada, no acepta ofertas.',
      }
      console.log(`[CRIBAL][STAGE-GATE] Rechazado: ${tender.title} — ${result.reason}`)
      return result
    }
  }

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
