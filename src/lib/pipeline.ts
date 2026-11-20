import type { Prisma, Opportunity } from '@prisma/client'
import { prisma } from './db/prisma'
import { fetchRssFeeds, type RssItem } from './pipeline/fetcher'
import { normalize, type NormalizedTender } from './pipeline/normalizer'
import { filterByDate } from './pipeline/dateFilter'
import { filterByKeywords } from './pipeline/keywordFilter'
import { filterExclusions } from './pipeline/exclusionFilter'
import { applyStageGate, type StageGateResult } from './pipeline/stageGate'
import { filterDuplicates } from './pipeline/deduplicator'
import { classifyTenders } from './pipeline/classifier'
import { ingestFailedTenders } from './pipeline/failed-tenders'
import { sendDigest, type NicheDigestItem } from './email/digest'
import { sendAdminFeedsDownAlert } from './email/admin-alert'
import { enrichOpportunity } from './scraper/enricher'
import { isDueToRun, daysUntilNextRun, effectiveLookbackDays } from './cadence'

interface PipelineError {
  stage: string
  message: string
}

// Outcome of a single company's run, so the orchestrator can detect a global
// ARCE outage and raise one admin alert.
export interface PipelineRunResult {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  feedsTotal: number
  feedsFailed: number
  allFeedsFailed: boolean
  errorSummary?: string
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

/**
 * Run the full pipeline for a single company: fetch, normalize, filter,
 * classify with Claude, persist opportunities and send the digest email.
 */
export async function runPipeline(companyId: string): Promise<PipelineRunResult> {
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
    // 3. Fetch RSS feeds (with retries + per-feed status).
    const { items, errors: fetchErrors, feedStatuses } = await fetchRssFeeds(company.rssFeeds)
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
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      })
      return { status: 'FAILED', feedsTotal, feedsFailed, allFeedsFailed: true, errorSummary }
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

    // 5. Date filter. The window widens to cover the gap since the last
    // successful run (capped at 30 days) so a multi-day ARCE outage is caught up
    // once it recovers — not just the configured lookbackDays.
    const windowDays = effectiveLookbackDays(company.lastSuccessfulRunAt, company.lookbackDays, new Date())
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
    const { newTenders, duplicates } = await filterDuplicates(stageGatePassed, company.id)
    for (const tender of duplicates) {
      await saveRawPublication(
        run.id,
        tender,
        rawByOpportunityId.get(tender.opportunityId),
        'duplicado',
        'Ya existe una oportunidad con este opportunityId en la base de datos'
      )
    }

    // 7e. Passed all filters — sent to AI.
    const rawPubIdByOpportunityId = new Map<string, string>()
    for (const tender of newTenders) {
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
        itemsSentToAi: newTenders.length,
      },
    })

    // 9. Classify with Claude.
    const classifications = await classifyTenders(newTenders, company)
    const tenderByOpportunityId = new Map(newTenders.map((t) => [t.opportunityId, t]))

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

    // 11. Update opportunities counter.
    await prisma.run.update({
      where: { id: run.id },
      data: { opportunitiesSaved: savedOpportunities.length },
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
    const suppressEmail = someFeedsFailed && savedOpportunities.length === 0
    if (suppressEmail) {
      console.log(
        `[CRIBAL][EMAIL] Corrida parcial sin relevantes — no se envía email (${company.companyName}, run ${run.id})`
      )
    } else {
      try {
        await sendDigest(savedOpportunities, newTenders, company, run.id, newDigestNiches)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ stage: 'email', message })
        console.error(`[CRIBAL][EMAIL] Error enviando email: ${message}`)
      }
    }

    // 13. Mark the run completed/partial. Only a fully successful run (every feed
    // OK) advances lastSuccessfulRunAt, so a partial run retries next cron and the
    // search window keeps covering the gap.
    const finalStatus = someFeedsFailed ? 'PARTIAL' : 'COMPLETED'
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
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
        errors: errors as unknown as Prisma.InputJsonValue,
      },
    })
    return {
      status: 'FAILED',
      feedsTotal: company.rssFeeds.length,
      feedsFailed: 0,
      allFeedsFailed: false,
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
  let ran = 0
  let skipped = 0
  const results: PipelineRunResult[] = []

  for (const company of companies) {
    // Never spend API credits on an ownerless company (e.g. an orphan left by a
    // failed registration).
    if (company._count.users === 0) {
      console.log(`[CRIBAL] Omitiendo ${company.companyName} — sin usuarios asociados`)
      skipped++
      continue
    }

    if (!isDueToRun(company.lastSuccessfulRunAt, company.lookbackDays, now)) {
      const days = daysUntilNextRun(company.lastSuccessfulRunAt, company.lookbackDays, now)
      console.log(
        `[CRIBAL] Omitiendo ${company.companyName} — próxima ejecución en ${days} día(s)`
      )
      skipped++
      continue
    }

    try {
      results.push(await runPipeline(company.id))
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

  console.log(
    `${prefix} Pipeline completado — ${ran} empresa(s) ejecutadas, ${skipped} omitidas`
  )
}
