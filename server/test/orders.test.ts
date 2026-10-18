import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { Order } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.MINIMAX_API_KEY = ''; // a developer's server/.env must not turn offline tests into real TTS calls
process.env.OPENAI_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const risk = await import('../src/modules/risk.js');
const orders = await import('../src/modules/orders.js');
const { buildServer } = await import('../src/index.js');
const { pipeline } = await import('../src/pipeline.js');
const draft = (patch: Partial<Order> = {}): Order => ({
  id: 'ord_new', product_id: 'calcium-120', price_cents: 1800, status: 'simulated_paid', block_reason: null,
  created_at: '2026-10-17T18:00:00Z', deliver_on: '2026-10-22', received: false, ...patch,
});
beforeEach(() => { pipeline.reset(); db.resetDatabase(); clock.resetClock(); });
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });

test('same-ID concurrent and later retries preserve one order and one payment reference', async () => {
  const [a, b] = await Promise.all([orders.placeOrder(draft()), orders.placeOrder(draft())]);
  assert.deepEqual(a, b);
  const reference = db.get('kv', 'payment:ord_new');
  assert.match(String(reference), /^sim_/);
  assert.deepEqual(await orders.placeOrder(draft()), a);
  assert.equal(db.get('kv', 'payment:ord_new'), reference);
  assert.equal(db.all('orders').length, 2);
  assert.deepEqual(db.get('orders', 'ord_new'), a);
  assert.equal('ref' in a!, false);
});

test('reusing an ID with a different payment intent is rejected', async () => {
  const first = orders.placeOrder(draft());
  await assert.rejects(orders.placeOrder(draft({ product_id: 'glucosamine-usp', price_cents: 2400 })), /different/i);
  await first;
  await assert.rejects(orders.placeOrder(draft({ price_cents: 1 })), /different/i);
  assert.equal(db.get('orders', 'ord_new')?.price_cents, 1800);
});

test('database failure rolls back both order and payment reference and permits retry', async () => {
  db.sqlite.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON kv WHEN NEW.id LIKE 'payment:%' BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
  try {
    await assert.rejects(orders.placeOrder(draft()), /storage failure/);
    assert.equal(db.get('orders', 'ord_new'), undefined);
    assert.equal(db.get('kv', 'payment:ord_new'), undefined);
  } finally { db.sqlite.exec('DROP TRIGGER fail_payment'); }
  assert.equal((await orders.placeOrder(draft()))?.status, 'simulated_paid');
});

test('invalid or stale payment never persists a success', async () => {
  await assert.rejects(orders.placeOrder(draft({ price_cents: 1 })));
  let current = true;
  const pending = orders.placeOrder(draft(), () => current);
  current = false;
  assert.equal(await pending, null);
  assert.equal(await orders.placeOrder(draft(), () => false), null);
  assert.equal(db.get('orders', 'ord_new'), undefined);
  assert.equal(db.get('kv', 'payment:ord_new'), undefined);
});

test('ledger uses UTC month boundaries and excludes blocked orders from spending', () => {
  const rows = [
    draft({ id: 'in', created_at: '2026-09-30T23:30:00-07:00' }),
    draft({ id: 'out', created_at: '2026-10-01T00:30:00+14:00', price_cents: 9999 }),
    draft({ id: 'blocked', status: 'blocked', block_reason: 'recall', price_cents: 8900 }),
  ];
  for (const order of rows) db.put('orders', order.id, order);
  assert.deepEqual(risk.ledger(), { share_level: 'default', month_total_cents: 1800, orders: [rows[2]] });
  db.saveSettings({ ...db.getSettings(), share_level: 'minimum' });
  assert.deepEqual(risk.ledger(), { share_level: 'minimum', month_total_cents: null, orders: [rows[2]] });
  db.saveSettings({ ...db.getSettings(), share_level: 'open' });
  assert.equal(risk.ledger().orders.length, 4);
  assert.equal(risk.ledger().month_total_cents, 1800);
});

test('guardian gets one committed order event and none on replay or failed persistence', async () => {
  const app = await buildServer();
  await app.ready();
  db.saveSettings({ ...db.getSettings(), share_level: 'open' });
  const events: Record<string, unknown>[] = [];
  const guardian = await app.injectWS('/ws?role=guardian', {}, { onInit: socket => socket.on('message', data => events.push(JSON.parse(data.toString()))) });
  try {
    await orders.placeOrder(draft());
    await orders.placeOrder(draft());
    await delay(10);
    assert.deepEqual(events.filter(e => e.type === 'order'), [{ type: 'order', ...db.get('orders', 'ord_new') }]);
    db.sqlite.exec("CREATE TRIGGER fail_order BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'test order failure'); END");
    try { await assert.rejects(orders.placeOrder(draft({ id: 'failure' }))); }
    finally { db.sqlite.exec('DROP TRIGGER fail_order'); }
    await delay(10);
    assert.equal(events.filter(e => e.type === 'order').length, 1);
  } finally {
    const closed = once(guardian, 'close'); guardian.terminate(); await closed; await app.close();
  }
});
