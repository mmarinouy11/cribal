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
