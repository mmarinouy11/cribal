import type { Prisma, Opportunity } from '@prisma/client'
import { prisma } from './db/prisma'
import { type RssItem } from './pipeline/fetcher'
import { fetchCompanyFeeds, runGlobalIngestion } from './pipeline/global-ingestion'
import { FAILURE_FEED_URLS } from './pipeline/failed-tenders'
import { normalize, type NormalizedTender } from './pipeline/normalizer'
import { filterByDate } from './pipeline/dateFilter'
import { filterByKeywords } from './pipeline/keywordFilter'
import { filterExclusions } from './pipeline/exclusionFilter'
import { applyStageGate, type StageGateResult } from './pipeline/stageGate'
import { filterDuplicates } from './pipeline/deduplicator'
import { classifyTenders, type ClassificationOutcome } from './pipeline/classifier'
import { getOnboardingExamples } from './actions/onboarding-opportunities'
import { ingestFailedTenders } from './pipeline/failed-tenders'
import { sendDigest, type NicheDigestItem } from './email/digest'
import { sendAdminFeedsDownAlert, sendAdminAiBillingAlert } from './email/admin-alert'
import { enrichOpportunity, fetchTenderClosing } from './scraper/enricher'
import { delay } from './scraper/fetch-arce'
import { isDueToRun, daysUntilNextRun, effectiveLookbackDays } from './cadence'
import { AiServiceError, aiErrorReason } from './ai/errors'

// The first full run for a company (no earlier COMPLETED pipeline run) looks back
// over a wide window and caps how many tenders it classifies, prioritising the
// ones closing soonest, so the account starts with the ACTIVE relevant tenders
// instead of whatever happened to be published in the last 24h.
const FIRST_RUN_WINDOW_DAYS = 45
const FIRST_RUN_MAX_TO_CLASSIFY = 60
const FIRST_RUN_ENRICH_DELAY_MS = 400

interface PipelineError {
  stage: string
  message: string
}

// Why a run failed, for the admin alert and the dashboard.
export type FailureKind =
  | 'feeds_down'
  | 'ai_billing'
  | 'ai_rate_limit'
  | 'ai_unavailable'
  | 'other'

// Outcome of a single company's run, so the orchestrator can detect a global
// ARCE outage or an AI billing problem and raise one admin alert.
export interface PipelineRunResult {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  feedsTotal: number
  feedsFailed: number
  allFeedsFailed: boolean
  failureKind?: FailureKind
  errorSummary?: string
}

/** Map a thrown AiServiceError to a run failure kind. */
function aiFailureKind(error: AiServiceError): FailureKind {
  if (error.type === 'billing') return 'ai_billing'
  if (error.type === 'rate_limit') return 'ai_rate_limit'
  return 'ai_unavailable'
}

/** Short, human-readable summary of the failed feeds for logs/UI/email. */
function summarizeFeedFailures(errors: { feed: string; error: string }[]): string {
  return errors.map((e) => `${e.feed}: ${e.error}`).join(' | ')
}

/** Persist a RawPublication for a tender, swallowing save errors per item. */
async function saveRawPublication(
  runId: string,
  tender: NormalizedTender,
  rawItem: RssItem | undefined,
  filterResult: string,
  filterReason: string | null
): Promise<string | null> {
  try {
    const created = await prisma.rawPublication.create({
      data: {
        runId,
        tenderId: tender.tenderId,
        rawRssItem: (rawItem ?? {}) as unknown as Prisma.InputJsonValue,
        normalized: tender as unknown as Prisma.InputJsonValue,
        filterResult,
        filterReason,
      },
    })
    return created.id
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[CRIBAL][RAW] Error guardando RawPublication para ${tender.opportunityId}: ${message}`
    )
    return null
  }
}

/** True when the company has no earlier COMPLETED pipeline run (onboarding runs
 * do not count), i.e. this is its first full run. */
async function isFirstPipelineRun(companyId: string): Promise<boolean> {
  const completed = await prisma.run.count({
    where: { companyId, kind: 'pipeline', status: 'COMPLETED' },
  })
  return completed === 0
}

/**
 * First-run selection: enrich each candidate to learn its closing date, keep
 * only tenders still open (closing date in the future or unknown), order them by
 * nearest closing and cap the number sent to classification. Returns the capped
 * list and how many were dropped by the cap.
 */
async function selectFirstRunActiveTenders(
  tenders: NormalizedTender[]
): Promise<{ selected: NormalizedTender[]; closingByOpportunityId: Map<string, Date | null> }> {
  const open: { tender: NormalizedTender; closingDate: Date | null }[] = []
  for (const tender of tenders) {
    const { closingDate, isClosed } = await fetchTenderClosing(tender.tenderId)
    if (isClosed) continue // expired / already awarded — drop it
    open.push({ tender, closingDate })
    await delay(FIRST_RUN_ENRICH_DELAY_MS)
  }

  // Nearest closing first; unknown closing dates go last.
  open.sort((a, b) => {
    if (a.closingDate && b.closingDate) return a.closingDate.getTime() - b.closingDate.getTime()
    if (a.closingDate) return -1
    if (b.closingDate) return 1
    return 0
  })

  const capped = open.slice(0, FIRST_RUN_MAX_TO_CLASSIFY)
  if (open.length > FIRST_RUN_MAX_TO_CLASSIFY) {
    console.log(
      `[CRIBAL][PIPELINE] primera corrida: ${open.length} activas, ${open.length - FIRST_RUN_MAX_TO_CLASSIFY} quedaron fuera del tope de ${FIRST_RUN_MAX_TO_CLASSIFY}`
    )
  }

  const closingByOpportunityId = new Map<string, Date | null>(
    capped.map((o) => [o.tender.opportunityId, o.closingDate])
  )
  return { selected: capped.map((o) => o.tender), closingByOpportunityId }
}

/**
 * Run the full pipeline for a single company: fetch, normalize, filter,
 * classify with Claude, persist opportunities and send the digest email.
 */
export async function runPipeline(
  companyId: string,
  options: { skipGlobalIngestion?: boolean } = {}
): Promise<PipelineRunResult> {
  // 1. Load company config.
  const company = await prisma.companyConfig.findUnique({ where: { id: companyId } })
  if (!company) {
    console.error(`[CRIBAL] Empresa ${companyId} no encontrada`)
    return { status: 'FAILED', feedsTotal: 0, feedsFailed: 0, allFeedsFailed: false }
  }

  console.log(`[CRIBAL] Iniciando pipeline para ${company.companyName}...`)

  // 2. Create the Run record.
  const run = await prisma.run.create({
    data: { companyId: company.id, status: 'RUNNING' },
  })

  const errors: PipelineError[] = []

  try {
    // 2b. Shared ingestion for this company's feeds, unless the caller already
    // ran the global pass (the cron runs it once for all due companies). This is
    // what makes the manual "run now" path go through the same shared ingestion:
    // it populates feed_cache / global_tenders and then the company reads from
    // the global tables. The advisory lock + conditional download mean a recent
    // same-day ingestion of the same families is reused, not re-downloaded.
    if (!options.skipGlobalIngestion) {
      try {
        await runGlobalIngestion([...company.rssFeeds, ...FAILURE_FEED_URLS])
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[CRIBAL][INGEST] Ingesta por empresa falló (se continúa): ${message}`)
      }
    }

    // 3. Fetch RSS feeds. Served from the shared cache the ingestion just filled
    // (so several companies share one download per feed); otherwise fetched
    // directly with the normal retries.
    const { items, errors: fetchErrors, feedStatuses } = await fetchCompanyFeeds(company.rssFeeds)
    for (const fetchError of fetchErrors) {
      errors.push({ stage: 'fetch', message: `${fetchError.feed}: ${fetchError.error}` })
    }

    const feedsTotal = company.rssFeeds.length
    const feedsFailed = feedStatuses.filter((f) => !f.ok).length
    const allFeedsFailed = feedsTotal > 0 && feedsFailed === feedsTotal
    const someFeedsFailed = feedsFailed > 0 && !allFeedsFailed

    await prisma.run.update({
      where: { id: run.id },
      data: {
        feedsChecked: company.rssFeeds.length,
        rawItemsFound: items.length,
        errors: errors as unknown as Prisma.InputJsonValue,
      },
    })

    // 3b. All feeds down → ARCE did not respond. Mark the run FAILED, do NOT
    // advance lastSuccessfulRunAt (so the next run retries and the search window
    // keeps widening), send no email, and report it to the caller.
    if (allFeedsFailed) {
      const errorSummary = summarizeFeedFailures(fetchErrors).slice(0, 500)
      console.error(
        `[CRIBAL] ARCE no respondió para ${company.companyName} — ${feedsFailed}/${feedsTotal} feeds caídos`
      )
      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          failureReason: 'ARCE no respondió',
          failureDetail: errorSummary,
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      })
      return {
        status: 'FAILED',
        feedsTotal,
        feedsFailed,
        allFeedsFailed: true,
        failureKind: 'feeds_down',
        errorSummary,
      }
    }

    // 4. Normalize. Keep the raw item alongside so RawPublication can store it.
    const rawByOpportunityId = new Map<string, RssItem>()
    const normalizedTenders: NormalizedTender[] = []
    for (const item of items) {
      const tender = normalize(item)
      normalizedTenders.push(tender)
      if (!rawByOpportunityId.has(tender.opportunityId)) {
        rawByOpportunityId.set(tender.opportunityId, item)
      }
    }

    // 5. Date filter. The first full run uses a wide 45-day window so a new
    // account starts with the ACTIVE relevant tenders (not just whatever was
    // published in the last 24h). Later runs widen the window to cover the gap
    // since the last successful run (capped at 30 days), not just lookbackDays.
    const firstRun = await isFirstPipelineRun(company.id)
    const windowDays = firstRun
      ? FIRST_RUN_WINDOW_DAYS
      : effectiveLookbackDays(company.lastSuccessfulRunAt, company.lookbackDays, new Date())
    if (firstRun) {
      console.log(`[CRIBAL][PIPELINE] primera corrida: ventana ${FIRST_RUN_WINDOW_DAYS} días`)
    }
    const afterDate = filterByDate(normalizedTenders, windowDays)
    await prisma.run.update({
      where: { id: run.id },
      data: { itemsAfterDateFilter: afterDate.length },
    })

    // 6. Deduplicate within the current run by tenderId.
    const seenTenderIds = new Set<string>()
    const dedupedInRun: NormalizedTender[] = []
    for (const tender of afterDate) {
      const key = tender.tenderId || tender.opportunityId
      if (seenTenderIds.has(key)) continue
      seenTenderIds.add(key)
      dedupedInRun.push(tender)
    }

    // 7a. Keyword filter.
    const keywordResult = filterByKeywords(
      dedupedInRun,
      company.relevantKeywords,
      company.excludedKeywords
    )
    for (const { tender, reason } of keywordResult.rejected) {
      await saveRawPublication(
        run.id,
        tender,
        rawByOpportunityId.get(tender.opportunityId),
        'keyword_rechazado',
        reason
      )
    }

    // 7b. Exclusion filter.
    const exclusionResult = filterExclusions(
      keywordResult.passed,
      company.excludedProducts,
      company.relevantKeywords
    )
    for (const { tender, reason } of exclusionResult.rejected) {
      await saveRawPublication(
        run.id,
        tender,
        rawByOpportunityId.get(tender.opportunityId),
        'exclusion_rechazado',
        reason
      )
    }

    // 7c. Stage gate.
    const stageByOpportunityId = new Map<string, StageGateResult>()
    const stageGatePassed: NormalizedTender[] = []
    for (const tender of exclusionResult.passed) {
      const stageResult = applyStageGate(tender)
      if (!stageResult.isOpenTender) {
        await saveRawPublication(
          run.id,
          tender,
          rawByOpportunityId.get(tender.opportunityId),
          'stage_gate_rechazado',
          stageResult.reason
        )
        continue
      }
      stageByOpportunityId.set(tender.opportunityId, stageResult)
      stageGatePassed.push(tender)
    }
    console.log(
      `[CRIBAL][STAGE-GATE] ${exclusionResult.passed.length} → ${stageGatePassed.length} llamados abiertos`
    )

    // 7d. DB duplicate check (scoped to this company).
    const { newTenders, duplicates, onboardingMatches } = await filterDuplicates(
      stageGatePassed,
      company.id
    )
    for (const tender of duplicates) {
      await saveRawPublication(
        run.id,
        tender,
        rawByOpportunityId.get(tender.opportunityId),
        'duplicado',
        'Ya existe una oportunidad con este opportunityId en la base de datos'
      )
    }

    // 7d-promote. A candidate that already exists as an onboarding-sample
    // opportunity: if it is still open and was marked relevant (by the user or
    // the AI during onboarding), promote it to source=pipeline — reusing the
    // stored classification and the user's mark, with no AI call — so it shows on
    // the dashboard and counts as relevant in the email. Not-relevant marks and
    // expired/awarded tenders stay as onboarding calibration.
    const promotedRelevant: Opportunity[] = []
    let itemsPromoted = 0
    for (const match of onboardingMatches) {
      // The stored status already encodes the user's mark (which wins over the
      // AI): NUEVA = relevant, anything else = not relevant → keep as calibration.
      if (match.status !== 'NUEVA') continue
      const { closingDate, isClosed } = await fetchTenderClosing(match.tender.tenderId)
      if (isClosed) continue // expired / awarded → keep as calibration
      try {
        const promoted = await prisma.opportunity.update({
          where: { id: match.opportunityDbId },
          data: {
            source: 'pipeline',
            runId: run.id,
            ...(closingDate ? { closingDate } : {}),
          },
        })
        promotedRelevant.push(promoted)
        itemsPromoted++
        // Refresh dates / pliego / items without blocking the run.
        enrichOpportunity(match.opportunityDbId).catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          console.error(
            `[CRIBAL][ENRICH] Error enriqueciendo promovida ${match.opportunityDbId}: ${message}`
          )
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ stage: 'promote', message })
        console.error(`[CRIBAL][PROMO] Error promoviendo ${match.tender.opportunityId}: ${message}`)
      }
    }
    if (itemsPromoted > 0) {
      console.log(
        `[CRIBAL][PROMO] ${itemsPromoted} oportunidad(es) del onboarding promovidas a pipeline — ${company.companyName}`
      )
    }

    // 7d-bis. First run only: enrich to learn closing dates, keep only tenders
    // still open, and cap how many go to classification (nearest closing first).
    // Later runs classify every new tender, as before.
    let tendersToClassify = newTenders
    if (firstRun && newTenders.length > 0) {
      const { selected, closingByOpportunityId } = await selectFirstRunActiveTenders(newTenders)
      tendersToClassify = selected
      // Record the ones left out (closed, or beyond the cap) so they are audited.
      for (const tender of newTenders) {
        if (closingByOpportunityId.has(tender.opportunityId)) continue
        await saveRawPublication(
          run.id,
          tender,
          rawByOpportunityId.get(tender.opportunityId),
          'descartado_primera_corrida',
          'Primera corrida: licitación cerrada o fuera del tope de clasificación por cierre más cercano'
        )
      }
    }

    // 7e. Passed all filters — sent to AI.
    const rawPubIdByOpportunityId = new Map<string, string>()
    for (const tender of tendersToClassify) {
      const rawPubId = await saveRawPublication(
        run.id,
        tender,
        rawByOpportunityId.get(tender.opportunityId),
        'enviado_a_ia',
        null
      )
      if (rawPubId) rawPubIdByOpportunityId.set(tender.opportunityId, rawPubId)
    }

    // 8. Update stage counters.
    await prisma.run.update({
      where: { id: run.id },
      data: {
        itemsAfterKeyword: keywordResult.passed.length,
        itemsAfterStageGate: stageGatePassed.length,
        itemsSentToAi: tendersToClassify.length,
      },
    })

    // 9. Classify with Claude. A fatal AI failure (no credit / throttled / down)
    // must fail the run and NOT advance lastSuccessfulRunAt, like feeds down.
    // The company's onboarding marks calibrate the classifier.
    const onboardingExamples = await getOnboardingExamples(company.id)
    let classification: ClassificationOutcome
    try {
      classification = await classifyTenders(tendersToClassify, company, onboardingExamples)
    } catch (error) {
      if (error instanceof AiServiceError) {
        const kind = aiFailureKind(error)
        const reason = `Falló: ${aiErrorReason(error.type)}`
        errors.push({ stage: 'ai', message: `${error.type}: ${error.message}` })
        console.error(`[CRIBAL] Clasificación IA falló para ${company.companyName}: ${error.type}`)
        await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            failureReason: aiErrorReason(error.type),
            failureDetail: error.message.slice(0, 500),
            errors: errors as unknown as Prisma.InputJsonValue,
          },
        })
        return {
          status: 'FAILED',
          feedsTotal: company.rssFeeds.length,
          feedsFailed,
          allFeedsFailed: false,
          failureKind: kind,
          errorSummary: reason,
        }
      }
      throw error
    }
    const { results: classifications, unclassifiedIds } = classification
    if (unclassifiedIds.length > 0) {
      console.warn(
        `[CRIBAL][IA] ${unclassifiedIds.length} llamado(s) sin clasificar para ${company.companyName}`
      )
      // Record them for audit; they are NOT saved as opportunities and the run is
      // marked PARTIAL below, so they are retried on the next run.
      for (const opportunityId of unclassifiedIds) {
        const rawPubId = rawPubIdByOpportunityId.get(opportunityId)
        if (rawPubId) {
          await prisma.rawPublication.update({
            where: { id: rawPubId },
            data: {
              filterResult: 'sin_clasificar',
              filterReason: 'La IA no pudo clasificarla (respuesta incompleta); se reintenta',
            },
          })
        }
      }
    }
    const tenderByOpportunityId = new Map(tendersToClassify.map((t) => [t.opportunityId, t]))

    // 10. Persist relevant opportunities; annotate the rest.
    const savedOpportunities: Opportunity[] = []
    for (const result of classifications) {
      const tender = tenderByOpportunityId.get(result.opportunityId)
      if (!tender) continue

      const rawPubId = rawPubIdByOpportunityId.get(result.opportunityId)
      const isRelevant = result.isRelevant && result.score >= company.minimumScore

      if (isRelevant) {
        try {
          const stageResult = stageByOpportunityId.get(result.opportunityId)
          const opportunity = await prisma.opportunity.create({
            data: {
              companyId: company.id,
              runId: run.id,
              opportunityId: tender.opportunityId,
              externalId: tender.tenderId,
              sourceType: tender.source,
              publicationDate: tender.publicationDate,
              organismo: tender.organismo || null,
              title: tender.title,
              description: tender.description || null,
              url: tender.url,
              tenderType: tender.tenderType,
              category: result.category,
              score: result.score,
              summary: result.summary,
              recommendedPlay: result.recommendedPlay,
              stageGatePassed: true,
              stageGateReason: stageResult?.reason ?? null,
              aiRawOutput: result as unknown as Prisma.InputJsonValue,
            },
          })
          savedOpportunities.push(opportunity)

          // Fire and forget — never block the pipeline for enrichment.
          enrichOpportunity(opportunity.id).catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[CRIBAL][ENRICH] Error enriqueciendo ${opportunity.id}: ${message}`)
          })

          if (rawPubId) {
            await prisma.rawPublication.update({
              where: { id: rawPubId },
              data: {
                filterResult: 'guardado',
                filterReason: `Relevante (score ${result.score}): ${result.summary}`,
              },
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          errors.push({ stage: 'save_opportunity', message })
          console.error(
            `[CRIBAL] Error guardando oportunidad ${tender.opportunityId}: ${message}`
          )
        }
      } else if (rawPubId) {
        await prisma.rawPublication.update({
          where: { id: rawPubId },
          data: {
            filterReason: `Descartado por IA (score ${result.score}, relevante=${result.isRelevant}): ${result.summary}`,
          },
        })
      }
    }

    // 11. Update opportunities counters. Relevant opportunities shown to the
    // user are the ones saved from classification plus the promoted onboarding
    // matches.
    const relevantOpportunities = [...savedOpportunities, ...promotedRelevant]
    await prisma.run.update({
      where: { id: run.id },
      data: { opportunitiesSaved: savedOpportunities.length, itemsPromoted },
    })

    // 11b. Ingest failed tenders (desiertas / ofertas rechazadas) and recompute
    // niches. Best-effort — a failure here must never break the main pipeline.
    let newDigestNiches: NicheDigestItem[] = []
    try {
      const { ingested, nichesUpdated } = await ingestFailedTenders(company, run.id)
      await prisma.run.update({
        where: { id: run.id },
        data: { failedTendersFound: ingested, nichesDetected: nichesUpdated },
      })
      // High-signal niches touched during this run feed the digest section.
      newDigestNiches = await prisma.niche.findMany({
        where: {
          companyId: company.id,
          signalStrength: { in: ['ALTA', 'MEDIA'] },
          status: { notIn: ['DESCARTADO', 'ARCHIVADO'] },
          updatedAt: { gte: run.startedAt },
        },
        orderBy: [{ signalStrength: 'asc' }, { lastFailureAt: 'desc' }],
        select: {
          id: true,
          label: true,
          category: true,
          failureCount: true,
          lastFailureAt: true,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ stage: 'failed_tenders', message })
      console.error(`[CRIBAL][NICHOS] Error ingiriendo fallos: ${message}`)
    }

    // 11c. Re-enrich opportunities under active review (REVISANDO) so their dates
    // and pliego data stay fresh while being worked. Best-effort. (`url` is always
    // present, so no null check is needed.)
    try {
      const watchedOpportunities = await prisma.opportunity.findMany({
        where: { companyId: company.id, status: 'REVISANDO' },
        select: { id: true },
      })

      for (const opp of watchedOpportunities) {
        await enrichOpportunity(opp.id)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      if (watchedOpportunities.length > 0) {
        console.log(
          `[CRIBAL] Re-enriquecidas ${watchedOpportunities.length} oportunidades en seguimiento`
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ stage: 'reenrich', message })
      console.error(
        `[CRIBAL] Error re-enriqueciendo oportunidades en seguimiento: ${message}`
      )
    }

    // 12. Send the digest email — but not for a partial run unless it produced
    // new relevant opportunities (a partial run must never look like "no news").
    const suppressEmail = someFeedsFailed && relevantOpportunities.length === 0
    if (suppressEmail) {
      console.log(
        `[CRIBAL][EMAIL] Corrida parcial sin relevantes — no se envía email (${company.companyName}, run ${run.id})`
      )
    } else {
      try {
        await sendDigest(relevantOpportunities, newTenders, company, run.id, newDigestNiches)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ stage: 'email', message })
        console.error(`[CRIBAL][EMAIL] Error enviando email: ${message}`)
      }
    }

    // 13. Mark the run completed/partial. Only a fully successful run (every feed
    // OK and every tender classified) advances lastSuccessfulRunAt, so a partial
    // run retries next cron and the search window keeps covering the gap. Tenders
    // the AI could not classify also make the run PARTIAL so they are retried.
    const hasUnclassified = unclassifiedIds.length > 0
    const finalStatus = someFeedsFailed || hasUnclassified ? 'PARTIAL' : 'COMPLETED'
    const partialReasons: string[] = []
    if (someFeedsFailed) partialReasons.push('algunos feeds de ARCE no respondieron')
    if (hasUnclassified) {
      partialReasons.push(`${unclassifiedIds.length} licitación(es) quedaron sin clasificar`)
    }
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        failureReason: finalStatus === 'PARTIAL' ? partialReasons.join('; ') : null,
        errors: errors as unknown as Prisma.InputJsonValue,
      },
    })
    if (finalStatus === 'COMPLETED') {
      await prisma.companyConfig.update({
        where: { id: companyId },
        data: { lastSuccessfulRunAt: new Date() },
      })
    }

    console.log(
      `[CRIBAL] Pipeline ${finalStatus === 'PARTIAL' ? 'parcial' : 'completado'} — ${company.companyName}: ${savedOpportunities.length} oportunidades guardadas`
    )
    return {
      status: finalStatus,
      feedsTotal,
      feedsFailed,
      allFeedsFailed: false,
      errorSummary: someFeedsFailed ? summarizeFeedFailures(fetchErrors).slice(0, 500) : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors.push({ stage: 'pipeline', message })
    console.error(`[CRIBAL] Pipeline FALLIDO para ${company.companyName}: ${message}`)
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        failureReason: 'error inesperado',
        failureDetail: message.slice(0, 500),
        errors: errors as unknown as Prisma.InputJsonValue,
      },
    })
    return {
      status: 'FAILED',
      feedsTotal: company.rssFeeds.length,
      feedsFailed: 0,
      allFeedsFailed: false,
      failureKind: 'other',
      errorSummary: message.slice(0, 500),
    }
  }
}

/**
 * Run the pipeline for every active company that is due to run according to its
 * cadence (`lookbackDays`). The daily cron fires this; each company decides
 * internally whether it is due. Companies not yet due are skipped. Per-company
 * manual runs bypass this by calling `runPipeline` directly.
 *
 * `triggeredBy` only affects logging: 'cron' marks scheduled runs so they can be
 * told apart from manual runs in the logs.
 */
export async function runPipelineAllCompanies(
  triggeredBy: 'cron' | 'manual' = 'manual'
): Promise<void> {
  const prefix = triggeredBy === 'cron' ? '[CRIBAL][CRON]' : '[CRIBAL]'
  const companies = await prisma.companyConfig.findMany({
    where: { isActive: true },
    include: { _count: { select: { users: true } } },
  })

  console.log(`${prefix} Iniciando pipeline para ${companies.length} empresas activas...`)

  const now = new Date()
  let skipped = 0
  const results: PipelineRunResult[] = []

  // Decide which companies run this pass, so the shared ingestion only warms the
  // feeds they actually need.
  const dueCompanies = companies.filter((company) => {
    if (company._count.users === 0) {
      console.log(`[CRIBAL] Omitiendo ${company.companyName} — sin usuarios asociados`)
      skipped++
      return false
    }
    if (!isDueToRun(company.lastSuccessfulRunAt, company.lookbackDays, now)) {
      const days = daysUntilNextRun(company.lastSuccessfulRunAt, company.lookbackDays, now)
      console.log(`[CRIBAL] Omitiendo ${company.companyName} — próxima ejecución en ${days} día(s)`)
      skipped++
      return false
    }
    return true
  })

  // Shared ingestion pass: download every feed the due companies need (plus the
  // global failure feeds) once, into the cache, before any company runs. On a
  // total ARCE outage this reports FAILED but we still proceed — each company
  // then processes whatever is already saved.
  if (dueCompanies.length > 0) {
    const feedUrls = [...dueCompanies.flatMap((c) => c.rssFeeds), ...FAILURE_FEED_URLS]
    try {
      const ingestion = await runGlobalIngestion(feedUrls, now)
      console.log(
        `${prefix} Ingesta global: ${ingestion.status} — ${ingestion.feedsTotal} feeds, ${ingestion.feedsFromCache} sin re-descargar`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${prefix} Error en ingesta global (se continúa): ${message}`)
    }
  }

  let ran = 0
  for (const company of dueCompanies) {
    try {
      // The global ingestion already ran once above for every due company's
      // feeds, so each company run skips its own ingestion and reads the cache.
      results.push(await runPipeline(company.id, { skipGlobalIngestion: true }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${prefix} Error inesperado en ${company.companyName}: ${message}`)
    }
    ran++
  }

  // If every company that ran had all its feeds down, ARCE is unreachable from
  // here — raise at most one admin alert per day.
  const feedsDownCount = results.filter((r) => r.allFeedsFailed).length
  if (ran > 0 && feedsDownCount === results.length && results.length > 0) {
    const errorSummary = results.find((r) => r.errorSummary)?.errorSummary
    try {
      await sendAdminFeedsDownAlert(feedsDownCount, errorSummary)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${prefix} Error enviando aviso al administrador: ${message}`)
    }
  }

  // Any AI billing failure (no credit) → one admin alert per day.
  const billing = results.filter((r) => r.failureKind === 'ai_billing')
  if (billing.length > 0) {
    try {
      await sendAdminAiBillingAlert(billing.length, billing.find((r) => r.errorSummary)?.errorSummary)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${prefix} Error enviando aviso de IA al administrador: ${message}`)
    }
  }

  console.log(
    `${prefix} Pipeline completado — ${ran} empresa(s) ejecutadas, ${skipped} omitidas`
  )
}
