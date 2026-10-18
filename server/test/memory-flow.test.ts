import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { db, resetDatabase } from '../src/db.js';
import * as clock from '../src/clock.js';
import * as memory from '../src/modules/memory.js';
import { pipeline } from '../src/pipeline.js';
import { state } from '../src/state.js';
import type { Order } from '../src/contracts.js';

// Scene 4 on the real backend: order -> demo clock reaches deliver_on -> "did you get it?" -> dose confirm ->
// Memory -> next morning reminder -> "took it" -> stock 119. D's module does the work; this checks B's bridge.
test('scene 4: delivery ask, dose confirm, reminder and stock through the Role D bridge', async () => {
  const spoken: memory.ProactiveSpeech[] = [];
  memory.setSpeaker(e => spoken.push(e)); // bypass TTS/state for this test
  resetDatabase(); pipeline.reset(); clock.resetClock(); memory.resetMemoryModule();
  const off = memory.registerMemoryTicks();
  try {
    const order: Order = { id: 'ord_t4', product_id: 'calcium-120', price_cents: 1800, status: 'simulated_paid', block_reason: null,
      created_at: clock.now(), deliver_on: '2026-10-22', received: false };
    db.put('orders', order.id, order); memory.registerOrder(order);
    await clock.setClock('2026-10-22T09:00:00Z'); await delay(30);
    assert.equal(spoken.at(-1)?.type, 'ask'); assert.equal(spoken.at(-1)?.kind, 'received');
    assert.equal(memory.handleAnswer('Yes, got it.') !== null, true);
    assert.equal(db.get('orders', 'ord_t4')?.received, true);
    assert.equal(spoken.at(-1)?.kind, 'dose_confirm');
    assert.equal(memory.handleAnswer('Okay.') !== null, true);
    const mem = db.all('memories').find(m => m.product_id === 'calcium-120');
    assert.ok(mem); assert.equal(mem.stock_units, 120); assert.deepEqual(mem.times, ['08:00']);
    await clock.setClock('2026-10-23T08:00:05Z'); await delay(30);
    assert.equal(spoken.at(-1)?.kind, 'reminder');
    const reply = memory.handleAnswer('Took it.');
    assert.match(reply ?? '', /Recorded/);
    const after = db.get('memories', mem.id)!;
    assert.equal(after.stock_units, 119); assert.equal(after.log.at(-1)?.answer, 'taken');
    // Unrelated shopping text is not swallowed by the memory module.
    assert.equal(memory.handleAnswer('the purple bottle is almost empty'), null);
    // Clock rollback does not re-fire the reminder.
    const count = spoken.length;
    await clock.setClock('2026-10-23T07:00:00Z'); await delay(30);
    assert.equal(spoken.length, count);
  } finally { off(); state.reset(); memory.setSpeaker(() => {}); }
});
