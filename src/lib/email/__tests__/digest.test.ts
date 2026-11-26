// Run with: npm test (ts-node + Node's built-in test runner).

import assert from 'node:assert/strict'
import test from 'node:test'
import { OpportunityStatus, type CompanyConfig, type Opportunity } from '@prisma/client'
import {
  buildDigestHtml,
  selectOtherTenders,
  type DigestOpportunityStatus,
} from '../digest'
import type { NormalizedTender } from '../../pipeline/normalizer'

function tender(opportunityId: string, title: string): NormalizedTender {
  return {
    tenderId: opportunityId.replace('arce|', ''),
    opportunityId,
    title,
    description: '',
    url: `https://example.test/${opportunityId}`,
    publicationDate: null,
    organismo: '',
    tenderType: 'Compra Directa',
    source: 'ARCE',
  }
}

function opportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: 'opp',
    opportunityId: 'arce|1',
    title: 'Oportunidad',
    status: OpportunityStatus.NUEVA,
    closingDate: null,
    score: 8,
    category: null,
    summary: null,
    recommendedPlay: null,
    organismo: null,
    url: 'https://example.test/1',
    ...overrides,
  } as unknown as Opportunity
}

const company = { companyName: 'RR Etiquetas' } as unknown as CompanyConfig

test('selectOtherTenders drops a discarded opportunity from "otros nuevos"', () => {
  const relevant = tender('arce|1', 'ETIQUETA AUTOADHESIVA DE VINILO')
  const discarded = tender('arce|2', 'Compra Directa adjudicada 152/2026')
  const allNewTenders = [relevant, discarded]

  const statusMap = new Map<string, DigestOpportunityStatus>([
    ['arce|2', { status: OpportunityStatus.DESCARTADA, closingDate: null }],
  ])

  const { others, dropped } = selectOtherTenders(
    allNewTenders,
    new Set(['arce|1']), // shown as relevant
    statusMap,
    new Date()
  )

  assert.equal(others.length, 0) // 0 otros nuevos
  assert.equal(dropped, 1)
})

test('selectOtherTenders keeps a classified-but-unsaved tender', () => {
  // A tender with no saved opportunity (classified not-relevant) still shows.
  const other = tender('arce|3', 'Mantenimiento general')
  const { others, dropped } = selectOtherTenders(
    [other],
    new Set(),
    new Map(),
    new Date()
  )
  assert.equal(others.length, 1)
  assert.equal(dropped, 0)
})

test('email shows only the relevant one and "Otros llamados nuevos (0)"', () => {
  const relevantOpp = opportunity({
    opportunityId: 'arce|1',
    title: 'ETIQUETA AUTOADHESIVA DE VINILO',
    status: OpportunityStatus.NUEVA,
  })

  const html = buildDigestHtml([relevantOpp], [], [], [], company, '26 de noviembre', 1)

  assert.ok(html.includes('ETIQUETA AUTOADHESIVA DE VINILO'))
  assert.ok(html.includes('Otros llamados nuevos (0)'))
  assert.ok(!html.includes('152/2026'))
})
