'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import Parser from 'rss-parser'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

async function requireCompanyId(): Promise<string> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')
  return session.user.companyId
}

export interface CompanyConfigInput {
  companyName?: string
  description?: string
  capabilities?: string[]
  relevantKeywords?: string[]
  excludedKeywords?: string[]
  excludedProducts?: string[]
  minimumScore?: number
  lookbackDays?: number
  rssFeeds?: string[]
  customAiPrompt?: string | null
  notificationEmails?: string[]
}

export async function updateCompanyConfig(data: CompanyConfigInput): Promise<void> {
  const companyId = await requireCompanyId()

  const updateData: Prisma.CompanyConfigUpdateInput = {}
  if (data.companyName !== undefined) updateData.companyName = data.companyName
  if (data.description !== undefined) updateData.description = data.description || null
  if (data.capabilities !== undefined) updateData.capabilities = data.capabilities
  if (data.relevantKeywords !== undefined) updateData.relevantKeywords = data.relevantKeywords
  if (data.excludedKeywords !== undefined) updateData.excludedKeywords = data.excludedKeywords
  if (data.excludedProducts !== undefined) updateData.excludedProducts = data.excludedProducts
  if (data.minimumScore !== undefined) updateData.minimumScore = data.minimumScore
  if (data.lookbackDays !== undefined) updateData.lookbackDays = data.lookbackDays
  if (data.rssFeeds !== undefined) updateData.rssFeeds = data.rssFeeds
  if (data.customAiPrompt !== undefined) updateData.customAiPrompt = data.customAiPrompt || null
  if (data.notificationEmails !== undefined) {
    updateData.notificationEmails = data.notificationEmails
  }

  await prisma.companyConfig.update({
    where: { id: companyId },
    data: updateData,
  })

  revalidatePath('/configuracion')
  revalidatePath('/')
}

export interface CompanyProfileInput {
  longDescription?: string
  founded?: string
  teamSize?: string
  caseStudies?: string
  certifications?: string
  differentiators?: string
  proposalTemplate?: string
}

export async function updateCompanyProfile(data: CompanyProfileInput): Promise<void> {
  const companyId = await requireCompanyId()

  const fields = {
    longDescription: data.longDescription || null,
    founded: data.founded || null,
    teamSize: data.teamSize || null,
    caseStudies: data.caseStudies || null,
    certifications: data.certifications || null,
    differentiators: data.differentiators || null,
    proposalTemplate: data.proposalTemplate || null,
  }

  await prisma.companyProfile.upsert({
    where: { companyId },
    create: { companyId, ...fields },
    update: fields,
  })

  revalidatePath('/perfil')
}

export interface FeedTestResult {
  feed: string
  itemCount: number
  error?: string
}

export async function testRssFeeds(feeds: string[]): Promise<FeedTestResult[]> {
  // Requires a session, but the feeds come from the form (not the DB).
  await requireCompanyId()

  const parser = new Parser({ timeout: 30000 })

  const results = await Promise.all(
    feeds.map(async (feed): Promise<FeedTestResult> => {
      try {
        const parsed = await parser.parseURL(feed)
        return { feed, itemCount: parsed.items?.length ?? 0 }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { feed, itemCount: 0, error: message }
      }
    })
  )

  return results
}
