import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { Order, Product } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
const db = await import('../src/db.js');
const risk = await import('../src/modules/risk.js');
const { historicalOrder } = await import('../src/seed.js');
const draft = (patch: Partial<Order> = {}): Order => ({ ...historicalOrder, id: 'ord_test', received: false, status: 'simulated_paid', ...patch });
beforeEach(() => db.resetDatabase());
after(() => db.sqlite.close());

test('demo shelf checks return trusted products and the configured alternative', () => {
  assert.deepEqual(risk.check('calcium-120', 'refill'), { ok: true, reason: null });
  assert.deepEqual(risk.check('glucosamine-usp', 'refill'), { ok: true, reason: null });
  assert.deepEqual(risk.check('miracle-joint', ''), { ok: false, reason: 'fda_fraud', alternative: db.get('products', 'glucosamine-usp') });
  assert.deepEqual(risk.check('missing', ''), { ok: false, reason: 'off_shelf' });
  assert.deepEqual(risk.check(null, ''), { ok: false, reason: 'off_shelf' });
  for (const kind of ['recall', 'unverified'] as const) {
    const product: Product = { ...db.get('products', 'miracle-joint')!, risk: { kind, alternative_id: 'glucosamine-usp' } };
    db.put('products', product.id, product);
    assert.equal(risk.check(product.id, '').reason, kind);
  }
});

test('missing, risky and self-referencing alternatives are never recommended', () => {
  for (const alternative_id of ['missing', 'miracle-joint']) {
    db.put('products', 'miracle-joint', { ...db.get('products', 'miracle-joint')!, risk: { kind: 'unverified', alternative_id } });
    assert.equal(risk.check('miracle-joint', '').alternative, undefined);
  }
  db.put('products', 'glucosamine-usp', { ...db.get('products', 'glucosamine-usp')!, risk: { kind: 'recall', alternative_id: 'calcium-120' } });
  db.put('products', 'miracle-joint', { ...db.get('products', 'miracle-joint')!, risk: { kind: 'fda_fraud', alternative_id: 'glucosamine-usp' } });
  assert.equal(risk.check('miracle-joint', '').alternative, undefined);
});

test('scam language wins over catalog checks and check itself has no side effects', () => {
  for (const text of ['GIFT CARD', 'gift-card', 'ＧＩＦＴ ＣＡＲＤ', 'wire transfer', 'bank transfer', 'send money', 'someone called', 'I must buy it today', 'I have to pay today', '礼品卡', '转账', '有人打电话让我买', '今天必须买']) {
    assert.deepEqual(risk.check('calcium-120', text), { ok: false, reason: 'scam' }, text);
    assert.deepEqual(risk.check('missing', text), { ok: false, reason: 'scam' }, text);
  }
  assert.equal(db.all('alerts').length, 0);
  assert.equal(db.all('orders').length, 1);
});

test('ordinary today and telephone mentions do not block normal shopping', () => {
  for (const text of ['Buy calcium today', 'Can it arrive today?', 'I called my daughter', '今天买钙片', 'a gift for my daughter', 'I must buy calcium next week']) {
    assert.deepEqual(risk.check('calcium-120', text), { ok: true, reason: null }, text);
  }
});

test('payment returns an explicitly simulated result without writing an order', async () => {
  const result = await risk.pay(draft());
  assert.equal(result.status, 'simulated_paid');
  assert.match(result.ref, /^sim_.+/);
  assert.deepEqual(Object.keys(result).sort(), ['ref', 'status']);
  assert.equal(db.get('orders', 'ord_test'), undefined);
});

test('payment rejects unsafe products, tampered amounts and ineligible orders', async () => {
  for (const patch of [
    { product_id: 'missing' }, { product_id: 'miracle-joint', price_cents: 8900 },
    { price_cents: 1 }, { price_cents: -1 }, { price_cents: 1800.5 },
    { status: 'blocked', block_reason: 'scam' }, { block_reason: 'scam' },
    { received: true }, { id: '' }, { created_at: 'invalid' },
  ] as Partial<Order>[]) {
    await assert.rejects(risk.pay(draft(patch)), JSON.stringify(patch));
  }
  assert.equal(db.all('orders').length, 1);
});
