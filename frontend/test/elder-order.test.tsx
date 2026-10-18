import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { elderReducer, initialView } from '../src/elder/elderReducer'
import ProductCard from '../src/shared/ui/ProductCard'
import type { Order, Product } from '../src/shared/contracts'

const product: Product = { id: 'calcium-120', name: 'Calcium', price_cents: 1800, category: 'supplement', certification: 'USP', aliases: [], label_dose: null, units: 120, units_per_dose: 1, risk: null }
const order: Order = { id: 'ord_demo', product_id: product.id, price_cents: 1800, status: 'simulated_paid', block_reason: null, created_at: '2026-10-17T18:00:00Z', deliver_on: '2026-10-22', received: false }
const offer = () => elderReducer(initialView, { type: 'card', product })

test('idle chatter stays off screen, while a backend wake restores the last utterance', () => {
  const heard = elderReducer(initialView, { type: 'transcript', role: 'grandma', text: 'Milo, I need calcium' })
  expect(heard.awake).toBe(false)
  expect(heard.lines).toEqual([])
  const awake = elderReducer(heard, { type: 'state', state: 'listening' })
  expect(awake.awake).toBe(true)
  expect(awake.lines.map(line => line.text)).toEqual(['Milo, I need calcium'])
  expect(awake.heardWhileIdle).toBeNull()
})

test('a happy offer is not a completed order', () => {
  const view = elderReducer(offer(), { type: 'state', state: 'happy' })
  expect(view.card?.done).toBe(false)
})

test('only a successful matching order completes the card; the stamp says Ordered, plus the Visa line when the card was checked', () => {
  expect(elderReducer(offer(), { type: 'order', ...order, product_id: 'other' }).card?.done).toBe(false)
  expect(elderReducer(offer(), { type: 'order', ...order, status: 'blocked' }).card?.done).toBe(false)
  const view = elderReducer(offer(), { type: 'order', ...order })
  expect(view.card?.done).toBe(true)
  expect(view.card?.orderStatus).toBe('simulated_paid') // the data keeps the simulated status; the elder never reads the word
  const plain = renderToStaticMarkup(<ProductCard product={product} orderStatus={view.card?.orderStatus} paymentCheck={view.card?.paymentCheck} />)
  expect(plain).toContain('Ordered')
  expect(plain).not.toContain('Simulated')
  expect(plain).not.toContain('Visa')
  const check = { provider: 'visa_pav' as const, environment: 'sandbox' as const, approved: true, action_code: '00', checked_at: '2026-10-18T10:00:00Z', note: null }
  const checked = elderReducer(offer(), { type: 'order', ...order, payment_check: check })
  expect(checked.card?.paymentCheck?.approved).toBe(true)
  const html = renderToStaticMarkup(<ProductCard product={product} orderStatus={checked.card?.orderStatus} paymentCheck={checked.card?.paymentCheck} />)
  expect(html).toContain('Card checked with Visa')
})

test('confirmed alternative becomes the completed product, without stamping the rejected product', () => {
  const risky = { ...product, id: 'miracle-joint', risk: { kind: 'fda_fraud' as const, alternative_id: product.id } }
  const view = elderReducer(elderReducer(initialView, { type: 'card', product: risky, alternative: product }), { type: 'order', ...order })
  expect(view.card?.product.id).toBe(product.id)
  expect(view.card?.alternative).toBeUndefined()
  expect(view.card?.done).toBe(true)
})
