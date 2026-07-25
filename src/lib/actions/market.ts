'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { analyzeMarket } from '@/lib/scraper/market-intelligence'

export interface MarketAnalysisResult {
  success: boolean
  analysisId?: string
  error?: string
}

export async function triggerMarketAnalysis(
  opportunityId: string
): Promise<MarketAnalysisResult> {
  const session = await auth()
  if (!session) return { success: false, error: 'No autorizado' }
  const companyId = session.user.companyId

  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId },
    select: { status: true },
  })
  if (!opportunity) return { success: false, error: 'No autorizado' }

  if (opportunity.status !== 'RELEVANTE' && opportunity.status !== 'REVISANDO') {
    return {
      success: false,
      error: 'El análisis de mercado requiere estado Relevante o Revisando',
    }
  }

  try {
    const analysis = await analyzeMarket(opportunityId, companyId)
    revalidatePath(`/oportunidades/${opportunityId}`)
    return { success: true, analysisId: analysis.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][MERCADO] Error analizando ${opportunityId}: ${message}`)
    return { success: false, error: 'No se pudo completar el análisis de mercado' }
  }
}
