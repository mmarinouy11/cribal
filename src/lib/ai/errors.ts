// Classify and log errors from the Anthropic API so failures are visible
// (billing, rate limits, outages) instead of looking like "no results". Never
// logs or exposes API keys — only the error type, HTTP status and message.

export type AiErrorType =
  | 'billing' // credit balance too low / billing problem
  | 'rate_limit' // 429
  | 'overloaded' // 5xx / unavailable
  | 'invalid_request' // other 4xx
  | 'truncated' // response hit max_tokens — output was cut off
  | 'parse_error' // response could not be parsed into the expected shape
  | 'unknown'

export interface ClassifiedAiError {
  type: AiErrorType
  httpStatus: number | null
  message: string
}

/** A classified, fatal AI failure thrown so a caller (e.g. the pipeline) can react. */
export class AiServiceError extends Error {
  readonly type: AiErrorType
  readonly httpStatus: number | null
  constructor(classified: ClassifiedAiError) {
    super(classified.message)
    this.name = 'AiServiceError'
    this.type = classified.type
    this.httpStatus = classified.httpStatus
  }
}

function getHttpStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}

function getMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

/** Map any thrown value from an Anthropic call to a typed classification. */
export function classifyAiError(error: unknown): ClassifiedAiError {
  const httpStatus = getHttpStatus(error)
  const message = getMessage(error)

  if (/credit balance|billing|insufficient|too low/i.test(message)) {
    return { type: 'billing', httpStatus, message }
  }
  if (httpStatus === 429) return { type: 'rate_limit', httpStatus, message }
  if (httpStatus !== null && httpStatus >= 500) return { type: 'overloaded', httpStatus, message }
  if (httpStatus !== null && httpStatus >= 400) return { type: 'invalid_request', httpStatus, message }
  return { type: 'unknown', httpStatus, message }
}

/** Classify, log with the [CRIBAL][AI] prefix (no keys), and return the result. */
export function logAiError(context: string, error: unknown): ClassifiedAiError {
  const classified = classifyAiError(error)
  console.error(
    `[CRIBAL][AI] ${context} — tipo=${classified.type} http=${classified.httpStatus ?? 'n/a'} msg=${classified.message}`
  )
  return classified
}

/**
 * Infrastructure failures that should fail a pipeline run (as opposed to a
 * malformed single response, which can be skipped): no credit, throttling, or
 * the service being down.
 */
export function isFatalAiError(type: AiErrorType): boolean {
  return type === 'billing' || type === 'rate_limit' || type === 'overloaded'
}

/** Short Spanish reason for the dashboard "Última ejecución" failure line. */
export function aiErrorReason(type: AiErrorType): string {
  switch (type) {
    case 'billing':
      return 'servicio de IA sin crédito'
    case 'rate_limit':
      return 'límite de la API de IA alcanzado'
    case 'overloaded':
      return 'servicio de IA no disponible'
    case 'invalid_request':
      return 'error en la solicitud de IA'
    case 'truncated':
      return 'respuesta de IA incompleta'
    case 'parse_error':
      return 'respuesta de IA ilegible'
    default:
      return 'error de IA'
  }
}
