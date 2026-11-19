import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { normalizeText } from '@/lib/text/normalize'

// Prisma queries, so keep this on the Node.js runtime (not Edge).
export const runtime = 'nodejs'

const MIN_QUERY_LENGTH = 3
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100
// How many matches to pull for in-memory ranking. Broad queries can match more;
// the client is told (via `total`) to narrow the search when that happens.
const CANDIDATE_CAP = 500

// In-memory rate limit: 30 requests per minute per IP. Process-local, which is
// enough for a public, unauthenticated endpoint used only during registration.
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > RATE_LIMIT
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Ranking tier for a candidate: whole-word (0) < prefix (1) < contains (2). */
function rankTier(nameNorm: string, query: string): number {
  const wholeWord = new RegExp(`(^|[^a-z0-9])${escapeRegExp(query)}([^a-z0-9]|$)`).test(nameNorm)
  if (wholeWord) return 0
  if (nameNorm.startsWith(query)) return 1
  return 2
}

/** Strip an ARCE "N-" code prefix for display (e.g. "2-MATERIALES" → "MATERIALES"). */
function stripCodePrefix(text: string): string {
  return text.replace(/^\d+\s*-\s*/, '').trim()
}

interface CatalogSearchItem {
  id: number
  name: string
  familyNumber: number
  familyName: string
  subfamilyName: string
}

/**
 * GET /api/catalog/search?q=...&limit=...
 *
 * Public (used during registration, before a session exists). Normalizes the
 * query, requires every token to be contained in the article's normalized name
 * (AND), ranks whole-word > prefix > contains (alphabetical tiebreak), and
 * returns the total match count plus the top `limit` items.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const ip = clientIp(request)
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: 'Demasiadas búsquedas. Esperá un momento e intentá de nuevo.' },
      { status: 429 }
    )
  }

  const { searchParams } = new URL(request.url)
  const normalizedQuery = normalizeText(searchParams.get('q') ?? '')
  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `La búsqueda debe tener al menos ${MIN_QUERY_LENGTH} caracteres.` },
      { status: 400 }
    )
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get('limit')) || DEFAULT_LIMIT)
  )

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const where: Prisma.CatalogArticleWhereInput = {
    AND: tokens.map((token) => ({ nameNorm: { contains: token } })),
  }

  const [total, candidates] = await Promise.all([
    prisma.catalogArticle.count({ where }),
    prisma.catalogArticle.findMany({
      where,
      select: { id: true, name: true, nameNorm: true, familyText: true, subfamilyText: true },
      orderBy: { nameNorm: 'asc' },
      take: CANDIDATE_CAP,
    }),
  ])

  const ranked = candidates
    .map((row) => ({ row, tier: rankTier(row.nameNorm, normalizedQuery) }))
    .sort((a, b) => a.tier - b.tier || a.row.nameNorm.localeCompare(b.row.nameNorm))

  const items: CatalogSearchItem[] = []
  for (const { row } of ranked) {
    const familyMatch = row.familyText?.match(/^(\d+)/)
    if (!familyMatch) {
      // Unparseable family prefix — drop the item and log it.
      console.warn(
        `[CRIBAL][CATALOG-SEARCH] familyText sin prefijo numérico, item descartado: id=${row.id} familyText="${row.familyText ?? ''}"`
      )
      continue
    }
    items.push({
      id: row.id,
      name: row.name,
      familyNumber: Number(familyMatch[1]),
      familyName: row.familyText ? stripCodePrefix(row.familyText) : '',
      // Raw subfamilyText (keeps the "N-" prefix) so callers can detect the
      // generic service subfamilies (8, 9) by number.
      subfamilyName: row.subfamilyText ?? '',
    })
    if (items.length >= limit) break
  }

  return NextResponse.json({ total, items })
}
