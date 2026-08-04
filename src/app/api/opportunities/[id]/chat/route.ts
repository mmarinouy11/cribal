import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { MarketAnalysis, Opportunity, Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { extractPliegoText } from '@/lib/pliego/extractor'
import { formatDateDMY, formatDateTime } from '@/lib/format'
import type { TenderItem } from '@/lib/scraper/arce-parser'

// The chat calls Claude and may fetch/parse a PDF — keep it on the Node runtime.
export const runtime = 'nodejs'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2000
const MAX_MESSAGES = 50 // hard cap of messages stored per chat
const CONTEXT_MESSAGES = 20 // how many recent messages are sent to Claude
const RATE_LIMIT_MS = 2000 // min gap between messages per opportunity
const MAX_PROMPT_CHARS = 150_000 // total system prompt budget

interface PostBody {
  message?: string
}

function tenderItemsFromJson(value: Prisma.JsonValue | null): TenderItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item)
  ) as unknown as TenderItem[]
}

function formatTenderItems(value: Prisma.JsonValue | null): string {
  const items = tenderItemsFromJson(value)
  if (items.length === 0) return 'No disponible'
  return items
    .map((item) => {
      const code = item.articleCode ? ` (Cód. Artículo ${item.articleCode})` : ''
      const qty = item.quantity ? ` — Cantidad: ${item.quantity}` : ''
      return `${item.itemNumber}. ${item.name}${code}${qty}`
    })
    .join('\n')
}

/** Build the system prompt with everything known about the opportunity. */
function buildSystemPrompt(
  opportunity: Opportunity,
  market: MarketAnalysis | null,
  pliegoText: string | null
): string {
  const marketSection = market
    ? `=== ANÁLISIS DE MERCADO ===
${market.summary ?? 'No disponible'}

Adjudicaciones similares encontradas: ${market.adjudicationsFound}
Competidores identificados: ${market.competitorsFound}
`
    : ''

  const pliegoSection = pliegoText
    ? `=== CONTENIDO DEL PLIEGO ===
${pliegoText}`
    : 'Pliego PDF: no disponible o no procesado aún.'

  return `Sos un asistente especializado en licitaciones del Estado uruguayo.
Tu tarea es responder preguntas sobre una licitación específica basándote en la
información disponible: datos del llamado, ítems, fechas, y cuando esté disponible,
el contenido del pliego PDF y el análisis de mercado.

Respondé siempre en español. Sé concreto y citá la fuente cuando sea posible
(ej: "Según el pliego..." o "Los datos del llamado indican...").
Si no encontrás la respuesta en la información disponible, decilo claramente
en vez de inventar.

=== DATOS DEL LLAMADO ===
Título: ${opportunity.title}
Organismo: ${opportunity.organismo ?? 'No especificado'}
Tipo: ${opportunity.tenderType ?? 'No especificado'}
Descripción: ${opportunity.description ?? 'No disponible'}
Fecha de publicación: ${formatDateDMY(opportunity.publicationDate)}
Fecha de cierre: ${formatDateTime(opportunity.closingDate)}
Acto de apertura: ${formatDateTime(opportunity.openingDate)}
Prórrogas hasta: ${formatDateDMY(opportunity.prorrogasDate)}
Aclaraciones hasta: ${formatDateDMY(opportunity.clarificationsDate)}
Contacto: ${opportunity.contactEmail ?? ''} ${opportunity.contactPhone ?? ''}

=== ÍTEMS DEL LLAMADO ===
${formatTenderItems(opportunity.tenderItems)}

=== CLASIFICACIÓN IA ===
Score de relevancia: ${opportunity.score}/10
Categoría: ${opportunity.category ?? 'No clasificado'}
Resumen: ${opportunity.summary ?? 'No disponible'}
Ángulo comercial sugerido: ${opportunity.recommendedPlay ?? 'No disponible'}

${marketSection}
${pliegoSection}

URL del llamado en ARCE: ${opportunity.url}
`
}

/**
 * Fit the pliego text within the total prompt budget: build the prompt without
 * it, then include as much pliego text as the remaining budget allows.
 */
function budgetedSystemPrompt(
  opportunity: Opportunity,
  market: MarketAnalysis | null,
  pliegoText: string | null,
  historyChars: number
): string {
  if (!pliegoText) return buildSystemPrompt(opportunity, market, null)
  const base = buildSystemPrompt(opportunity, market, '')
  const budget = MAX_PROMPT_CHARS - base.length - historyChars
  if (budget <= 0) return buildSystemPrompt(opportunity, market, null)
  const trimmed = pliegoText.length > budget ? pliegoText.slice(0, budget) : pliegoText
  return buildSystemPrompt(opportunity, market, trimmed)
}

function textFromResponse(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
}

async function loadOwnedOpportunity(id: string, companyId: string): Promise<Opportunity | null> {
  return prisma.opportunity.findFirst({ where: { id, companyId } })
}

/** GET — return the chat history (creating the chat lazily). */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const companyId = session.user.companyId

  const opportunity = await loadOwnedOpportunity(params.id, companyId)
  if (!opportunity) return NextResponse.json({ error: 'No autorizado' }, { status: 404 })

  const chat = await prisma.pliegoChat.upsert({
    where: { opportunityId_companyId: { opportunityId: opportunity.id, companyId } },
    create: { opportunityId: opportunity.id, companyId },
    update: {},
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })

  return NextResponse.json({ messages: chat.messages })
}

/** POST — add the user's message, ask Claude, persist and return the reply. */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const companyId = session.user.companyId

  const opportunity = await loadOwnedOpportunity(params.id, companyId)
  if (!opportunity) return NextResponse.json({ error: 'No autorizado' }, { status: 404 })

  let body: PostBody = {}
  try {
    body = (await request.json()) as PostBody
  } catch {
    body = {}
  }
  const message = (body.message ?? '').trim()
  if (!message) {
    return NextResponse.json({ error: 'El mensaje no puede estar vacío' }, { status: 400 })
  }

  // Load or create the chat with its message history.
  const chat = await prisma.pliegoChat.upsert({
    where: { opportunityId_companyId: { opportunityId: opportunity.id, companyId } },
    create: { opportunityId: opportunity.id, companyId },
    update: {},
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })

  // Message cap.
  if (chat.messages.length >= MAX_MESSAGES) {
    return NextResponse.json(
      { error: 'Se alcanzó el límite de mensajes para esta consulta.' },
      { status: 429 }
    )
  }

  // Basic rate limit: one message every 2s per opportunity.
  const lastMessage = chat.messages[chat.messages.length - 1]
  if (lastMessage && Date.now() - lastMessage.createdAt.getTime() < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: 'Esperá unos segundos antes de enviar otro mensaje.' },
      { status: 429 }
    )
  }

  // Lazily extract and cache the pliego PDF text the first time it is needed.
  let pliegoText = opportunity.pliegoText
  if (!pliegoText && opportunity.pliegoUrl) {
    pliegoText = await extractPliegoText(opportunity.pliegoUrl)
    if (pliegoText) {
      await prisma.opportunity.update({
        where: { id: opportunity.id },
        data: { pliegoText },
      })
    }
  }

  const market = await prisma.marketAnalysis.findFirst({
    where: { opportunityId: opportunity.id, companyId },
    orderBy: { analyzedAt: 'desc' },
  })

  // Send only the last N messages plus the new one to Claude.
  const recent = chat.messages.slice(-CONTEXT_MESSAGES)
  const claudeMessages: Anthropic.MessageParam[] = [
    ...recent.map((m) => ({
      role: (m.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: message },
  ]

  const historyChars =
    claudeMessages.reduce((acc, m) => acc + (m.content as string).length, 0)
  const systemPrompt = budgetedSystemPrompt(opportunity, market, pliegoText, historyChars)

  let answer: string
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: claudeMessages,
    })
    answer = textFromResponse(response)
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][CHAT] Error consultando a Claude (${opportunity.id}): ${errMessage}`)
    return NextResponse.json(
      { error: 'No se pudo obtener respuesta del asistente. Intentá nuevamente.' },
      { status: 502 }
    )
  }

  if (!answer) {
    return NextResponse.json(
      { error: 'El asistente no devolvió respuesta.' },
      { status: 502 }
    )
  }

  // Persist both the user message and the assistant reply.
  await prisma.chatMessage.create({
    data: { chatId: chat.id, role: 'USER', content: message },
  })
  const assistantMessage = await prisma.chatMessage.create({
    data: { chatId: chat.id, role: 'ASSISTANT', content: answer },
  })
  await prisma.pliegoChat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } })

  return NextResponse.json({
    message: {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
    },
  })
}
