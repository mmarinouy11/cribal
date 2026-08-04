import { PDFParse } from 'pdf-parse'

const ARCE_BASE = 'https://www.comprasestatales.gub.uy'
const USER_AGENT = 'Mozilla/5.0 (compatible; Cribal/1.0)'
const MAX_CHARS = 80_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch the pliego PDF from ARCE and extract its text. Best-effort: returns null
 * (never throws) on any fetch/parse failure. Truncated to 80k characters. Waits
 * 500ms before fetching to be gentle with ARCE.
 */
export async function extractPliegoText(pliegoUrl: string): Promise<string | null> {
  const url = pliegoUrl.startsWith('http')
    ? pliegoUrl
    : `${ARCE_BASE}${pliegoUrl.startsWith('/') ? '' : '/'}${pliegoUrl}`

  try {
    await delay(500)
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
    })
    if (!response.ok) {
      console.warn(`[CRIBAL][PLIEGO] ${url} respondió ${response.status}`)
      return null
    }

    const data = new Uint8Array(await response.arrayBuffer())
    const parser = new PDFParse({ data })
    try {
      const result = await parser.getText()
      let text = (result.text ?? '').trim()
      if (!text) return null
      if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)
      console.log(`[CRIBAL][PLIEGO] Extraído: ${text.length} caracteres de ${url}`)
      return text
    } finally {
      await parser.destroy()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CRIBAL][PLIEGO] Error extrayendo ${url}: ${message}`)
    return null
  }
}
