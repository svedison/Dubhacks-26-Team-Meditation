import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { Decision } from '../src/llm.js';
import type { Memory, Order } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const risk = await import('../src/modules/risk.js');
const memory = await import('../src/modules/memory.js');
const { ConversationPipeline, pipeline } = await import('../src/pipeline.js');
const { acknowledgeSpoke } = await import('../src/bus.js');
const { state } = await import('../src/state.js');
const { buildServer } = await import('../src/index.js');
const { historicalOrder } = await import('../src/seed.js');
const { FALLBACK_REPLY } = await import('../src/llm.js');
const decision = (intent: Decision['intent'], product_id: string | null = null): Decision => ({ intent, product_id, reply: 'How can I help?', elder_name: null });
const fakePipeline = (result: Decision) => new ConversationPipeline({ decide: async () => result, synthesize: async () => null });
beforeEach(() => { pipeline.reset(); db.resetDatabase(); clock.resetClock(); });
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });

test('seed, risk checks, payment adapter and monthly sharing rules', async () => {
  assert.equal(db.all('products').length, 3);
  assert.equal(db.getSettings().wake_name, 'Lily');
  assert.equal(risk.check('calcium-120', '').ok, true);
  assert.equal(risk.check('glucosamine-usp', '').ok, true);
  assert.equal(risk.check('miracle-joint', '').alternative?.id, 'glucosamine-usp');
  assert.equal(risk.check('outside', '').reason, 'off_shelf');
  for (const text of ['gift card', 'wire transfer', 'someone called', 'today']) assert.equal(risk.check('calcium-120', text).reason, 'scam');
  assert.equal((await risk.pay(historicalOrder)).status, 'simulated_paid');
  assert.equal(risk.ledger().month_total_cents, 0); // September history is not October spending.
  const blocked: Order = { ...historicalOrder, id: 'blocked', created_at: clock.now(), status: 'blocked', block_reason: 'recall' };
  db.put('orders', blocked.id, blocked);
  assert.deepEqual(risk.ledger().orders, [blocked]);
  db.saveSettings({ ...db.getSettings(), share_level: 'minimum' });
  assert.equal(risk.ledger().month_total_cents, null);
  db.saveSettings({ ...db.getSettings(), share_level: 'open' });
  assert.equal(risk.ledger().orders.length, 2);
});
test('refill requires confirmation, pays once, and stores only contract order fields', async () => {
  const flow = fakePipeline(decision('refill', 'calcium-120'));
  const offer = await flow.handleUtterance('the purple bottle is almost empty', 'keyboard');
  assert.equal(offer.card?.product.id, 'calcium-120');
  assert.equal(offer.state, 'speaking'); assert.equal(db.all('orders').length, 1);
  acknowledgeSpoke(); await state.waitForSpeech();
  const result = await flow.handleUtterance('yes', 'keyboard');
  assert.equal(result.order?.status, 'simulated_paid');
  assert.equal(result.order?.deliver_on, '2026-10-22');
  assert.equal('ref' in result.order!, false);
  acknowledgeSpoke(); await state.waitForSpeech();
  await flow.handleUtterance('yes', 'keyboard');
  assert.equal(db.all('orders').length, 2);
  flow.reset();
});
test('risky alternative can be confirmed; changed risk and price require another decision', async () => {
  const flow = fakePipeline(decision('risky_product', 'miracle-joint'));
  const offer = await flow.handleUtterance('miracle joint pills', 'keyboard');
  assert.equal(offer.card?.alternative?.id, 'glucosamine-usp');
  acknowledgeSpoke(); await state.waitForSpeech();
  const result = await flow.handleUtterance('okay', 'keyboard');
  assert.equal(result.order?.product_id, 'glucosamine-usp');
  flow.reset();
  const refill = fakePipeline(decision('refill', 'calcium-120'));
  await refill.handleUtterance('calcium', 'keyboard');
  db.put('products', 'calcium-120', { ...db.get('products', 'calcium-120')!, price_cents: 2100 });
  acknowledgeSpoke(); await state.waitForSpeech();
  const changed = await refill.handleUtterance('yes', 'keyboard');
  assert.equal(changed.order, undefined); assert.match(changed.reply_text, /21.00/);
  db.put('products', 'calcium-120', { ...db.get('products', 'calcium-120')!, risk: { kind: 'recall', alternative_id: 'glucosamine-usp' } });
  acknowledgeSpoke(); await state.waitForSpeech();
  assert.equal((await refill.handleUtterance('yes', 'keyboard')).order, undefined);
  refill.reset();
});
test('scam creates a rule-7 red alert and next answer becomes grandma_note', async () => {
  const flow = fakePipeline(decision('chat'));
  const result = await flow.handleUtterance('someone called about a gift card today', 'keyboard');
  assert.match(result.reply_text, /I'll let your daughter know, okay\?/);
  assert.equal(db.all('alerts')[0].rule, 7); assert.equal(db.all('alerts')[0].level, 'red');
  acknowledgeSpoke(); await state.waitForSpeech();
  await flow.handleUtterance('Please call me after lunch', 'keyboard');
  assert.equal(db.all('alerts')[0].grandma_note, 'Please call me after lunch');
  assert.equal(db.all('orders').length, 1);
  flow.reset();
});
test('voice wake gate, empty-name onboarding, and offline fallback', async () => {
  const ignored = await pipeline.handleUtterance('the purple bottle is empty', 'voice');
  assert.equal(ignored.state, 'idle'); assert.equal(ignored.reply_text, '');
  const fallback = await pipeline.handleUtterance('Lilly hello', 'voice');
  assert.equal(fallback.reply_text, FALLBACK_REPLY); assert.equal(fallback.audio_url, null);
  pipeline.reset(); db.saveSettings({ ...db.getSettings(), wake_name: '' });
  const ask = await pipeline.handleUtterance('hello', 'voice');
  assert.match(ask.reply_text, /AI.*call me/);
  acknowledgeSpoke(); await state.waitForSpeech();
  await pipeline.handleUtterance('Call you Daisy', 'voice');
  assert.equal(db.getSettings().wake_name, 'Daisy');
});
test('reset prevents in-flight model response from creating cards or orders', async () => {
  let finish!: (value: Decision) => void;
  const flow = new ConversationPipeline({ decide: () => new Promise(resolve => { finish = resolve; }), synthesize: async () => null });
  const pending = flow.handleUtterance('buy calcium', 'keyboard');
  await delay(0); flow.reset(); db.resetDatabase();
  finish(decision('refill', 'calcium-120'));
  const result = await pending;
  assert.equal(result.state, 'idle'); assert.equal(result.card, undefined);
  assert.equal(db.all('orders').length, 1);
});
test('clock jumps use tick handlers and continue to advance; unsubscribe works', async () => {
  const ticks: string[][] = [];
  const off = clock.onTick((prev, current) => { ticks.push([prev, current]); });
  await clock.setClock('2026-10-23T08:00:00Z');
  const first = clock.now(); await delay(20);
  assert.ok(clock.now() > first); assert.equal(ticks.length, 1);
  assert.match(ticks[0][0], /^2026-10-17/); assert.match(ticks[0][1], /^2026-10-23/);
  off(); await clock.setClock('2026-10-22T08:00:00Z'); assert.equal(ticks.length, 1);
});
test('receipt adds stock once, preserving confirmed dose and reminder plan', () => {
  const order: Order = { ...historicalOrder, id: 'new', received: false };
  const mem: Memory = { id: 'mem', product_id: order.product_id, dose_text: '1 tablet with breakfast', times: ['08:00'], start_date: '2026-10-17', end_date: null, stock_units: 2, units_per_dose: 1, paused: false, log: [] };
  db.put('orders', order.id, order); db.put('memories', mem.id, mem);
  memory.markReceived(order.id); memory.markReceived(order.id);
  assert.equal(db.get('orders', order.id)?.received, true);
  assert.equal(db.get('memories', mem.id)?.stock_units, 122);
});
test('REST shapes, validation, memory edits and offline audio', async () => {
  const app = await buildServer();
  try {
    assert.equal((await app.inject('/api/products')).json().length, 3);
    const result = await app.inject({ method: 'POST', url: '/api/utterance', payload: { text: 'the purple bottle is almost empty', source: 'keyboard' } });
    assert.equal(result.statusCode, 200); assert.equal(result.json().reply_text, FALLBACK_REPLY);
    assert.equal(result.json().audio_url, null);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', payload: { share_level: 'bad' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/debug/clock', payload: { now: 'bad' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/audio', headers: { 'content-type': 'audio/webm' }, payload: Buffer.from('audio') })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/orders/missing/received' })).statusCode, 404);
    const mem: Memory = { id: 'm', product_id: 'calcium-120', dose_text: 'label', times: ['08:00'], start_date: '2026-10-22', end_date: null, stock_units: 120, units_per_dose: 1, paused: false, log: [] };
    db.put('memories', mem.id, mem);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/memories/m', payload: { paused: true } })).json().paused, true);
    assert.equal((await app.inject('/api/memories/m')).json().stock_units, 120);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/memories/m', headers: { 'content-type': 'application/json' }, payload: 'null' })).statusCode, 200);
    assert.equal((await app.inject('/api/memories')).json().length, 0);
    const alert = memory.createAlert('red', 7, 'Check on Mom', 'scam');
    assert.equal((await app.inject({ method: 'POST', url: `/api/alerts/${alert.id}/archive` })).json().ok, true);
    assert.equal((await app.inject('/api/alerts')).json()[0].archived, true);
    assert.equal((await app.inject({ method: 'POST', url: '/debug/clock', payload: { now: '2026-10-23T08:00:00Z' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/debug/reset' })).statusCode, 200);
    assert.equal((await app.inject('/api/alerts')).json().length, 0);
  } finally { await app.close(); }
});
test('WebSocket handlers: roles, playback acknowledgement, binary fallback and red notification', async () => {
  const app = await buildServer();
  await app.ready();
  const elderEvents: Record<string, unknown>[] = [], guardianEvents: Record<string, unknown>[] = [];
  const elder = await app.injectWS('/ws?role=elder', {}, { onInit: socket => socket.on('message', data => elderEvents.push(JSON.parse(data.toString()))) });
  const guardian = await app.injectWS('/ws?role=guardian', {}, { onInit: socket => socket.on('message', data => guardianEvents.push(JSON.parse(data.toString()))) });
  const until = async (predicate: () => boolean) => { for (let i = 0; i < 100 && !predicate(); i++) await delay(10); assert.ok(predicate()); };
  try {
    elder.send(Buffer.from([1, 2, 3])); // No Deepgram key: do not crash or disable text.
    elder.send(JSON.stringify({ type: 'utterance', text: 'someone called about a gift card', source: 'keyboard' }));
    await until(() => guardianEvents.some(e => e.type === 'alert'));
    assert.ok(elderEvents.some(e => e.type === 'speak' && typeof e.text === 'string'));
    assert.equal(guardianEvents.some(e => e.type === 'transcript'), false);
    guardian.send(JSON.stringify({ type: 'spoke' })); await delay(20);
    assert.equal(state.current, 'speaking');
    elder.send(JSON.stringify({ type: 'spoke' }));
    await until(() => elderEvents.some(e => e.type === 'state' && e.state === 'alert'));
    elder.send(JSON.stringify({ type: 'utterance', text: 'Okay, thank you', source: 'keyboard' }));
    await until(() => guardianEvents.some(e => e.type === 'alert' && e.grandma_note === 'Okay, thank you'));
    await app.inject({ method: 'POST', url: '/debug/clock', payload: { now: '2026-10-22T09:00:00Z' } });
    await until(() => guardianEvents.some(e => e.type === 'clock' && String(e.now).startsWith('2026-10-22')));
    risk.publishOrder(historicalOrder);
    await delay(10); assert.equal(guardianEvents.some(e => e.type === 'order'), false);
    db.saveSettings({ ...db.getSettings(), share_level: 'open' });
    risk.publishOrder(historicalOrder);
    await until(() => guardianEvents.some(e => e.type === 'order' && e.id === historicalOrder.id));
  } finally {
    const closed = [once(elder, 'close'), once(guardian, 'close')];
    // injectWS's synchronous in-memory duplex can leave ws close-handshake timers
    // alive for 30s; terminate these test transports rather than opening a handshake.
    elder.terminate(); guardian.terminate(); await Promise.all(closed); await app.close();
  }
});
