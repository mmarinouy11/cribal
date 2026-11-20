import he from 'he'
import { prisma } from '@/lib/db/prisma'
import { normalizeText } from '@/lib/text/normalize'

// A catalog code + raw heading name extracted from a tender detail page.
export interface LearnedItem {
  code: number
  name: string
}

// Strip the "Ítem Nº 1240 " prefix ARCE puts before the article name in item
// headings. Covers "Nº", "N°", "No" and a plain "Ítem 1240".
const ITEM_PREFIX = /^[íi]tem\s*(?:n[º°o.]*\s*)?\d+\s*[-–—:]?\s*/i

/** Clean a tender item heading into a catalog-style article name. */
function cleanItemName(rawName: string): string {
  const withoutPrefix = rawName.replace(ITEM_PREFIX, '')
  return he.decode(withoutPrefix).replace(/\s+/g, ' ').trim()
}

/**
 * Teach the catalog from the items of a real tender: insert any article codes
 * that are NOT already in `catalog_articles`, marked `source = 'tender'`.
 *
 * - Existing rows are never touched (createMany + skipDuplicates).
 * - `familyText` is copied verbatim from an existing row of the same family (we
 *   never invent it). When the family is unknown, or no row of that family
 *   exists yet, nothing is inserted — the search endpoint drops rows without a
 *   parseable family anyway.
 * - `subfamilyText` is left null (the column is nullable).
 *
 * The name drops the "Ítem Nº N" prefix but otherwise keeps the full heading
 * text: ARCE may append buyer-specific wording to the article name and the two
 * cannot be separated reliably, so `source = 'tender'` marks it as approximate.
 */
export async function learnCatalogFromTenders(
  items: LearnedItem[],
  familyNumber: number | null
): Promise<{ added: number }> {
  if (familyNumber === null || items.length === 0) return { added: 0 }

  // Copy the exact familyText from an existing row of this family.
  const familyRow = await prisma.catalogArticle.findFirst({
    where: { familyText: { startsWith: `${familyNumber}-` } },
    select: { familyText: true },
  })
  if (!familyRow?.familyText) return { added: 0 }
  const familyText = familyRow.familyText

  // Keep only codes not already present; dedupe within the batch.
  const byCode = new Map<number, LearnedItem>()
  for (const item of items) {
    if (!Number.isInteger(item.code) || item.code <= 0) continue
    if (!byCode.has(item.code)) byCode.set(item.code, item)
  }
  const codes = [...byCode.keys()]
  if (codes.length === 0) return { added: 0 }

  const existing = await prisma.catalogArticle.findMany({
    where: { id: { in: codes } },
    select: { id: true },
  })
  const existingIds = new Set(existing.map((r) => r.id))

  const rows = codes
    .filter((code) => !existingIds.has(code))
    .map((code) => {
      const name = cleanItemName(byCode.get(code)!.name)
      return {
        id: code,
        name: name || `Artículo ${code}`,
        nameNorm: normalizeText(name),
        familyText,
        subfamilyText: null,
        source: 'tender',
      }
    })
  if (rows.length === 0) return { added: 0 }

  const result = await prisma.catalogArticle.createMany({ data: rows, skipDuplicates: true })
  return { added: result.count }
}
