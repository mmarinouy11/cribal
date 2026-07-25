'use server'

import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

const MODEL = 'claude-sonnet-4-6'

export interface ProposalData {
  executiveSummary: string
  valueProposition: string
  relevantCapabilities: string
  clarificationQuestions: string
  nextSteps: string
}

const SYSTEM_PROMPT = `Sos un experto en propuestas comerciales para licitaciones del Estado uruguayo.
Tu tarea es generar un borrador de propuesta personalizado y concreto para que
una empresa de tecnología pueda responder a una licitación pública.

La propuesta debe ser profesional, específica al llamado, y destacar las
capacidades más relevantes de la empresa para esta oportunidad particular.

Retorná ÚNICAMENTE un objeto JSON con estos campos:
- "executiveSummary": Resumen ejecutivo (2-3 párrafos)
- "valueProposition": Propuesta de valor específica para esta licitación (2 párrafos)
- "relevantCapabilities": Capacidades y experiencia relevante (lista con descripción)
- "clarificationQuestions": 3-5 preguntas de aclaración sugeridas para el organismo
- "nextSteps": Próximos pasos recomendados (lista)

Sin markdown, sin texto adicional, solo el JSON.`

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

function parseProposal(text: string): ProposalData {
  const parsed: unknown = JSON.parse(stripMarkdownFences(text))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('La respuesta de la IA no es un objeto JSON')
  }
  const obj = parsed as Record<string, unknown>
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  return {
    executiveSummary: str(obj.executiveSummary),
    valueProposition: str(obj.valueProposition),
    relevantCapabilities: str(obj.relevantCapabilities),
    clarificationQuestions: str(obj.clarificationQuestions),
    nextSteps: str(obj.nextSteps),
  }
}

function buildFullText(data: ProposalData): string {
  return [
    'Resumen ejecutivo',
    data.executiveSummary,
    '',
    'Propuesta de valor',
    data.valueProposition,
    '',
    'Capacidades relevantes',
    data.relevantCapabilities,
    '',
    'Preguntas de aclaración sugeridas',
    data.clarificationQuestions,
    '',
    'Próximos pasos',
    data.nextSteps,
  ].join('\n')
}

export async function generateProposal(opportunityId: string): Promise<ProposalData> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')
  const companyId = session.user.companyId

  // 1. Opportunity (ownership check).
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId },
  })
  if (!opportunity) throw new Error('No autorizado')

  // 2 & 3. Company config + profile.
  const company = await prisma.companyConfig.findUnique({
    where: { id: companyId },
    include: { profile: true },
  })
  if (!company) throw new Error('Empresa no encontrada')

  const profile = company.profile

  const userMessage = `Empresa: ${company.companyName}
Descripción: ${profile?.longDescription ?? company.description ?? ''}
Capacidades: ${company.capabilities.join(', ')}
Casos de éxito: ${profile?.caseStudies ?? ''}
Diferenciadores: ${profile?.differentiators ?? ''}
Instrucciones adicionales: ${profile?.proposalTemplate ?? ''}

Licitación:
- Título: ${opportunity.title}
- Organismo: ${opportunity.organismo ?? ''}
- Tipo: ${opportunity.tenderType ?? ''}
- Descripción: ${opportunity.description ?? ''}
- Resumen IA: ${opportunity.summary ?? ''}
- Ángulo comercial sugerido: ${opportunity.recommendedPlay ?? ''}`

  const callModel = async (): Promise<string> => {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  let data: ProposalData
  try {
    data = parseProposal(await callModel())
  } catch {
    // Retry once on parse failure.
    data = parseProposal(await callModel())
  }

  // 6. Upsert the proposal (one per opportunity), scoped by companyId.
  const existing = await prisma.proposal.findFirst({
    where: { opportunityId, companyId },
  })
  const fields = { ...data, fullText: buildFullText(data) }

  if (existing) {
    await prisma.proposal.update({ where: { id: existing.id }, data: fields })
  } else {
    await prisma.proposal.create({ data: { opportunityId, companyId, ...fields } })
  }

  revalidatePath(`/oportunidades/${opportunityId}`)

  return data
}

export async function saveProposal(
  opportunityId: string,
  data: ProposalData
): Promise<void> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')
  const companyId = session.user.companyId

  // Ownership check on the opportunity.
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId },
    select: { id: true },
  })
  if (!opportunity) throw new Error('No autorizado')

  const fields = { ...data, fullText: buildFullText(data) }
  const existing = await prisma.proposal.findFirst({
    where: { opportunityId, companyId },
  })

  if (existing) {
    await prisma.proposal.update({ where: { id: existing.id }, data: fields })
  } else {
    await prisma.proposal.create({ data: { opportunityId, companyId, ...fields } })
  }

  revalidatePath(`/oportunidades/${opportunityId}`)
}
