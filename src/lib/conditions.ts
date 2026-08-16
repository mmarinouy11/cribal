// Shared types for the "Condiciones para presentarse" analysis. Kept in a plain
// module so both the server action and the client component can import it.

export interface ConditionsAnalysis {
  experienciaMinima: string | null
  certificaciones: string[]
  garantias: string | null
  documentacionRequerida: string[]
  restricciones: string[]
  plazoEjecucion: string | null
  criterioEvaluacion: string | null
  resumenGeneral: string
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

/** Defensively coerce a stored JSON value into a ConditionsAnalysis, or null. */
export function parseConditions(value: unknown): ConditionsAnalysis | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const resumen = asString(obj.resumenGeneral)
  // A parsed analysis must at least have a summary to be worth showing.
  if (!resumen) return null

  return {
    experienciaMinima: asString(obj.experienciaMinima),
    certificaciones: asStringArray(obj.certificaciones),
    garantias: asString(obj.garantias),
    documentacionRequerida: asStringArray(obj.documentacionRequerida),
    restricciones: asStringArray(obj.restricciones),
    plazoEjecucion: asString(obj.plazoEjecucion),
    criterioEvaluacion: asString(obj.criterioEvaluacion),
    resumenGeneral: resumen,
  }
}
