import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoleD } from '../src/index.ts';
import { SqliteStore } from '../src/store.ts';

const initial = Date.parse('2026-10-17T18:00:00Z');
function setup(store = new SqliteStore(':memory:')) {
  const events: {audience: string; event: any}[] = [];
  const app = createRoleD({store, wallNow: () => initial,
    emit: (audience, event) => events.push({audience, event})});
  app.addOrder({id: 'ord_demo', product_id: 'calcium-120', price_cents: 1800,
    status: 'simulated_paid', block_reason: null, created_at: app.now(),
    deliver_on: '2026-10-22', received: false});
  return {app, events, store};
}
function delivery(app: ReturnType<typeof createRoleD>) {
  app.setClock('2026-10-22T09:00:00Z');
  app.handleAnswer('Yes, got it.');
  app.handleAnswer('Okay.');
  return app.snapshot().memories[0];
}

test('delivery waits for actual replies and adds one pack exactly once', () => {
  const {app, events, store} = setup();
  app.setClock('2026-10-22T09:00:00Z');
  assert.equal(events.at(-1)?.event.kind, 'received');
  assert.equal(app.snapshot().orders.at(-1)?.received, false);
  app.handleAnswer('No, not yet.');
  assert.equal(app.snapshot().memories.length, 0);
  app.setClock('2026-10-23T09:00:00Z');
  app.handleAnswer('Yes, got it.');
  assert.equal(app.snapshot().orders.at(-1)?.received, true);
  assert.equal(app.snapshot().memories.length, 0);
  assert.equal(events.at(-1)?.event.kind, 'dose_confirm');
  app.receiveOrder('ord_demo');
  app.handleAnswer('Okay');
  assert.equal(app.snapshot().memories[0].stock_units, 120);
  assert.equal(app.snapshot().memories[0].start_date, '2026-10-23');
  assert.equal(app.snapshot().memories[0].end_date, null);
  app.receiveOrder('ord_demo');
  assert.equal(app.snapshot().memories[0].stock_units, 120);
  store.close();
});

test('taken debits once, skip does not; rewind cannot replay a reminder', () => {
  const {app, events, store} = setup(); delivery(app);
  app.setClock('2026-10-23T08:00:00Z');
  app.handleAnswer('Took it.');
  assert.equal(app.snapshot().memories[0].stock_units, 119);
  assert.equal(app.snapshot().memories[0].log[0].answer, 'taken');
  assert.match(events.findLast(e => e.event.type === 'speak')?.event.text, /119 days/);
  const count = events.filter(e => e.event.kind === 'reminder').length;
  app.setClock('2026-10-22T20:00:00Z');
  app.setClock('2026-10-23T08:00:00Z');
  assert.equal(events.filter(e => e.event.kind === 'reminder').length, count);
  app.setClock('2026-10-24T08:00:00Z'); app.handleAnswer("I didn't take it, skip this one.");
  assert.equal(app.snapshot().memories[0].stock_units, 119);
  assert.equal(app.snapshot().memories[0].log[1].answer, 'skipped');
  store.close();
});

test('later snoozes the same occurrence and does not change daily times', () => {
  const {app, events, store} = setup(); delivery(app);
  app.setClock('2026-10-23T08:00:00Z'); app.handleAnswer('later');
  assert.equal(app.snapshot().memories[0].stock_units, 120);
  app.setClock('2026-10-23T08:15:00Z');
  assert.equal(events.filter(e => e.event.kind === 'reminder').length, 2);
  app.handleAnswer('taken');
  assert.deepEqual(app.snapshot().memories[0].times, ['08:00']);
  assert.equal(app.snapshot().memories[0].stock_units, 119);
  assert.equal(app.snapshot().memories[0].log.length, 1);
  store.close();
});

test('timeout records unconfirmed; late correction refunds the exact original debit', () => {
  const {app, store} = setup(); const memory = delivery(app);
  app.updateMemory(memory.id, {stock_units: 0.5});
  app.setClock('2026-10-23T08:00:00Z'); app.setClock('2026-10-23T08:01:00Z');
  assert.equal(app.snapshot().memories[0].log[0].answer, 'unconfirmed');
  assert.equal(app.snapshot().memories[0].stock_units, 0);
  app.answerReminder(memory.id, '2026-10-23T08:00:00.000Z', 'skipped');
  assert.equal(app.snapshot().memories[0].stock_units, 0.5);
  app.answerReminder(memory.id, '2026-10-23T08:00:00.000Z', 'skipped');
  assert.equal(app.snapshot().memories[0].stock_units, 0.5);
  store.close();
});

test('pause and delete invalidate queued reminder answers and snoozes', () => {
  const {app, events, store} = setup(); const memory = delivery(app);
  app.setClock('2026-10-23T08:00:00Z'); app.handleAnswer('later');
  app.updateMemory(memory.id, {paused: true});
  app.setClock('2026-10-23T08:15:00Z');
  assert.equal(events.filter(e => e.event.kind === 'reminder').length, 1);
  assert.equal(app.handleAnswer('taken'), false);
  app.deleteMemory(memory.id);
  assert.equal(app.snapshot().memories.length, 0);
  store.close();
});

test('invalid settings do not mutate memory; blocked orders never add stock', () => {
  const {app, store} = setup(); const memory = delivery(app);
  const before = app.snapshot();
  for (const patch of [{times: []}, {times: ['25:00']}, {units_per_dose: 0},
    {stock_units: -1}, {start_date: '2026-02-30'}, {end_date: '2026-01-01'}]) {
    assert.throws(() => app.updateMemory(memory.id, patch));
    assert.deepEqual(app.snapshot(), before);
  }
  assert.throws(() => app.setClock('tomorrow'));
  assert.throws(() => app.setClock('2026-02-30T08:00:00Z'));
  assert.throws(() => app.setClock('2026-10-23T08:00:00'));
  app.addOrder({...before.orders[0], id: 'blocked', status: 'blocked', received: false});
  assert.throws(() => app.receiveOrder('blocked'));
  store.close();
});

test('SQLite restart preserves receipt, logs and deduplication; reset really clears them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'role-d-'));
  try {
    const first = setup(new SqliteStore(join(dir, 'state.sqlite'))); delivery(first.app);
    first.app.setClock('2026-10-23T08:00:00Z'); first.app.handleAnswer('taken'); first.store.close();
    const events: any[] = [];
    const store = new SqliteStore(join(dir, 'state.sqlite'));
    const app = createRoleD({store, wallNow: () => initial, emit: (_, e) => events.push(e)});
    app.setClock('2026-10-23T08:00:00Z');
    assert.equal(app.snapshot().memories[0].stock_units, 119);
    assert.equal(events.filter(e => e.kind === 'reminder').length, 0);
    app.reset();
    assert.equal(app.snapshot().memories.length, 0);
    assert.equal(app.snapshot().orders.length, 1);
    assert.equal(app.snapshot().alerts.length, 0);
    assert.equal(app.snapshot().settings.photos.length, 5);
    store.close();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('low stock yields one normal refill note and offers it in the next conversation', () => {
  const {app, store} = setup(); const memory = delivery(app);
  app.updateMemory(memory.id, {stock_units: 3});
  app.setClock('2026-10-23T08:00:00Z'); app.handleAnswer('taken');
  assert.equal(app.snapshot().alerts.filter(a => a.level === 'normal').length, 1);
  assert.match(app.takeRefillSuggestion() ?? '', /2 days/);
  assert.equal(app.takeRefillSuggestion(), null);
  app.tick();
  assert.equal(app.snapshot().alerts.filter(a => a.level === 'normal').length, 1);
  store.close();
});

test('catalog has 20 entries and three risk products with safe paired alternatives', () => {
  const {app, store} = setup(); const products = app.products();
  assert.ok(products.length >= 20);
  assert.equal(new Set(products.map(p => p.id)).size, products.length);
  const risks = products.filter(p => p.risk);
  assert.equal(risks.length, 3);
  for (const product of risks) assert.equal(products.find(p => p.id === product.risk!.alternative_id)?.risk, null);
  assert.equal(products.find(p => p.aliases.includes('miracle joint pills'))?.risk?.alternative_id, 'glucosamine-usp');
  assert.ok(products.find(p => p.id === app.snapshot().orders[0].product_id)?.aliases.includes('the purple bottle'));
  store.close();
});
