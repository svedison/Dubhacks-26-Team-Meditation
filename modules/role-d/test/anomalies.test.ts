import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules } from '../src/anomalies.ts';
import type { RuleContext } from '../src/anomalies.ts';
import { createRoleD, SqliteStore } from '../src/index.ts';
import type { Order, Memory } from '../src/types.ts';
const now = '2026-10-17T18:00:00.000Z';
const order = (id: string, created_at: string, price_cents = 1800, product_id = 'calcium-120'): Order =>
  ({id, created_at, price_cents, product_id, status: 'simulated_paid', block_reason: null, deliver_on: '2026-10-22', received: false});
const memory: Memory = {id: 'm', product_id: 'calcium-120', dose_text: '1 daily', times: ['08:00'], start_date: '2026-01-01', end_date: null, stock_units: 61, units_per_dose: 1, paused: false, log: []};
function context(patch: Partial<RuleContext> = {}): RuleContext {
  const store = new SqliteStore(':memory:'); const app = createRoleD({store}); const products = app.products(); store.close();
  return {now, products, orders: [order('old', '2026-09-01T12:00:00Z')], memories: [],
    candidate: order('new', now), coldStart: true, ...patch};
}
const rules = (c: RuleContext) => evaluateRules(c).map(f => f.rule);

test('rule 1 thresholds: half pack, third weekly purchase, 90 day stock; intentional stocking only exempts first two', () => {
  assert.ok(rules(context({memories: [memory]})).includes(1));
  assert.ok(!rules(context({memories: [{...memory, stock_units: 60}]})).includes(1));
  assert.ok(!rules(context({memories: [memory], intentionalStockup: true})).includes(1));
  assert.ok(rules(context({memories: [{...memory, stock_units: 90}], intentionalStockup: true})).includes(1));
  assert.ok(rules(context({orders: [order('a', '2026-10-16T12:00:00Z'), order('b', '2026-10-15T12:00:00Z')]})).includes(1));
});
test('rule 2 uses previous complete months, median and MAD, requires history and is off in demo cold start', () => {
  const orders = [order('a', '2026-07-01T12:00:00Z', 1000), order('b', '2026-08-01T12:00:00Z', 1000), order('c', '2026-09-01T12:00:00Z', 1000)];
  const c = context({orders, candidate: order('new', now, 2100), coldStart: false});
  assert.ok(rules(c).includes(2));
  assert.ok(!rules({...c, candidate: order('new', now, 2000)}).includes(2));
  assert.ok(!rules({...c, coldStart: true}).includes(2));
});
test('rule 3 detects four weekly orders against sparse baseline, with holiday suppression', () => {
  const c = context({coldStart: false, orders: [order('old', '2026-07-01T12:00:00Z'), ...[14,15,16].map(d => order(String(d), `2026-10-${d}T12:00:00Z`))]});
  assert.ok(rules(c).includes(3));
  assert.ok(!rules({...c, holidayWithin14Days: true}).includes(3));
});
test('rule 4 requires both strictly over $100 and over three times median', () => {
  assert.ok(rules(context({candidate: order('new', now, 10001)})).includes(4));
  assert.ok(!rules(context({candidate: order('new', now, 10000)})).includes(4));
  assert.ok(!rules(context({orders: [order('old', '2026-09-01T12:00:00Z', 4000)], candidate: order('new', now, 12000)})).includes(4));
  assert.ok(!rules(context({orders: [], candidate: order('new', now, 20000)})).includes(4));
});
test('rule 5 checks unfamiliar category with high price or second new weekly category', () => {
  const c = context({coldStart: false, candidate: order('new', now, 2000, 'tea')});
  assert.ok(rules(c).includes(5));
  assert.ok(!rules({...c, holidayWithin14Days: true}).includes(5));
  assert.ok(rules(context({coldStart: false, orders: [order('old', '2026-09-01T12:00:00Z'), order('soap', '2026-10-16T12:00:00Z', 650, 'soap')], candidate: order('new', now, 500, 'tea')})).includes(5));
});
test('rule 6 detects night/out-of-pattern orders only with warm baseline', () => {
  const c = context({coldStart: false, candidate: order('new', '2026-10-17T23:30:00Z'), now: '2026-10-17T23:30:00Z'});
  assert.ok(rules(c).includes(6));
  assert.ok(!rules({...c, coldStart: true}).includes(6));
});
test('rule 7 accepts C scam classification and counts second blocked attempt within 24 hours', () => {
  assert.ok(rules(context({scam: true, candidate: undefined})).includes(7));
  assert.ok(rules(context({text: 'someone called and said buy a gift card today'})).includes(7));
  assert.ok(rules(context({blockedAttempts: [{product_id: 'x', at: '2026-10-17T12:00:00Z'}, {product_id: 'x', at: now}]})).includes(7));
  assert.ok(!rules(context({blockedAttempts: [{product_id: 'x', at: '2026-10-15T12:00:00Z'}, {product_id: 'x', at: now}]})).includes(7));
});
test('rule 8 groups questions by order/date, checks denial against actual orders and consecutive wrong names', () => {
  assert.ok(rules(context({cognition: [{kind: 'order_question', orderId: 'old', at: now}, {kind: 'order_question', orderId: 'old', at: now}, {kind: 'order_question', orderId: 'old', at: now}]})).includes(8));
  assert.ok(rules(context({cognition: [{kind: 'denies_purchase', orderId: 'old', at: now}]})).includes(8));
  assert.ok(!rules(context({cognition: [{kind: 'denies_purchase', orderId: 'missing', at: now}]})).includes(8));
  assert.ok(rules(context({cognition: Array.from({length: 3}, () => ({kind: 'wrong_wake_name' as const, at: now}))})).includes(8));
  assert.ok(!rules(context({cognition: [{kind: 'wrong_wake_name', at: now}, {kind: 'correct_wake_name', at: now}, {kind: 'wrong_wake_name', at: now}]})).includes(8));
});
test('red is announced before immediate push, then original reply updates same card; events deduplicate', () => {
  const events: any[] = []; const store = new SqliteStore(':memory:');
  const app = createRoleD({store, wallNow: () => Date.parse(now), emit: (audience, e) => events.push({audience,...e})});
  const id = app.recordAnomaly({rule: 7, level: 'red', title: 'Check on Mom', body: 'Possible scam.'}, 'scam-1').id;
  assert.equal(events[0].type, 'speak'); assert.match(events[0].text, /let your daughter know/);
  assert.equal(events[1].type, 'alert'); assert.equal(events[1].grandma_note, null);
  app.handleAnswer("I don't want to explain.");
  assert.equal(events.at(-1).id, id); assert.equal(events.at(-1).grandma_note, "I don't want to explain.");
  const count = events.length;
  app.recordAnomaly({rule: 7, level: 'red', title: 'Check on Mom', body: 'Possible scam.'}, 'scam-1');
  assert.equal(events.length, count); assert.equal(app.snapshot().alerts.length, 1);
  store.close();
});
test('single yellow stays recorded; second in seven days pushes, outside window does not', () => {
  const events: any[] = []; const store = new SqliteStore(':memory:');
  const app = createRoleD({store, wallNow: () => Date.parse(now), emit: (_, e) => events.push(e)});
  const finding = {rule: 4, level: 'yellow' as const, title: 'Check on Mom', body: 'Spending pattern changed.'};
  app.recordAnomaly(finding, 'one'); assert.equal(events.length, 0);
  app.setClock('2026-10-25T18:00:00Z'); app.recordAnomaly(finding, 'two');
  assert.equal(events.filter(e => e.type === 'alert').length, 0);
  app.recordAnomaly(finding, 'three');
  assert.equal(events.filter(e => e.type === 'alert').length, 1);
  assert.equal(app.snapshot().alerts.length, 3);
  store.close();
});
