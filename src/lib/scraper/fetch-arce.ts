const USER_AGENT = 'Mozilla/5.0 (compatible; Cribal/1.0)'

/** Fetch an ARCE page as text with the required User-Agent. Returns null on failure. */
export async function fetchArceHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      // Detail pages are dynamic; avoid Next.js data cache.
      cache: 'no-store',
    })
    if (!response.ok) {
      console.warn(`[CRIBAL][SCRAPER] ${url} respondió ${response.status}`)
      return null
    }
    return await response.text()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CRIBAL][SCRAPER] Error obteniendo ${url}: ${message}`)
    return null
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
