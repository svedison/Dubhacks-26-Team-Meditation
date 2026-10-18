// A delivery question left unanswered for over a minute must not hijack later talk: "Okay, thank you for letting me
// know" goes to Claude, a plain late "Yes" still marks the parcel received, and a second question is answered normally.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { db, resetDatabase } from '../src/db.js';
import * as clock from '../src/clock.js';
import * as memory from '../src/modules/memory.js';
import { pipeline } from '../src/pipeline.js';
import { state } from '../src/state.js';
import type { Order } from '../src/contracts.js';

test('a question past its minute takes only a short plain answer; acknowledgements and chat fall through to Claude', async () => {
  const spoken: memory.ProactiveSpeech[] = [];
  memory.setSpeaker(e => spoken.push(e));
  resetDatabase(); pipeline.reset(); clock.resetClock(); memory.resetMemoryModule();
  const off = memory.registerMemoryTicks();
  try {
    const order: Order = { id: 'ord_late', product_id: 'calcium-120', price_cents: 1800, status: 'simulated_paid', block_reason: null,
      created_at: clock.now(), deliver_on: '2026-10-22', received: false };
    db.put('orders', order.id, order); memory.registerOrder(order);
    await clock.setClock('2026-10-22T09:00:00Z'); await delay(30);
    assert.equal(spoken.at(-1)?.kind, 'received');
    await clock.setClock('2026-10-22T09:02:00Z'); await delay(30); // the minute ran out: the question is now "expired"
    assert.equal(memory.handleAnswer('Okay. Thank you so much for letting me know.'), null);
    assert.equal(memory.handleAnswer('What arrived today?'), null);
    assert.equal(memory.handleAnswer('Yes.') !== null, true);
    assert.equal(db.get('orders', order.id)?.received, true);
    assert.ok(!spoken.some(e => /product name/i.test(e.text)));
    // Nothing is waiting any more: ordinary acknowledgements are not D's business.
    assert.equal(memory.handleAnswer('Okay.'), null);
  } finally { off(); state.reset(); memory.setSpeaker(() => {}); }
});
