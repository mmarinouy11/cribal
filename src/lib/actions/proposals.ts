'use server'

import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

const MODEL = 'claude-sonnet-4-6'

const GENERATE_SYSTEM_PROMPT = `Sos un experto en propuestas comerciales para licitaciones del Estado uruguayo.

Generá una propuesta comercial completa y profesional para esta licitación.
La propuesta debe incluir: presentación de la empresa, propuesta de valor específica
para este llamado, descripción de la solución ofrecida, equipo y metodología,
experiencia relevante, y propuesta económica referencial.
Retorná el texto completo como string, en formato que se pueda incluir directamente
en un documento Word. Usá saltos de línea para separar secciones.`

const EDIT_SYSTEM_PROMPT = `Sos un asistente especializado en propuestas comerciales para licitaciones.
Tenés acceso al texto actual de la propuesta y al contexto de la licitación.
Cuando el usuario pida un cambio, modificá la propuesta según la instrucción
y retorná:
1. El texto completo de la propuesta actualizada
2. Un mensaje breve explicando qué cambiaste

Respondé SOLO con JSON: { "updatedProposal": string, "message": string }`

const EDIT_CONTEXT_MESSAGES = 10 // recent turns sent back to Claude for context

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return cachedClient
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function textFromResponse(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
}

/** Build the shared opportunity + company context block used by both actions. */
async function buildProposalContext(opportunityId: string): Promise<{
  companyId: string
  context: string
}> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')
  const companyId = session.user.companyId

  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId },
  })
  if (!opportunity) throw new Error('No autorizado')

  const company = await prisma.companyConfig.findUnique({
    where: { id: companyId },
    include: { profile: true },
  })
  if (!company) throw new Error('Empresa no encontrada')

  const profile = company.profile

  const context = `Empresa: ${company.companyName}
Razón social: ${profile?.legalName ?? company.companyName}
Descripción: ${profile?.longDescription ?? company.description ?? ''}
Capacidades: ${company.capabilities.join(', ')}
Casos de éxito: ${profile?.caseStudies ?? ''}
Certificaciones: ${profile?.certifications ?? ''}
Diferenciadores: ${profile?.differentiators ?? ''}
Equipo: ${profile?.teamSize ?? ''}
Instrucciones adicionales: ${profile?.proposalTemplate ?? ''}

Licitación:
- Título: ${opportunity.title}
- Organismo: ${opportunity.organismo ?? ''}
- Tipo: ${opportunity.tenderType ?? ''}
- Descripción: ${opportunity.description ?? ''}
- Resumen IA: ${opportunity.summary ?? ''}
- Ángulo comercial sugerido: ${opportunity.recommendedPlay ?? ''}`

  return { companyId, context }
}

/** Persist the proposal draft (one per opportunity, company-scoped). */
async function saveFullText(
  opportunityId: string,
  companyId: string,
  fullText: string
): Promise<void> {
  const existing = await prisma.proposal.findFirst({
    where: { opportunityId, companyId },
  })
  if (existing) {
    await prisma.proposal.update({ where: { id: existing.id }, data: { fullText } })
  } else {
    await prisma.proposal.create({ data: { opportunityId, companyId, fullText } })
  }
}

/**
 * Generate a complete proposal as a single text string (not structured JSON),
 * persist it on the opportunity's proposal draft, and return it. Company-scoped.
 */
export async function generateProposal(opportunityId: string): Promise<string> {
  const { companyId, context } = await buildProposalContext(opportunityId)

  const callModel = async (): Promise<string> => {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: GENERATE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context }],
    })
    return textFromResponse(response)
  }

  let fullText = await callModel()
  if (!fullText) fullText = await callModel()
  if (!fullText) throw new Error('La IA no devolvió una propuesta')

  await saveFullText(opportunityId, companyId, fullText)
  revalidatePath(`/oportunidades/${opportunityId}`)

  return fullText
}

/** Save a manually edited proposal draft. Company-scoped. */
export async function saveProposal(opportunityId: string, fullText: string): Promise<void> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')
  const companyId = session.user.companyId

  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId },
    select: { id: true },
  })
  if (!opportunity) throw new Error('No autorizado')

  await saveFullText(opportunityId, companyId, fullText)
  revalidatePath(`/oportunidades/${opportunityId}`)
}

function parseEditResult(text: string): { updatedProposal: string; message: string } {
  const parsed: unknown = JSON.parse(stripMarkdownFences(text))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('La respuesta de la IA no es un objeto JSON')
  }
  const obj = parsed as Record<string, unknown>
  const updatedProposal = typeof obj.updatedProposal === 'string' ? obj.updatedProposal : ''
  const message = typeof obj.message === 'string' ? obj.message : ''
  if (!updatedProposal) throw new Error('La respuesta no contiene la propuesta actualizada')
  return { updatedProposal, message }
}

/**
 * Edit the proposal via the proposal assistant chat: the model applies the
 * user's instruction to the current proposal text and returns the updated
 * proposal plus a short explanation. Persists the turn to ProposalChat, updates
 * the stored draft, and returns the result. Company-scoped.
 */
export async function editProposalWithChat(
  opportunityId: string,
  currentProposal: string,
  userInstruction: string,
  chatHistory: { role: string; content: string }[]
): Promise<{ updatedProposal: string; assistantMessage: string }> {
  const instruction = userInstruction.trim()
  if (!instruction) throw new Error('La instrucción no puede estar vacía')

  const { companyId, context } = await buildProposalContext(opportunityId)

  const userMessage = `=== CONTEXTO DE LA LICITACIÓN ===
${context}

=== PROPUESTA ACTUAL ===
${currentProposal || '(todavía no hay propuesta; generá una desde cero según la instrucción)'}

=== INSTRUCCIÓN DEL USUARIO ===
${instruction}`

  // Send recent chat turns for continuity, then the new instruction with full context.
  const recent = chatHistory.slice(-EDIT_CONTEXT_MESSAGES)
  const claudeMessages: Anthropic.MessageParam[] = [
    ...recent.map((m) => ({
      role: (m.role === 'ASSISTANT' || m.role === 'assistant' ? 'assistant' : 'user') as
        | 'user'
        | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  const callModel = async (): Promise<string> => {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: EDIT_SYSTEM_PROMPT,
      messages: claudeMessages,
    })
    return textFromResponse(response)
  }

  let result: { updatedProposal: string; message: string }
  try {
    result = parseEditResult(await callModel())
  } catch {
    // Retry once on malformed JSON.
    result = parseEditResult(await callModel())
  }

  // Persist the chat turn (user instruction + assistant explanation).
  const chat = await prisma.proposalChat.upsert({
    where: { opportunityId_companyId: { opportunityId, companyId } },
    create: { opportunityId, companyId },
    update: { updatedAt: new Date() },
  })
  await prisma.proposalChatMessage.create({
    data: { chatId: chat.id, role: 'USER', content: instruction },
  })
  await prisma.proposalChatMessage.create({
    data: { chatId: chat.id, role: 'ASSISTANT', content: result.message },
  })

  // Keep the stored draft in sync with the edited proposal.
  await saveFullText(opportunityId, companyId, result.updatedProposal)
  revalidatePath(`/oportunidades/${opportunityId}`)

  return { updatedProposal: result.updatedProposal, assistantMessage: result.message }
}
