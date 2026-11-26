// Run with: npm test (ts-node + Node's built-in test runner).

import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompanyConfig } from '@prisma/client'
import { buildUserMessage } from '../classifier'
import type { TenderItemsForMatch } from '../keywordFilter'
import type { NormalizedTender } from '../normalizer'

function tender(overrides: Partial<NormalizedTender> = {}): NormalizedTender {
  return {
    tenderId: '1388719',
    opportunityId: 'arce|1388719',
    title: 'ADQUISICIÓN ARTÍCULOS DE ALMACENES - PAPELERIA',
    description: 'Según detalle',
    url: 'https://example.test/1388719',
    publicationDate: null,
    organismo: 'Hospital Maciel',
    tenderType: 'Licitación Abreviada',
    source: 'ARCE',
    ...overrides,
  }
}

const company = {
  companyName: 'RR Etiquetas',
  capabilities: ['etiquetas autoadhesivas'],
  relevantKeywords: ['etiquetas'],
  excludedProducts: [],
} as unknown as CompanyConfig

test('a generic tender gets its real items in the prompt payload', () => {
  const items = new Map<string, TenderItemsForMatch>([
    ['1388719', { itemNames: ['ETIQUETA AUTOADHESIVA DE VINILO'], articleCodes: ['100160', '122651'] }],
  ])
  const message = buildUserMessage([tender()], company, [], items)

  assert.ok(message.includes('"items"'))
  assert.ok(message.includes('ETIQUETA AUTOADHESIVA DE VINILO'))
  assert.ok(message.includes('100160'))
})

test('a non-generic tender payload is unchanged (no items field)', () => {
  const message = buildUserMessage([tender()], company, [], new Map())
  assert.ok(!message.includes('"items"'))
})

test('the items hint is capped to ~600 chars', () => {
  const manyNames = Array.from({ length: 40 }, (_, i) => `ARTICULO LARGO NUMERO ${i} CON TEXTO`)
  const items = new Map<string, TenderItemsForMatch>([
    ['1388719', { itemNames: manyNames, articleCodes: [] }],
  ])
  const message = buildUserMessage([tender()], company, [], items)
  // Find the items value and check it is bounded.
  const match = message.match(/"items":\s*"([^"]*)"/)
  assert.ok(match)
  assert.ok((match?.[1].length ?? 0) <= 600)
})
