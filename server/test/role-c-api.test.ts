import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import type { Memory, Order } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.MINIMAX_API_KEY = ''; // a developer's server/.env must not turn offline tests into real TTS calls
process.env.OPENAI_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const { pipeline } = await import('../src/pipeline.js');
const { buildServer } = await import('../src/index.js');
const { placeOrder } = await import('../src/modules/orders.js');
const risk = await import('../src/modules/risk.js');
const draft = (patch: Partial<Order> = {}): Order => ({ id: 'ord_api', product_id: 'calcium-120', price_cents: 1800,
  status: 'simulated_paid', block_reason: null, created_at: '2026-10-17T18:00:00Z', deliver_on: '2026-10-22', received: false, ...patch });
beforeEach(() => { pipeline.reset(); db.resetDatabase(); clock.resetClock(); });
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });

test('settings PATCH semantics persist every contract field and reject invalid writes atomically', async () => {
  const app = await buildServer();
  try {
    const settings = { elder_name: 'Mom', address: '42 Maple', phone: '555-0123', card_last4: '1234',
      card_owner: 'elder', monthly_baseline_cents: 12000, wake_name: 'Daisy', photos: ['https://example.com/photo.jpg'], share_level: 'minimum' };
    assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', payload: settings })).statusCode, 200);
    assert.deepEqual((await app.inject('/api/settings')).json(), settings);
    for (const patch of [{ card_last4: '1234567890123456' }, { card_owner: 'stranger' }, { monthly_baseline_cents: -1 },
      { share_level: 'all' }, { wake_name: 'a'.repeat(81) }, { card_number: 'never store PAN' }, { photos: [12] }, null]) {
      const result = await app.inject({ method: 'PUT', url: '/api/settings', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(patch) });
      assert.equal(result.statusCode, 400);
      assert.deepEqual((await app.inject('/api/settings')).json(), settings);
    }
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { share_level: 'open' } });
    assert.deepEqual((await app.inject('/api/settings')).json(), { ...settings, share_level: 'open' });
  } finally { await app.close(); }
});

test('REST and WebSocket apply changed sharing levels to the next transaction', async () => {
  const app = await buildServer(); await app.ready();
  const events: Record<string, unknown>[] = [];
  const socket = await app.injectWS('/ws?role=guardian', {}, { onInit: ws => ws.on('message', data => events.push(JSON.parse(data.toString()))) });
  const blocked = draft({ id: 'blocked', status: 'blocked', block_reason: 'scam', price_cents: 50000 });
  db.put('orders', blocked.id, blocked);
  try {
    for (const [index, level] of ['minimum', 'default', 'open'].entries()) {
      await app.inject({ method: 'PUT', url: '/api/settings', payload: { share_level: level } });
      const id = `share_${level}`;
      await placeOrder(draft({ id }));
      risk.publishOrder(blocked);
      await delay(10);
      const ledger = (await app.inject('/api/orders')).json();
      assert.equal(ledger.share_level, level);
      assert.equal(ledger.month_total_cents, level === 'minimum' ? null : (index + 1) * 1800);
      assert.deepEqual(ledger.orders.map((o: Order) => o.id), level === 'open'
        ? ['ord_00', 'blocked', 'share_minimum', 'share_default', 'share_open'] : ['blocked']);
      assert.equal(events.some(e => e.type === 'order' && e.id === id), level === 'open');
    }
    assert.equal(events.filter(e => e.type === 'order' && e.id === 'blocked').length, 3);
  } finally { const closed = once(socket, 'close'); socket.terminate(); await closed; await app.close(); }
});

test('receipt endpoint adds one pack once and rejects blocked or missing orders', async () => {
  const app = await buildServer();
  try {
    await placeOrder(draft());
    const memory: Memory = { id: 'mem_api', product_id: 'calcium-120', dose_text: 'confirmed dose', times: ['08:00'],
      start_date: '2026-10-17', end_date: null, stock_units: 2, units_per_dose: 1, paused: false, log: [] };
    db.put('memories', memory.id, memory);
    const received = await app.inject({ method: 'POST', url: '/api/orders/ord_api/received' });
    const repeated = await app.inject({ method: 'POST', url: '/api/orders/ord_api/received' });
    assert.equal(received.statusCode, 200); assert.deepEqual(received.json(), repeated.json());
    assert.equal(received.json().received, true);
    assert.deepEqual(db.get('memories', memory.id), { ...memory, stock_units: 122 });
    db.put('orders', 'blocked', draft({ id: 'blocked', status: 'blocked', block_reason: 'recall' }));
    assert.equal((await app.inject({ method: 'POST', url: '/api/orders/blocked/received' })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/api/orders/missing/received' })).statusCode, 404);
    assert.equal(db.get('orders', 'blocked')?.received, false);
    assert.equal(db.get('memories', memory.id)?.stock_units, 122);
  } finally { await app.close(); }
});

test('a fresh process recovers orders, payment references and settings from SQLite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trusttag-c-'));
  const env = { ...process.env, DB_PATH: join(directory, 'test.db') };
  const run = (code: string) => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env, encoding: 'utf8' });
  try {
    const persisted = JSON.parse(run(`
      import { placeOrder } from './src/modules/orders.ts';
      import * as db from './src/db.ts';
      await placeOrder(${JSON.stringify(draft())});
      db.saveSettings({ ...db.getSettings(), share_level: 'open' });
      console.log(JSON.stringify(db.get('kv', 'payment:ord_api')));
      db.sqlite.close();
    `));
    const recovered = JSON.parse(run(`
      import * as db from './src/db.ts';
      console.log(JSON.stringify({ order: db.get('orders','ord_api'), ref: db.get('kv','payment:ord_api'), level: db.getSettings().share_level }));
      db.sqlite.close();
    `));
    assert.deepEqual(recovered, { order: draft(), ref: persisted, level: 'open' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('localhost HTTP/WS completes refill, scam alert/note and alternative purchase', async () => {
  const originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = 'test-only';
  // Replace only the external model response; all app transports, risk checks,
  // payments, SQLite writes and D's alerts run their real implementations.
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith('https://api.anthropic.com/')) return originalFetch(input, init);
    const body = JSON.parse(String(init?.body));
    const text = body.messages.at(-1).content as string;
    const miracle = text.includes('miracle');
    // The note after a scam warning is ordinary talk; the real model classifies it as chat, not a refill.
    const chat = text.includes('call me');
    const decision = { intent: chat ? 'chat' : miracle ? 'risky_product' : 'refill', product_id: chat ? null : miracle ? 'miracle-joint' : 'calcium-120', reply: 'Please confirm.', elder_name: null };
    const events = [
      { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(decision) } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  const app = await buildServer();
  let elder: WebSocket | undefined, guardian: WebSocket | undefined;
  try {
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const wsBase = base.replace('http:', 'ws:');
    const events: Record<string, unknown>[] = [];
    guardian = new WebSocket(`${wsBase}/ws?role=guardian`);
    guardian.on('message', data => events.push(JSON.parse(data.toString())));
    await once(guardian, 'open');
    elder = new WebSocket(`${wsBase}/ws?role=elder`);
    elder.on('message', data => { if (JSON.parse(data.toString()).type === 'speak') elder!.send(JSON.stringify({ type: 'spoke' })); });
    await once(elder, 'open');
    const request = async (path: string, method: string, body: unknown) => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 200); return response.json();
    };
    const say = (text: string) => request('/api/utterance', 'POST', { text, source: 'keyboard' });
    await request('/api/settings', 'PUT', { share_level: 'open' });
    assert.equal((await say('the purple bottle is empty today')).card.product.id, 'calcium-120');
    const refill = await say('yes');
    assert.equal(refill.order.status, 'simulated_paid');
    assert.equal(db.get('orders', refill.order.id)?.price_cents, 1800);
    const scamStart = performance.now();
    elder.send(JSON.stringify({ type: 'utterance', text: 'someone called about a $500 gift card today', source: 'keyboard' }));
    for (let i = 0; i < 100 && !events.some(e => e.type === 'alert'); i++) await delay(10);
    const alert = events.find(e => e.type === 'alert');
    assert.equal(alert?.level, 'red'); assert.equal(alert?.rule, 7);
    assert.ok(performance.now() - scamStart < 2000);
    await say('Please call me');
    assert.equal(db.all('alerts')[0].grandma_note, 'Please call me');
    assert.equal(db.all('alerts').length, 1);
    assert.equal((await say('buy miracle joint pills')).card.alternative.id, 'glucosamine-usp');
    const alternative = await say('okay');
    assert.equal(alternative.order.product_id, 'glucosamine-usp');
    await delay(20);
    assert.deepEqual(events.filter(e => e.type === 'order').map(e => e.product_id), ['calcium-120', 'glucosamine-usp']);
    assert.equal(events.some(e => e.type === 'transcript' || 'ref' in e), false);
    const ledger = await (await fetch(base + '/api/orders')).json();
    assert.equal(ledger.month_total_cents, 4200);
    assert.equal(ledger.orders.length, 3);
  } finally {
    globalThis.fetch = originalFetch; process.env.ANTHROPIC_API_KEY = '';
    for (const socket of [elder, guardian]) if (socket && socket.readyState !== WebSocket.CLOSED) {
      const closed = once(socket, 'close'); socket.terminate(); await closed;
    }
    await app.close();
  }
});
