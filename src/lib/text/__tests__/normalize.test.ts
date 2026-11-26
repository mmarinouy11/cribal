// Run with: npm test (ts-node + Node's built-in test runner).

import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeForMatch, singularizeToken } from '../normalize'
import { filterByKeywords } from '../../pipeline/keywordFilter'
import type { NormalizedTender } from '../../pipeline/normalizer'

function tender(title: string, description = ''): NormalizedTender {
  return {
    tenderId: '1',
    opportunityId: 'arce|1',
    title,
    description,
    url: 'https://example.test/consultas/detalle/id/1',
    publicationDate: null,
    organismo: '',
    tenderType: 'Compra Directa',
    source: 'ARCE',
  }
}

test('singularizeToken drops a vowel + "s" ending, keeps short tokens', () => {
  assert.equal(singularizeToken('etiquetas'), 'etiqueta')
  assert.equal(singularizeToken('aires'), 'aire')
  assert.equal(singularizeToken('acondicionados'), 'acondicionado')
  assert.equal(singularizeToken('aire'), 'aire') // already singular
  assert.equal(singularizeToken('gas'), 'gas') // too short to stem
})

test('normalizeForMatch is diacritic- and plural-insensitive', () => {
  assert.equal(normalizeForMatch('Etiquetas Autoadhesivas'), 'etiqueta autoadhesiva')
  assert.equal(normalizeForMatch('Aires Acondicionados'), 'aire acondicionado')
  assert.equal(normalizeForMatch('bicicleta eléctrica'), 'bicicleta electrica')
})

test('plural keyword matches a singular mention in the text', () => {
  const { passed } = filterByKeywords(
    [tender('ETIQUETA AUTOADHESIVA DE VINILO')],
    ['etiquetas autoadhesivas'],
    []
  )
  assert.equal(passed.length, 1)
})

test('"aires acondicionados" matches "aire acondicionado"', () => {
  const { passed } = filterByKeywords(
    [tender('Mantenimiento de aire acondicionado central')],
    ['aires acondicionados'],
    []
  )
  assert.equal(passed.length, 1)
})

test('singular keyword matches a plural mention (symmetry)', () => {
  const { passed } = filterByKeywords(
    [tender('Compra de etiquetas para inventario')],
    ['etiqueta'],
    []
  )
  assert.equal(passed.length, 1)
})

test('precision: an unrelated keyword still does not match', () => {
  const { passed, rejected } = filterByKeywords(
    [tender('Mantenimiento de aire acondicionado central')],
    ['tornillos'],
    []
  )
  assert.equal(passed.length, 0)
  assert.equal(rejected.length, 1)
})

test('generic tender passes via item names (1787/2026 for RR Etiquetas)', () => {
  const t = tender('ADQUISICIÓN ARTÍCULOS DE ALMACENES - PAPELERIA')
  // The RSS title alone does not contain the keyword; the real object is in items.
  const itemsByTenderId = new Map([
    [t.tenderId, { itemNames: ['ETIQUETA AUTOADHESIVA DE VINILO'], articleCodes: ['100160'] }],
  ])
  const { passed } = filterByKeywords([t], ['etiquetas autoadhesivas'], [], { itemsByTenderId })
  assert.equal(passed.length, 1)
})

test('a non-generic tender (no items entry) is unaffected', () => {
  const t = tender('Servicio de catering para evento')
  const { passed } = filterByKeywords([t], ['etiquetas autoadhesivas'], [], {
    itemsByTenderId: new Map(), // non-generic → no items provided
  })
  assert.equal(passed.length, 0)
})

test('an article code in the company catalog counts as a keyword hit', () => {
  const t = tender('ADQUISICIÓN ARTÍCULOS VARIOS')
  const itemsByTenderId = new Map([
    [t.tenderId, { itemNames: ['PRODUCTO SIN PALABRAS CLAVE'], articleCodes: ['122651'] }],
  ])
  const { passed } = filterByKeywords([t], ['etiquetas'], [], {
    itemsByTenderId,
    catalogArticleIds: [122651],
  })
  assert.equal(passed.length, 1)
})
