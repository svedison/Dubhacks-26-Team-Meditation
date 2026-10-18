import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import type { Order } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.VISA_SANDBOX_PREFLIGHT = '0';
const db = await import('../src/db.js');
const { placeOrder } = await import('../src/modules/orders.js');
const { visaSandbox, VisaSandboxError } = await import('../src/modules/visa-sandbox.js');
const draft = (): Order => ({ id: 'visa_order', product_id: 'calcium-120', price_cents: 1800,
  status: 'simulated_paid', block_reason: null, created_at: '2026-10-17T18:00:00Z', deliver_on: '2026-10-22', received: false });
const evidence = { service: 'visa_pav' as const, environment: 'sandbox' as const, testFixture: true as const,
  approved: true as const, actionCode: '00' as const, checkedAt: '2026-10-18T08:10:09Z' };
beforeEach(() => { db.resetDatabase(); process.env.VISA_SANDBOX_PREFLIGHT = '1'; });
afterEach(() => { mock.restoreAll(); process.env.VISA_SANDBOX_PREFLIGHT = '0'; });
after(() => db.sqlite.close());

test('Visa denial, invalid credentials and network failure leave no successful order or reference', async () => {
  for (const code of ['account_validation_failed', 'configuration_error', 'network_error'] as const) {
    const stub = mock.method(visaSandbox, 'validateTestAccount', async () => { throw new VisaSandboxError(code); });
    await assert.rejects(placeOrder(draft()), /visa_sandbox_/);
    assert.equal(db.get('orders', 'visa_order'), undefined);
    assert.equal(db.get('kv', 'payment:visa_order'), undefined);
    stub.mock.restore();
  }
});

test('approved Visa check keeps the order simulated and retries reuse one private reference', async () => {
  let calls = 0;
  mock.method(visaSandbox, 'validateTestAccount', async () => { calls++; return evidence; });
  const [a, b] = await Promise.all([placeOrder(draft()), placeOrder(draft())]);
  assert.equal(a?.status, 'simulated_paid'); assert.deepEqual(a, b);
  const ref = db.get('kv', 'payment:visa_order'); assert.match(String(ref), /^sim_/);
  assert.deepEqual(await placeOrder(draft()), a);
  assert.equal(db.get('kv', 'payment:visa_order'), ref); assert.equal(calls, 1);
  // The order carries only the sanitised outcome of the check (2026-10-18, shown on both screens): no PAN, CVV, approval code or raw response.
  assert.deepEqual(Object.keys(a!).sort(), [...Object.keys(draft()), 'payment_check'].sort());
  assert.deepEqual(a!.payment_check, { provider: 'visa_pav', environment: 'sandbox', approved: true, action_code: '00', checked_at: evidence.checkedAt, note: null });
  assert.doesNotMatch(JSON.stringify(a), /primaryAccountNumber|approvalCode|cardCvv2Value/);
});

test('reset during a pending Visa check cannot persist an old order', async () => {
  let finish!: () => void; let entered = false;
  mock.method(visaSandbox, 'validateTestAccount', async () => {
    entered = true; await new Promise<void>(resolve => { finish = resolve; }); return evidence;
  });
  let current = true;
  const pending = placeOrder(draft(), () => current);
  assert.equal(entered, true);
  current = false; db.resetDatabase(); finish();
  assert.equal(await pending, null);
  assert.equal(db.get('orders', 'visa_order'), undefined);
  assert.equal(db.get('kv', 'payment:visa_order'), undefined);
});

test('disabled mode is offline; risky or tampered orders are rejected before any Visa request', async () => {
  let calls = 0;
  mock.method(visaSandbox, 'validateTestAccount', async () => { calls++; throw new Error('unexpected external call'); });
  for (const patch of [{ product_id: 'miracle-joint' }, { price_cents: 1 }]) {
    await assert.rejects(placeOrder({ ...draft(), ...patch }));
  }
  process.env.VISA_SANDBOX_PREFLIGHT = '0';
  assert.equal((await placeOrder(draft()))?.status, 'simulated_paid');
  assert.equal(calls, 0);
});

test('a mistyped opt-in flag cannot silently fall back to simulated success', async () => {
  process.env.VISA_SANDBOX_PREFLIGHT = 'true';
  await assert.rejects(placeOrder(draft()), /configuration_error/);
  assert.equal(db.get('orders', 'visa_order'), undefined);
});

test('failed Visa preflight clearly reports no order and a fresh offer/confirmation can recover', async () => {
  const { ConversationPipeline } = await import('../src/pipeline.js');
  const { acknowledgeSpoke } = await import('../src/bus.js');
  let calls = 0;
  mock.method(visaSandbox, 'validateTestAccount', async () => {
    if (++calls === 1) throw new VisaSandboxError('network_error');
    return evidence;
  });
  const conversation = new ConversationPipeline({
    decide: async () => ({ intent: 'refill', product_id: 'calcium-120', reply: '', elder_name: null }),
    synthesize: async () => null,
  });
  const say = async (text: string) => { const result = await conversation.handleUtterance(text, 'keyboard'); acknowledgeSpoke(); return result; };
  try {
    assert.ok((await say('I want calcium')).card);
    const failure = await say('yes');
    assert.match(failure.reply_text, /order wasn.t placed/i);
    assert.match(failure.reply_text, /ask for the item again/i);
    assert.equal(failure.order, undefined); assert.equal(db.all('orders').length, 1);
    assert.equal((await say('yes')).order, undefined); assert.equal(calls, 1);
    assert.ok((await say('I want calcium')).card);
    assert.equal((await say('yes')).order?.status, 'simulated_paid');
    assert.equal(calls, 2); assert.equal(db.all('orders').length, 2);
  } finally { conversation.reset(); }
});
test('soft mode: an approved check rides on the order; an unreachable sandbox still places the simulated order and says so', async () => {
  process.env.VISA_SANDBOX_PREFLIGHT = 'soft';
  mock.method(visaSandbox, 'validateTestAccount', async () => evidence);
  const first = await placeOrder({ ...draft(), id: 'soft-ok' });
  assert.equal(first?.status, 'simulated_paid');
  assert.deepEqual(first?.payment_check, { provider: 'visa_pav', environment: 'sandbox', approved: true, action_code: evidence.actionCode, checked_at: evidence.checkedAt, note: null });
  mock.restoreAll();
  mock.method(visaSandbox, 'validateTestAccount', async () => { throw new VisaSandboxError('network_error'); });
  const second = await placeOrder({ ...draft(), id: 'soft-down' });
  assert.equal(second?.status, 'simulated_paid');
  assert.equal(second?.payment_check?.approved, false); assert.equal(second?.payment_check?.note, 'network_error');
  assert.equal(db.all('orders').filter(o => o.id.startsWith('soft-')).length, 2);
  // Strict mode is unchanged: the same failure places nothing.
  process.env.VISA_SANDBOX_PREFLIGHT = '1';
  await assert.rejects(placeOrder({ ...draft(), id: 'strict-down' }), VisaSandboxError);
  assert.equal(db.get('orders', 'strict-down'), undefined);
});
