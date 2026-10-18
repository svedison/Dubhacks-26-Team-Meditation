// The presenter's remote: a browser tab can move the demo clock to the delivery day, to the next dose or back to
// Seattle now, each computed from the data on screen, behind the same debug token as the POST.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { Memory, Order } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.MINIMAX_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
process.env.DEBUG_TOKEN = 'demo-token';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const { buildServer } = await import('../src/index.js');
const { pipeline } = await import('../src/pipeline.js');

const app = await buildServer();
after(async () => { await app.close(); pipeline.reset(); clock.resetClock(); db.sqlite.close(); delete process.env.DEBUG_TOKEN; });
const jump = (query: string) => app.inject({ method: 'GET', url: `/debug/clock?${query}&token=demo-token` });

test('the remote page and the GET jumps sit behind the debug token', async () => {
  assert.equal((await app.inject('/debug/remote')).statusCode, 401);
  const page = await app.inject('/debug/remote?token=demo-token');
  assert.equal(page.statusCode, 200); assert.match(page.headers['content-type'] as string, /text\/html/);
  assert.match(page.body, /to=delivery|data-to="delivery"/); assert.match(page.body, /next-reminder/);
  assert.equal((await app.inject('/debug/clock?to=delivery')).statusCode, 401);
  assert.equal((await jump('')).statusCode, 400);
});
test('delivery day comes from the earliest order still on its way; the next dose from the Memory schedule', async () => {
  db.resetDatabase(); clock.resetClock(); // 2026-10-17 18:00; the seed holds one order, already received
  assert.equal((await jump('to=delivery')).statusCode, 409);
  const order: Order = { id: 'ord_t', product_id: 'calcium-120', price_cents: 1800, status: 'simulated_paid', block_reason: null,
    created_at: clock.now(), deliver_on: '2026-10-22', received: false };
  db.put('orders', order.id, order);
  db.put('orders', 'ord_later', { ...order, id: 'ord_later', deliver_on: '2026-10-25' });
  const delivery = await jump('to=delivery');
  assert.equal(delivery.statusCode, 200); assert.equal(delivery.json().now, '2026-10-22T09:00:00.000Z');
  assert.match((await app.inject('/api/health')).json().now, /^2026-10-22T09:00:0/);
  // No Memory yet: tomorrow at 8, five seconds in so D's reminder is due but not missed.
  assert.equal((await jump('to=next-reminder')).json().now, '2026-10-23T08:00:05.000Z');
  const memory: Memory = { id: 'mem_t', product_id: 'calcium-120', dose_text: '1 tablet daily with food', times: ['20:00'], start_date: '2026-10-23',
    end_date: null, stock_units: 120, units_per_dose: 1, paused: false, log: [] };
  db.put('memories', memory.id, memory);
  assert.equal((await jump('to=next-reminder')).json().now, '2026-10-23T20:00:05.000Z'); // start_date rules out tonight
  assert.equal((await jump('now=2026-10-24T08:00:00Z')).json().now, '2026-10-24T08:00:00.000Z');
  const back = await jump('to=seattle');
  assert.equal(back.statusCode, 200);
  assert.ok(Math.abs(Date.parse(back.json().now) - clock.seattleWallNow()) < 2_000);
});
