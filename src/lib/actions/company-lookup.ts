'use server'

import Anthropic from '@anthropic-ai/sdk'

export interface CompanyLookupResult {
  description: string
  capabilities: string
  found: boolean
}

const EMPTY_RESULT: CompanyLookupResult = {
  description: '',
  capabilities: '',
  found: false,
}

const SYSTEM_PROMPT = `Sos un asistente que busca información sobre empresas para pre-completar un formulario de registro.

Dado el nombre y país de una empresa, buscá información pública sobre ella y retorná:
1. Una descripción breve (2-3 oraciones) sobre a qué se dedica
2. Sus principales productos, capacidades o servicios (lista en texto corrido)

Si no encontrás información suficiente, retorná descripciones genéricas basadas en el nombre.

Respondé SOLO con un objeto JSON válido:
{
  "description": "descripción de la empresa en español",
  "capabilities": "productos, capacidades o servicios principales en español",
  "found": true/false
}

Sin markdown, sin texto adicional.`

/**
 * Look up public information about a company using Claude with web search, to
 * pre-fill the registration form. Session-free (runs before auth). Always
 * resolves — on any error or invalid JSON it returns an empty, not-found result.
 */
export async function lookupCompany(
  companyName: string,
  country: string
): Promise<CompanyLookupResult> {
  try {
    const client = new Anthropic()

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Empresa: ${companyName}\nPaís: ${country}\n\nBuscá información sobre esta empresa y completá el formulario.`,
        },
      ],
    })

    // The response may include web-search tool-use blocks; take the last text block.
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    )
    const textBlock = textBlocks[textBlocks.length - 1]
    if (!textBlock) return EMPTY_RESULT

    const clean = textBlock.text.replace(/```json|```/g, '').trim()
    const parsed: unknown = JSON.parse(clean)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_RESULT

    const obj = parsed as Record<string, unknown>
    return {
      description: typeof obj.description === 'string' ? obj.description : '',
      capabilities: typeof obj.capabilities === 'string' ? obj.capabilities : '',
      found: typeof obj.found === 'boolean' ? obj.found : false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[CRIBAL][LOOKUP] Error buscando "${companyName}": ${message}`)
    return EMPTY_RESULT
  }
}
