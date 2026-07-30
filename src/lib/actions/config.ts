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

El sistema de ARCE organiza las licitaciones en una jerarquía de 4 niveles: Familia → Subfamilia → Clase → Subclase.
Los feeds RSS pueden filtrarse por familia y subfamilia usando estas URLs:
- Por familia: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/{id_familia}
- Por subfamilia: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/familia/{id_familia}/subfamilia/{id_subfamilia}
- Por texto libre: https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/texto/{término_sin_espacios}

CATÁLOGO COMPLETO DE ARCE:

FAMILIA 2 — MATERIALES Y SUMINISTROS
  Subfamilia 1: Alimentos y productos agropecuarios, forestales y marítimos
    Clases: Alimentos origen agropecuario, Alimentos manufacturados y bebidas, Semillas, Plantas
  Subfamilia 2: Minerales (gravilla, arena, piedra, arcilla, petróleo)
  Subfamilia 3: Productos textiles, vestir y cuero (telas, prendas, calzado)
  Subfamilia 4: Productos de papel, libros impresos y digitales
  Subfamilia 5: Productos energéticos (combustibles, electricidad, gas)
  Subfamilia 6: Productos químicos (caucho, lubricantes, insecticidas, pinturas, plásticos, explosivos)
  Subfamilia 7: Productos minerales no metálicos y de madera (cerámica, vidrio, cemento, madera)
  Subfamilia 8: Productos metálicos (hierro, acero, herramientas, estructuras)
  Subfamilia 9: Otros materiales y suministros
    Clases: Útiles de oficina, Útiles de limpieza, Útiles eléctricos, Útiles médico-quirúrgicos,
            Útiles deportivos, Útiles de cocina, Útiles educacionales, Equipos de protección personal,
            Instrumentos de medida, Elementos contra incendio, Artículos de ferretería
  Subfamilia 10: Productos de uso marino (accesorios náuticos, buceo)
  Subfamilia 12: Repuestos y accesorios
    Clases:
      Clase 1: Para máquinas y equipos de transporte
        Subclases: Repuestos de chasis, frenos, motor, transmisión, sistema eléctrico,
                   Repuestos para bicicletas (18), Repuestos para motos (20), Repuestos para aeronaves (17)
      Clase 2: Para máquinas y equipos de oficina (fotocopiadoras, informatica, aire acondicionado)
      Clase 3: Para máquinas y equipos de producción (industriales, gastronómicos)
      Clase 4: Otros repuestos y accesorios
      Clase 5: Para equipos médicos, sanitarios, odontológicos, científicos
  Subfamilia 13: Medicamentos y antisépticos uso humano (fármacos, vacunas, oncológicos)

FAMILIA 3 — SERVICIOS NO PERSONALES
  Subfamilia 1: Servicios básicos (telefonía, correo, agua, gas, electricidad)
  Subfamilia 2: Publicidad, impresiones y encuadernaciones
  Subfamilia 3: Pasajes, viáticos y gastos de traslado
  Subfamilia 4: Transporte y almacenaje (mudanzas, fletes, almacenaje)
  Subfamilia 5: Arrendamientos (inmuebles, equipos, vehículos, software)
  Subfamilia 6: Tributos, multas, seguros y comisiones
  Subfamilia 7: Servicios de mantenimiento y reparaciones menores
    Clases: Inmuebles, Instalaciones eléctricas/sanitarias, Maquinaria industrial,
            Equipos de oficina, Vehículos, Espacios verdes, Instrumentos musicales
  Subfamilia 8: Servicios profesionales contratados
    Clases:
      Clase 2: Servicios médicos (análisis, cirugía, imagenología, odontología)
      Clase 9: Otros servicios profesionales (capacitación, investigación, diseño, asesoramiento,
               consultoría, veterinaria, guías de turismo, cálculo y diseño)
  Subfamilia 9: Otros servicios contratados
    Clases:
      Clase 1: Servicios de limpieza (barrido, locales, lavado, fumigación, esterilización)
      Clase 2: Servicios de vigilancia (policía, vigilancia privada, bomberos)
      Clase 4: Servicios de instalación (equipos electrónicos, seguridad, calefacción)
      Clase 9: Otros servicios (gastronomía, hospedaje, turismo, espectáculos, traducción,
               producción TV/radio, control de plagas, confección, carpintería)
  Subfamilia 10: Servicios de Tecnologías de la Información y Comunicación (TIC)
    Clase 1 — Servicios TIC contratados:
      Ingeniería de software (1), Soporte técnico informático (2), Seguridad de información (3),
      Manipulación de datos (4), Aplicaciones web (5), Ingeniería electrónica y telecomunicaciones (6),
      Infraestructura tecnológica (7), Gerenciamiento de proyectos TIC (8), Servicios de nube (9)
    Clase 2 — Servicios TIC ofrecidos:
      Usuarios internos (1), Usuarios externos (2), Comunicaciones (3), Soporte aplicaciones (4),
      Alojamiento/hosting (5), Centros de datos (6), Seguridad informática (7), Gestión proyectos (8)

FAMILIA 4 — MAQUINARIA Y EQUIPOS
  Subfamilia 1: Maquinaria y equipos de producción (industrial, agrícola, construcción, energía)
  Subfamilia 2: Máquinas y equipos de oficina (fotocopiadoras, electrodomésticos, seguridad física)
  Subfamilia 3: Equipos médicos, sanitarios, odontológicos y científicos
  Subfamilia 4: Equipos educacionales, culturales y recreativos (audio, video, fotografía, deportivos)
  Subfamilia 5: Equipos de transporte
    Clases: Automóviles, Camionetas, Ómnibus, Vehículos pesados,
            Ciclomotores y bicicletas (5), Embarcaciones (7), Aeronaves (10)
  Subfamilia 6: Equipos de comunicaciones excepto telefonía (radiocomunicación, señalización vial)
  Subfamilia 7: Motores y partes para reemplazo
  Subfamilia 8: Mobiliario (madera, metal, hospitalario, urbano)
  Subfamilia 9: Otras máquinas, equipos y mobiliarios nuevos

FAMILIA 5 — BIENES DE USO EXISTENTES (compra de activos usados)
  Tierras, edificios, maquinaria existente, semovientes (bovinos, ovinos, equinos), activos financieros

FAMILIA 6 — OBRAS DE CONSTRUCCIÓN E INFRAESTRUCTURA
  Subfamilia 1: Vías de comunicación (carreteras, calles, puentes, vías férreas)
  Subfamilia 2: Edificaciones (oficinas, vivienda, salud, enseñanza, otros)
  Subfamilia 3: Obras hidráulicas, hidroeléctricas, eléctricas y sanitarias (alcantarillado, saneamiento)
  Subfamilia 4: Obras urbanísticas (parques, plazas, monumentos, canchas)
  Subfamilia 5: Instalaciones de transmisión y distribución (iluminación, gasoductos, telefonía)
  Subfamilia 6: Mejoras de tierras y plantaciones (forestación, riego)
  Subfamilia 8: Reparaciones mayores y extraordinarias (reciclaje inmuebles, demoliciones)
  Subfamilia 9: Instalación de servicios locales (industrial, domiciliaria, comunicaciones)

FAMILIA 10 — INFRAESTRUCTURA TECNOLÓGICA (hardware e insumos TIC)
  Subfamilia 43: Infraestructura tecnológica
    Clase 19: Dispositivos de comunicaciones
    Clase 20: Dispositivos TI y telecomunicaciones (almacenamiento, interfaces)
    Clase 21: Equipos informáticos (computadoras, periféricos, impresoras, insumos)
    Clase 22: Equipos de redes (telefonía, seguridad de red, servicios de red)
    Clase 23: Software de base y aplicaciones
      Subclases: Software de gestión (15), planificación/contabilidad (16), desarrollo (24),
                 aplicaciones específicas (26), seguridad (32), entorno operativo (30), licencias (36)
    Clase 24: Sistemas de información (bases de datos, soporte electrónico)

FAMILIA 12 — PRODUCTOS EXCLUSIVOS ENTES (UTE, ANCAP, ANTEL)
  Solo para empresas que proveen a UTE (electricidad), ANCAP (combustibles) o ANTEL (telecomunicaciones)

NOTAS IMPORTANTES:
- Familia 3 subfamilia 10 = servicios TIC (desarrollo software, soporte, cloud) → para empresas de TI
- Familia 10 subfamilia 43 = hardware TIC (computadoras, licencias) → para resellers/distribuidores TIC
- Familia 3 subfamilia 9 clase 1 = limpieza → para empresas de limpieza
- Familia 3 subfamilia 8 = servicios profesionales → para consultoras, médicos, diseñadores
- Familia 6 = obras → para constructoras, ingeniería civil
- Familia 2 subfamilia 12 clase 1 subclase 18 = repuestos bicicletas → muy específico
- Familia 4 subfamilia 5 clase 5 = bicicletas (compra de vehículos nuevos)
- Familia 3 subfamilia 7 = mantenimiento y reparaciones → para empresas de servicio técnico
- Familia 2 subfamilia 1 = alimentos → para proveedores de alimentos al Estado
- Si la empresa está en un rubro muy específico, preferir subfamilia sobre familia completa

Respondé ÚNICAMENTE con un objeto JSON válido, sin markdown, sin texto adicional:
{
  "relevantKeywords": string[],     // 10-20 términos en español específicos para este rubro
  "excludedKeywords": string[],     // 5-15 términos que claramente NO aplican
  "excludedProducts": string[],     // 0-5 marcas/productos específicos a excluir (puede ser [])
  "rssFeeds": string[],             // 1-5 URLs de feeds (familia o subfamilia según especificidad)
  "minimumScore": number,           // Entre 6 y 8
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
  if (data.lookbackDays !== undefined) {
    // Cadence is limited to 1-7 days.
    updateData.lookbackDays = Math.min(7, Math.max(1, Math.round(data.lookbackDays)))
  }
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
