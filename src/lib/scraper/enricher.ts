import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getBusinessDaysUntilClosing } from '@/lib/pipeline/urgency'
import { sendUrgencyAlert } from '@/lib/email/urgency-alert'
import { fetchArceHtml, delay } from './fetch-arce'
import {
  isAdjudication,
  parseTenderDetail,
  parseAdjudicationDetail,
  type TenderItem,
} from './arce-parser'

const ARCE_DETAIL_BASE = 'https://www.comprasestatales.gub.uy/consultas/detalle/id'

function detailUrl(externalId: string): string {
  return `${ARCE_DETAIL_BASE}/${externalId}`
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
    select: { id: true, externalId: true, url: true, title: true },
  })
  if (!opportunity) {
    console.warn(`[CRIBAL][ENRICH] Oportunidad ${opportunityId} no encontrada`)
    return
  }

  // Be respectful to ARCE servers.
  await delay(500)

  const html = await fetchArceHtml(detailUrl(opportunity.externalId))
  if (!html) {
    console.warn(`[CRIBAL][ENRICH] Sin HTML para ${opportunity.title}; se omite enriquecimiento`)
    return
  }

  const data: Prisma.OpportunityUpdateInput = { enrichedAt: new Date() }

  try {
    if (isAdjudication(html)) {
      // The publication is already an adjudication — store its resolution data.
      const adj = parseAdjudicationDetail(html)
      data.similarAdjudications = adj as unknown as Prisma.InputJsonValue
      console.log(
        `[CRIBAL][ENRICH] Oportunidad enriquecida (adjudicación): ${opportunity.title} — ${adj.resolution ?? 'sin resolución'}`
      )
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
