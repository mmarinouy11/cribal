import { fetch as undiciFetch, ProxyAgent } from 'undici'

/**
 * Central HTTP entry point for every ARCE (comprasestatales.gub.uy) request:
 * RSS feeds, tender detail pages and pliego downloads. When `ARCE_PROXY_URL` is
 * set, traffic is routed through that HTTP/HTTPS proxy via undici's ProxyAgent;
 * otherwise it falls back to the global fetch, so behavior is unchanged.
 *
 * Credentials embedded in the proxy URL are never logged — use maskedProxyUrl().
 */

// Only the request fields ARCE callers actually use. A subset of RequestInit so
// it works with both the global fetch and undici's fetch.
export interface ArceFetchInit {
  headers?: Record<string, string>
  cache?: RequestCache
  signal?: AbortSignal
  method?: string
  redirect?: RequestRedirect
}

let cachedAgent: ProxyAgent | null = null
let cachedAgentUrl: string | null = null

function proxyAgent(): ProxyAgent | null {
  const url = process.env.ARCE_PROXY_URL
  if (!url) return null
  // Rebuild the agent if the env changed (e.g. between script runs).
  if (!cachedAgent || cachedAgentUrl !== url) {
    cachedAgent = new ProxyAgent(url)
    cachedAgentUrl = url
  }
  return cachedAgent
}

/** Whether ARCE traffic is being routed through a proxy. */
export function isArceProxyEnabled(): boolean {
  return Boolean(process.env.ARCE_PROXY_URL)
}

/** The proxy URL with any user:password hidden, safe to log. Null when unset. */
export function maskedProxyUrl(): string | null {
  const url = process.env.ARCE_PROXY_URL
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.username) parsed.username = '***'
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return 'definido (no parseable)'
  }
}

/**
 * Fetch an ARCE URL, through the proxy when configured. Returns a standard
 * Response (undici's Response implements the same read methods used here:
 * ok/status/text/arrayBuffer).
 */
export async function arceFetch(url: string, init: ArceFetchInit = {}): Promise<Response> {
  const agent = proxyAgent()
  if (!agent) return fetch(url, init)
  const response = await undiciFetch(url, { ...init, dispatcher: agent })
  return response as unknown as Response
}
