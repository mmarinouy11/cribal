// Run with: npm test (ts-node + Node's built-in test runner).

import assert from 'node:assert/strict'
import test from 'node:test'
import { isGenericText, parseClosingFromText } from '../generic-text'
import { parseTenderDetail } from '../../scraper/arce-parser'

// --- "generic text" detection ---------------------------------------------

test('1787/2026 RSS text is flagged as generic', () => {
  // Title names a broad umbrella ("artículos de almacenes - papelería"); the real
  // object (etiquetas autoadhesivas) is only in the detail items. The trigger-word
  // + short-description rule alone did not catch this title, so the criteria were
  // extended with generic-category words ("almacen", "papeleria").
  assert.equal(
    isGenericText('ADQUISICIÓN ARTÍCULOS DE ALMACENES - PAPELERIA', 'Según detalle'),
    true
  )
})

test('text referencing attached documentation is generic', () => {
  assert.equal(isGenericText('Adquisición de insumos', 'Ver pliego adjunto'), true)
  assert.equal(isGenericText('Compra', 'Según especificaciones técnicas del anexo'), true)
})

test('a short description is generic', () => {
  assert.equal(isGenericText('Compra', 'Varios'), true)
})

test('a specific, rich description is NOT generic (precision)', () => {
  assert.equal(
    isGenericText(
      'Servicio de limpieza integral de oficinas',
      'Contratación de servicio de limpieza integral para oficinas centrales por doce meses con personal propio y maquinaria industrial incluida'
    ),
    false
  )
})

// --- closing date parsed from RSS text (no network) ------------------------

test('parseClosingFromText reads "Recepción de ofertas hasta"', () => {
  const closed = parseClosingFromText('Objeto X. Recepción de ofertas hasta 10/01/2020 15:00hs')
  assert.ok(closed !== null)
  assert.equal(closed?.getFullYear(), 2020)
  assert.equal(parseClosingFromText('Sin fecha de cierre en el texto'), null)
})

// --- detail items of the 1787 fixture (ETIQUETA, codes 100160/122651) ------

test('detail call-view yields the real etiqueta items and article codes', () => {
  const html = `<html><body>
    <div class="desc-item">
      <h3><span class="buy-item-title-small">Ítem Nº 1</span> ETIQUETA AUTOADHESIVA DE VINILO <span class="cod-art">(Cód. Artículo 100160)</span></h3>
      <ul class="list-inline"><li>Cantidad:</li><li><strong>500,00 UNIDAD</strong></li></ul>
    </div>
    <div class="desc-item">
      <h3><span class="buy-item-title-small">Ítem Nº 2</span> ETIQUETA AUTOADHESIVA TÉRMICA <span class="cod-art">(Cód. Artículo 122651)</span></h3>
      <ul class="list-inline"><li>Cantidad:</li><li><strong>200,00 UNIDAD</strong></li></ul>
    </div>
  </body></html>`
  const items = parseTenderDetail(html).items
  const codes = items.map((i) => i.articleCode)
  assert.deepEqual(codes, ['100160', '122651'])
  assert.ok(items.every((i) => i.name.startsWith('ETIQUETA AUTOADHESIVA')))
})
