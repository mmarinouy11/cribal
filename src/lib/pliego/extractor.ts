import AdmZip from 'adm-zip'

const ARCE_BASE = 'https://www.comprasestatales.gub.uy'
const USER_AGENT = 'Mozilla/5.0 (compatible; Cribal/1.0)'
const MAX_CHARS = 80_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Parse a PDF buffer to trimmed, length-capped text (null when empty). */
async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string | null> {
  // Dynamic import inside the function so Next never loads pdf-parse during the
  // build's page-data collection (its pdfjs dependency touches browser-only APIs).
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
  const result = await pdfParse(buffer)
  let text = (result.text ?? '').trim()
  if (!text) return null
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)
  return text
}

/** Find the first PDF entry inside a ZIP buffer and extract its text. */
async function extractPdfFromZip(zipBuffer: Buffer): Promise<string | null> {
  const zip = new AdmZip(zipBuffer)
  const pdfEntry = zip
    .getEntries()
    .find((entry) => entry.entryName.toLowerCase().endsWith('.pdf'))
  if (!pdfEntry) return null
  return extractTextFromPdfBuffer(pdfEntry.getData())
}

function looksLikeZip(buffer: Buffer): boolean {
  // ZIP local file header magic: "PK\x03\x04".
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
}

function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.toString('latin1', 0, 5) === '%PDF-'
}

/**
 * Fetch the pliego from ARCE and extract its text. Handles both raw PDFs and
 * ZIP files that contain a PDF (detected by magic bytes, so a `.zip` with a
 * query string still works). Best-effort: returns null (never throws) on any
 * fetch/parse failure. Truncated to 80k characters. Waits 500ms before fetching
 * to be gentle with ARCE.
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

    const buffer = Buffer.from(await response.arrayBuffer())

    let text: string | null
    if (looksLikeZip(buffer)) {
      text = await extractPdfFromZip(buffer)
      if (!text) {
        console.warn(`[CRIBAL][PLIEGO] ZIP sin PDF adentro: ${url}`)
        return null
      }
    } else if (looksLikePdf(buffer)) {
      text = await extractTextFromPdfBuffer(buffer)
    } else {
      // Unknown/unsupported format (e.g. .doc/.docx). The URL is still stored on
      // the opportunity; we just cannot extract text here.
      console.warn(`[CRIBAL][PLIEGO] Formato no soportado para extracción: ${url}`)
      return null
    }

    if (!text) return null
    console.log(`[CRIBAL][PLIEGO] Extraído: ${text.length} caracteres de ${url}`)
    return text
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CRIBAL][PLIEGO] Error extrayendo ${url}: ${message}`)
    return null
  }
}
