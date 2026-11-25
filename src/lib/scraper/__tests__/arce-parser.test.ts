// Run with: npm test (ts-node + Node's built-in test runner).
// Pure-parser tests over hand-written fixtures that mirror ARCE's real
// detail-page markup. No network access.

import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTenderDetail } from '../arce-parser'

/**
 * Build an active-tender item block in ARCE's real markup: a `<div
 * class="desc-item">` with a heading (number span + name + code span) and a
 * `<ul class="list-inline">` whose "Cantidad:" entry holds the real quantity.
 * `quantity` undefined omits the whole "Cantidad:" pair (quantity truly absent).
 */
function itemBlock(opts: {
  number: number
  name: string
  code: string
  quantity?: string
}): string {
  const cantidad =
    opts.quantity === undefined
      ? ''
      : `<li>Cantidad:</li><li><strong>${opts.quantity}</strong></li>`
  return `
    <div class="desc-item">
      <h3><span class="buy-item-title-small">Ítem Nº ${opts.number}</span> ${opts.name} <span class="cod-art">(Cód. Artículo ${opts.code})</span></h3>
      <ul class="list-inline">
        ${cantidad}
        <li>Variación:</li><li><strong>Sin variación</strong></li>
      </ul>
    </div>`
}

test('reads the real quantity from "Cantidad:", not the item number', () => {
  const html = `<html><body>
    ${itemBlock({ number: 1, name: 'PAPEL HIGIÉNICO', code: '13175', quantity: '500,00 UNIDAD' })}
    ${itemBlock({ number: 17, name: 'MARCADOR', code: '197', quantity: '50,00 UNIDAD' })}
  </body></html>`
  const { items } = parseTenderDetail(html)

  assert.equal(items.length, 2)
  // Before the fix this read "1 PAPEL" (item number + first word of the name).
  assert.equal(items[0].quantity, '500,00 UNIDAD')
  assert.equal(items[0].unit, 'UNIDAD')
  assert.equal(items[1].quantity, '50,00 UNIDAD')
})

test('strips the "Ítem Nº N" prefix and the code from the name', () => {
  const html = itemBlock({ number: 3, name: 'TÓNER NEGRO', code: '9001', quantity: '2,00 UNIDAD' })
  const { items } = parseTenderDetail(html)

  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'TÓNER NEGRO')
  assert.equal(items[0].itemNumber, 3)
  assert.equal(items[0].articleCode, '9001')
})

test('items sharing an article code keep their own numbers and quantities', () => {
  // Reproduces URSEA 91/2026 items 17–20 (same article, cód. 197): the buggy
  // version showed the item numbers 17,18,19,20 as the "quantity".
  const html = `<html><body>
    ${itemBlock({ number: 17, name: 'MARCADOR', code: '197', quantity: '10,00 UNIDAD' })}
    ${itemBlock({ number: 18, name: 'MARCADOR', code: '197', quantity: '20,00 UNIDAD' })}
    ${itemBlock({ number: 19, name: 'MARCADOR', code: '197', quantity: '30,00 UNIDAD' })}
    ${itemBlock({ number: 20, name: 'MARCADOR', code: '197', quantity: '40,00 UNIDAD' })}
  </body></html>`
  const { items } = parseTenderDetail(html)

  assert.deepEqual(
    items.map((i) => [i.itemNumber, i.quantity]),
    [
      [17, '10,00 UNIDAD'],
      [18, '20,00 UNIDAD'],
      [19, '30,00 UNIDAD'],
      [20, '40,00 UNIDAD'],
    ]
  )
  assert.ok(items.every((i) => i.name === 'MARCADOR'))
})

test('quantity is null when the HTML has no "Cantidad:" value', () => {
  const html = itemBlock({ number: 1, name: 'SERVICIO DE LIMPIEZA', code: '555' })
  const { items } = parseTenderDetail(html)

  assert.equal(items.length, 1)
  // Null → the detail table renders "—" instead of a fabricated value.
  assert.equal(items[0].quantity, null)
  assert.equal(items[0].unit, null)
  assert.equal(items[0].name, 'SERVICIO DE LIMPIEZA')
})
