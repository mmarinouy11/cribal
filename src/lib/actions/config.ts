'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import Parser from 'rss-parser'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

async function requireCompanyId(): Promise<string> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')
  return session.user.companyId
}

const CONFIG_MODEL = 'claude-sonnet-4-6'

const CONFIG_SYSTEM_PROMPT = `Sos un experto en el sistema de compras estatales de Uruguay (ARCE / comprasestatales.gub.uy).
Tu tarea es configurar un sistema de alertas de licitaciones para una empresa según su perfil.

El sistema de ARCE organiza las licitaciones en "familias". Los feeds RSS más relevantes son:

Familia 10 — Bienes de Tecnología de la Información y Comunicación (TIC)
URL: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/10

Familia 3 — Servicios no personales (consultoría, servicios profesionales, mantenimiento)
URL: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/3

Familia 1 — Obras (construcción, reformas, infraestructura)
URL: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/1

Familia 2 — Bienes (suministros, equipamiento, materiales)
URL: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/2

Familia 4 — Servicios personales (recursos humanos, capacitación)
URL: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/4

Familia 5 — Arrendamientos (alquileres de bienes y servicios)
URL: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/5

Búsqueda por texto — para términos específicos del rubro:
URL: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/texto/{término}

Respondé ÚNICAMENTE con un objeto JSON válido, sin markdown, sin texto adicional:
{
  "relevantKeywords": string[],     // 10-20 términos en español específicos para este rubro
  "excludedKeywords": string[],     // 5-15 términos que claramente NO aplican a esta empresa
  "excludedProducts": string[],     // 0-5 productos/marcas específicas a excluir (puede ser array vacío)
  "rssFeeds": string[],             // 1-4 URLs de feeds relevantes para este perfil
  "minimumScore": number,           // Entre 6 y 8 según qué tan específico es el rubro
  "reasoning": string               // 2-3 oraciones en español explicando las elecciones
}`

export interface GeneratedCompanyConfig {
  relevantKeywords: string[]
  excludedKeywords: string[]
  excludedProducts: string[]
  rssFeeds: string[]
  minimumScore: number
  reasoning: string
}

const SAFE_CONFIG_DEFAULTS: GeneratedCompanyConfig = {
  relevantKeywords: [],
  excludedKeywords: [],
  excludedProducts: [],
  rssFeeds: ['https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/3'],
  minimumScore: 7,
  reasoning:
    'No se pudo generar configuración automática. Podés ajustar manualmente en Configuración.',
}

let cachedAnthropic: Anthropic | null = null

function getAnthropic(): Anthropic {
  if (!cachedAnthropic) {
    cachedAnthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return cachedAnthropic
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
}

function parseGeneratedConfig(text: string): GeneratedCompanyConfig {
  const parsed: unknown = JSON.parse(stripMarkdownFences(text))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('La respuesta de la IA no es un objeto JSON')
  }
  const obj = parsed as Record<string, unknown>
  const rawScore = typeof obj.minimumScore === 'number' ? obj.minimumScore : 7
  const minimumScore = Math.min(8, Math.max(6, Math.round(rawScore)))

  return {
    relevantKeywords: stringArray(obj.relevantKeywords),
    excludedKeywords: stringArray(obj.excludedKeywords),
    excludedProducts: stringArray(obj.excludedProducts),
    rssFeeds:
      stringArray(obj.rssFeeds).length > 0
        ? stringArray(obj.rssFeeds)
        : SAFE_CONFIG_DEFAULTS.rssFeeds,
    minimumScore,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : SAFE_CONFIG_DEFAULTS.reasoning,
  }
}

/**
 * Generate a tailored initial pipeline configuration from a company profile
 * using Claude. Deliberately does NOT require a session — it is also called from
 * the public registration flow. On repeated parse failure it returns safe
 * defaults instead of throwing.
 */
export async function generateCompanyConfig(input: {
  companyName: string
  description: string
  capabilities: string[]
}): Promise<GeneratedCompanyConfig> {
  const userMessage = `Empresa: ${input.companyName}
Descripción: ${input.description}
Capacidades y servicios: ${input.capabilities.join(', ')}

Generá la configuración óptima para detectar licitaciones relevantes para esta empresa.`

  const callModel = async (): Promise<string> => {
    const response = await getAnthropic().messages.create({
      model: CONFIG_MODEL,
      max_tokens: 1024,
      system: CONFIG_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  try {
    return parseGeneratedConfig(await callModel())
  } catch {
    try {
      return parseGeneratedConfig(await callModel())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[CRIBAL][CONFIG-IA] No se pudo generar configuración: ${message}`)
      return SAFE_CONFIG_DEFAULTS
    }
  }
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
