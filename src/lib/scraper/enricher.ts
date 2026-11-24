import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getBusinessDaysUntilClosing } from '@/lib/pipeline/urgency'
import { sendUrgencyAlert } from '@/lib/email/urgency-alert'
import { delay } from './fetch-arce'
import { getOrFetchDetailHtml } from '@/lib/pipeline/global-ingestion'
import {
  isAdjudication,
  parseTenderDetail,
  parseAdjudicationDetail,
  extractBuyObject,
  type TenderItem,
} from './arce-parser'
import { learnCatalogFromTenders, type LearnedItem } from '@/lib/catalog/learn-from-tenders'

/**
 * Best-effort: teach the catalog any new article codes this tender uses. The
 * family is inferred from the tender's items that are already in the catalog
 * (they share a family), so unknown codes are learned under the right family.
 * Never throws — any failure is logged and enrichment continues.
 */
async function learnCatalogFromDetail(items: TenderItem[]): Promise<void> {
  try {
    const learned: LearnedItem[] = []
    for (const item of items) {
      const code = item.articleCode ? Number.parseInt(item.articleCode, 10) : Number.NaN
      if (Number.isInteger(code) && code > 0) learned.push({ code, name: item.name })
    }
    if (learned.length === 0) return

    // Infer the family from items already in the catalog.
    const known = await prisma.catalogArticle.findMany({
      where: { id: { in: learned.map((l) => l.code) } },
      select: { familyText: true },
    })
    const familyNumber = known
      .map((r) => r.familyText?.match(/^(\d+)/)?.[1])
      .map((n) => (n ? Number(n) : null))
      .find((n): n is number => n !== null) ?? null

    const { added } = await learnCatalogFromTenders(learned, familyNumber)
    if (added > 0) console.log(`[CRIBAL][ENRICH] Catálogo aprendió ${added} artículo(s) de una licitación`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CRIBAL][ENRICH] learnCatalogFromTenders falló (ignorado): ${message}`)
  }
}

const ARCE_DETAIL_BASE = 'https://www.comprasestatales.gub.uy/consultas/detalle/id'

function detailUrl(externalId: string): string {
  return `${ARCE_DETAIL_BASE}/${externalId}`
}

export interface TenderClosingInfo {
  closingDate: Date | null
  isClosed: boolean // adjudicated, or the closing date is already in the past
  isAdjudicated: boolean // the detail page shows the tender was already awarded
}

/**
 * Fetch just the closing status of a tender from its ARCE detail page (via the
 * shared HTML cache, so it is downloaded once). Used by the first full run to
 * drop tenders that are already closed or awarded. An unreachable page is
 * treated as "unknown" (not closed) so we never drop a tender just because ARCE
 * did not answer.
 */
export async function fetchTenderClosing(tenderId: string): Promise<TenderClosingInfo> {
  const html = await getOrFetchDetailHtml(tenderId, detailUrl(tenderId))
  if (!html) return { closingDate: null, isClosed: false, isAdjudicated: false }
  if (isAdjudication(html)) return { closingDate: null, isClosed: true, isAdjudicated: true }
  const { closingDate } = parseTenderDetail(html)
  const isClosed = closingDate !== null && closingDate.getTime() < Date.now()
  return { closingDate, isClosed, isAdjudicated: false }
}

/**
 * Fetch the ARCE detail page for an opportunity and store the structured data.
 * Best-effort: on any fetch/parse problem it logs a warning and leaves
 * `enrichedAt` null rather than throwing. Never call this in a way that blocks
 * the pipeline — it is meant to be fired and forgotten.
 */
export async function enrichOpportunity(opportunityId: string): Promise<void> {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, externalId: true, url: true, title: true, tenderType: true },
  })
  if (!opportunity) {
    console.warn(`[CRIBAL][ENRICH] Oportunidad ${opportunityId} no encontrada`)
    return
  }

  // Be respectful to ARCE servers.
  await delay(500)

  // The detail page is the same for every company, so it is fetched once per
  // tender per day through the shared cache (parsing below stays per-company).
  const html = await getOrFetchDetailHtml(opportunity.externalId, detailUrl(opportunity.externalId))
  if (!html) {
    console.warn(`[CRIBAL][ENRICH] Sin HTML para ${opportunity.title}; se omite enriquecimiento`)
    return
  }

  const data: Prisma.OpportunityUpdateInput = { enrichedAt: new Date() }

  // The buy-object one-liner (real object of the call) is on the detail page for
  // both tenders and adjudications. Keep the previous value if it's absent now.
  const buyObject = extractBuyObject(html)
  if (buyObject) data.objectDescription = buyObject

  try {
    if (isAdjudication(html)) {
      // The publication is already an adjudication — store its resolution data.
      const adj = parseAdjudicationDetail(html)
      data.similarAdjudications = adj as unknown as Prisma.InputJsonValue

      // An adjudicated Compra Directa is closed: discard it so it drops out of
      // the active views.
      if (opportunity.tenderType === 'Compra Directa') {
        data.status = 'DESCARTADA'
        console.log(
          `[CRIBAL][ENRICH] Compra Directa adjudicada detectada en enriquecimiento: ${opportunity.title} — marcada como descartada`
        )
      } else {
        console.log(
          `[CRIBAL][ENRICH] Oportunidad enriquecida (adjudicación): ${opportunity.title} — ${adj.resolution ?? 'sin resolución'}`
        )
      }
    } else {
      const detail = parseTenderDetail(html)
      data.closingDate = detail.closingDate
      data.openingDate = detail.openingDate
      data.prorrogasDate = detail.prorrogasDate
      data.clarificationsDate = detail.clarificationsDate
      data.contactEmail = detail.contactEmail
      data.contactPhone = detail.contactPhone
      data.contactName = detail.contactName
      data.pliegoUrl = detail.pliegoUrl
      data.isElectronic = detail.isElectronic
      if (detail.items.length > 0) {
        data.tenderItems = detail.items as unknown as Prisma.InputJsonValue
        // Teach the catalog any new codes this tender uses (best-effort).
        await learnCatalogFromDetail(detail.items)
      }
      if (detail.publicationDate) data.publicationDate = detail.publicationDate

      const closing = detail.closingDate ? detail.closingDate.toISOString() : 'sin fecha'
      console.log(
        `[CRIBAL][ENRICH] Oportunidad enriquecida: ${opportunity.title} — cierre: ${closing}`
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CRIBAL][ENRICH] Error parseando ${opportunity.title}: ${message}`)
  }

  try {
    await prisma.opportunity.update({ where: { id: opportunity.id }, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CRIBAL][ENRICH] Error guardando enriquecimiento de ${opportunity.title}: ${message}`)
    return
  }

  await maybeSendUrgencyAlert(opportunity.id)
}

/**
 * If the (now enriched) opportunity is RELEVANTE and closes within 3 business
 * days, send an immediate urgency alert. Best-effort — never throws.
 */
async function maybeSendUrgencyAlert(opportunityId: string): Promise<void> {
  try {
    const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } })
    if (
      !opportunity ||
      opportunity.status !== 'RELEVANTE' ||
      !opportunity.closingDate ||
      getBusinessDaysUntilClosing(opportunity.closingDate) > 3
    ) {
      return
    }

    const company = await prisma.companyConfig.findUnique({
      where: { id: opportunity.companyId },
    })
    if (company) await sendUrgencyAlert(opportunity, company)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[CRIBAL][ENRICH] Error evaluando urgencia de ${opportunityId}: ${message}`)
  }
}

export type { TenderItem }
