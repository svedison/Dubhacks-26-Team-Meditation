// The demo clock reads as Seattle wall time: boot and reset start at Seattle's current clock face (as pseudo-UTC digits),
// tests and a pinned deployment start where DEMO_CLOCK_START says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { now, resetClock, seattleWallNow, startingPoint } from '../src/clock.js';
import { DEMO_START } from '../src/seed.js';

test('seattleWallNow turns an instant into the Seattle clock face, PDT in October and PST in January', () => {
  assert.equal(seattleWallNow(Date.UTC(2026, 9, 18, 13, 29, 53, 498)), Date.UTC(2026, 9, 18, 6, 29, 53, 498)); // 06:29 PDT
  assert.equal(seattleWallNow(Date.UTC(2026, 9, 18, 3, 0, 0)), Date.UTC(2026, 9, 17, 20, 0, 0)); // still Saturday evening in Seattle
  assert.equal(seattleWallNow(Date.UTC(2026, 0, 15, 12, 0, 0)), Date.UTC(2026, 0, 15, 4, 0, 0)); // 04:00 PST
});
test('the clock starts pinned under npm test and at Seattle now when nothing pins it', () => {
  assert.equal(startingPoint(), Date.parse(DEMO_START));
  resetClock(); assert.match(now(), /^2026-10-17T18:00:0/);
  const pinned = process.env.DEMO_CLOCK_START, context = process.env.NODE_TEST_CONTEXT;
  delete process.env.DEMO_CLOCK_START; delete process.env.NODE_TEST_CONTEXT;
  try {
    const before = seattleWallNow(); const start = startingPoint(); const after = seattleWallNow();
    assert.ok(start >= before && start <= after);
    process.env.DEMO_CLOCK_START = '2026-10-22T09:00:00Z';
    assert.equal(startingPoint(), Date.parse('2026-10-22T09:00:00Z'));
    process.env.DEMO_CLOCK_START = 'not a date'; delete process.env.NODE_TEST_CONTEXT;
    assert.ok(Math.abs(startingPoint() - seattleWallNow()) < 1_000); // an unreadable pin is ignored, not fatal
  } finally {
    if (pinned === undefined) delete process.env.DEMO_CLOCK_START; else process.env.DEMO_CLOCK_START = pinned;
    if (context === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = context;
    resetClock();
  }
});
