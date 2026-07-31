'use server'

import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'
import { NicheStatus } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `Sos un analista de oportunidades de negocio en compras públicas de Uruguay.

Recibís un "nicho": un organismo que intentó contratar algo y falló
repetidamente, sea porque nadie se presentó o porque todas las ofertas fueron
rechazadas.

Respondé en español, máximo 350 palabras, con estas secciones:

**Por qué falló** — hipótesis concretas: requisitos técnicos excesivos, plazo
inviable, tope de precio por debajo de mercado, garantías desproporcionadas,
ausencia de proveedores locales capacitados.

**Encaje con la empresa** — si las capacidades actuales cubren la necesidad, y
qué le faltaría. Si el nicho está fuera del rubro actual, evaluá honestamente
si vale la pena el esfuerzo de entrada.

**Cómo entrar** — pasos concretos: pedir aclaraciones antes del próximo llamado,
proponer un alcance alternativo, aliarse con otro proveedor, contacto directo
con el organismo, incorporar una capacidad específica.

**Probabilidad de re-llamado** — Alta / Media / Baja, justificada por la
recurrencia y la fecha del último fallo.

Sé directo. Si el nicho no es atacable, decilo.`

function formatDate(date: Date | null): string {
  if (!date) return 'sin fecha'
  return new Intl.DateTimeFormat('es-UY', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    date
  )
}

/**
 * Generate an on-demand AI analysis for a niche and persist it. Always
 * company-scoped: a user can only analyze niches owned by their company.
 */
export async function analyzeNiche(
  nicheId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth()
  if (!session) return { success: false, error: 'No autorizado' }
  const companyId = session.user.companyId

  const niche = await prisma.niche.findFirst({
    where: { id: nicheId, companyId },
    include: { failures: { orderBy: { publicationDate: 'asc' } } },
  })
  if (!niche) return { success: false, error: 'No autorizado' }

  const [company, profile] = await Promise.all([
    prisma.companyConfig.findUnique({ where: { id: companyId } }),
    prisma.companyProfile.findUnique({ where: { companyId } }),
  ])
  if (!company) return { success: false, error: 'Empresa no encontrada' }

  const failuresContext = niche.failures.map((failure) => ({
    titulo: failure.title,
    descripcion: failure.description ?? '',
    tipoFallo: failure.failureType === 'DESIERTA' ? 'Desierta' : 'Ofertas rechazadas',
    fecha: formatDate(failure.publicationDate),
  }))

  const userMessage = `Empresa: ${company.companyName}
Descripción: ${company.description ?? ''}
Capacidades actuales: ${company.capabilities.join(', ')}
${profile?.longDescription ? `Descripción extendida: ${profile.longDescription}` : ''}
${profile?.differentiators ? `Diferenciadores: ${profile.differentiators}` : ''}
${profile?.certifications ? `Certificaciones: ${profile.certifications}` : ''}
${profile?.caseStudies ? `Casos de éxito: ${profile.caseStudies}` : ''}

Nicho:
- Organismo: ${niche.organismo}
- Ítem / objeto: ${niche.label}${niche.articleCode ? ` (Cód. Artículo ${niche.articleCode})` : ''}
- Categoría de encaje: ${niche.category}${niche.missingCapability ? ` — le faltaría: ${niche.missingCapability}` : ''}
- Cantidad de fallos: ${niche.failureCount} (${niche.desiertaCount} desierta(s), ${niche.rechazadaCount} con ofertas rechazadas)
- Primer fallo: ${formatDate(niche.firstFailureAt)} · Último fallo: ${formatDate(niche.lastFailureAt)}

Llamados fallidos:
${JSON.stringify(failuresContext, null, 2)}`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    const analysis = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    if (!analysis) return { success: false, error: 'La IA no devolvió análisis' }

    await prisma.niche.update({
      where: { id: niche.id },
      data: { aiAnalysis: analysis, analyzedAt: new Date() },
    })
    revalidatePath(`/nichos/${nicheId}`)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][NICHOS] Error analizando nicho ${nicheId}: ${message}`)
    return { success: false, error: 'No se pudo completar el análisis del nicho' }
  }
}

/** Update a niche's status. Company-scoped. */
export async function updateNicheStatus(nicheId: string, status: NicheStatus): Promise<void> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')

  const result = await prisma.niche.updateMany({
    where: { id: nicheId, companyId: session.user.companyId },
    data: { status },
  })
  if (result.count === 0) throw new Error('No autorizado')
  revalidatePath('/nichos')
  revalidatePath(`/nichos/${nicheId}`)
}

/** Update a niche's notes. Company-scoped. */
export async function updateNicheNotes(nicheId: string, notes: string): Promise<void> {
  const session = await auth()
  if (!session) throw new Error('No autorizado')

  const result = await prisma.niche.updateMany({
    where: { id: nicheId, companyId: session.user.companyId },
    data: { notes: notes.trim() || null },
  })
  if (result.count === 0) throw new Error('No autorizado')
  revalidatePath(`/nichos/${nicheId}`)
}
