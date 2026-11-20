import 'dotenv/config'
import dns from 'node:dns/promises'
import net from 'node:net'
import { familyFeedUrl } from '../arce/catalog'

/**
 * Diagnose connectivity to ARCE from wherever this runs (e.g. Railway). For the
 * ARCE homepage and the family-2 RSS feed it checks, separately, DNS resolution,
 * TCP connect and HTTP response — so a failure can be pinned to the right layer
 * ("DNS falla" vs "TCP no conecta" vs "HTTP responde"). 30s timeout per step.
 *
 * Run with: npm run arce:health
 */

const USER_AGENT = 'Mozilla/5.0 (compatible; Cribal/1.0)'
const STEP_TIMEOUT_MS = 30_000
const IPIFY_URL = 'https://api.ipify.org'

const TARGETS = ['https://www.comprasestatales.gub.uy/', familyFeedUrl(2)]

/** Reject a promise if it does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms / 1000}s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function reportOutboundIp(): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS)
  try {
    const res = await fetch(IPIFY_URL, { signal: controller.signal, cache: 'no-store' })
    const ip = (await res.text()).trim()
    console.log(`[ARCE-HEALTH] IP de salida: ${ip}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[ARCE-HEALTH] IP de salida: no se pudo determinar (${message})`)
  } finally {
    clearTimeout(timer)
  }
}

async function checkDns(host: string): Promise<string> {
  const start = Date.now()
  try {
    const records = await withTimeout(dns.lookup(host, { all: true }), STEP_TIMEOUT_MS)
    const ips = records.map((r) => r.address).join(', ')
    return `DNS: OK (${ips}, ${Date.now() - start}ms)`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `DNS: FALLA (${message})`
  }
}

function checkTcp(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = net.connect({ host, port })
    socket.setTimeout(STEP_TIMEOUT_MS)
    socket.once('connect', () => {
      socket.destroy()
      resolve(`TCP ${port}: OK (${Date.now() - start}ms)`)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(`TCP ${port}: FALLA (timeout ${STEP_TIMEOUT_MS / 1000}s)`)
    })
    socket.once('error', (error: Error) => {
      socket.destroy()
      resolve(`TCP ${port}: FALLA (${error.message})`)
    })
  })
}

async function checkHttp(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS)
  const start = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
      signal: controller.signal,
    })
    return `HTTP: ${res.status} (${Date.now() - start}ms)`
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `timeout ${STEP_TIMEOUT_MS / 1000}s`
        : error instanceof Error
          ? error.message
          : String(error)
    return `HTTP: FALLA (${message})`
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  console.log('[ARCE-HEALTH] ===== Diagnóstico de conectividad con ARCE =====')
  await reportOutboundIp()

  for (const url of TARGETS) {
    const host = new URL(url).hostname
    console.log(`[ARCE-HEALTH] Objetivo: ${url}`)
    console.log(`[ARCE-HEALTH]   ${await checkDns(host)}`)
    console.log(`[ARCE-HEALTH]   ${await checkTcp(host, 443)}`)
    console.log(`[ARCE-HEALTH]   ${await checkHttp(url)}`)
  }
}

main().catch((error) => {
  console.error('[ARCE-HEALTH] Falló:', error)
  process.exit(1)
})
