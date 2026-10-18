import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ConversationState } from '../src/state.js';
import { acknowledgeSpoke, addClient } from '../src/bus.js';
import type { ServerEvent } from '../src/contracts.js';
import type { WebSocket } from 'ws';

// awaitSpoke() only waits while an elder device is connected; register a fake open socket.
const fakeElder = { readyState: 1, send() {} } as unknown as WebSocket;

test('speaking waits for spoke, then emotion/listening and silence/idle', async () => {
  const events: ServerEvent[] = [];
  const detach = addClient(fakeElder, 'elder');
  const state = new ConversationState(event => events.push(event), 30, 300, 5);
  state.wake(); state.think(); state.speak('happy');
  await delay(40); // Silence timer must not interrupt speaking.
  assert.equal(state.current, 'speaking');
  state.listen();
  assert.equal(state.current, 'speaking');
  acknowledgeSpoke(); await state.waitForSpeech();
  assert.equal(state.current, 'happy');
  await delay(10); assert.equal(state.current, 'listening');
  await delay(40); assert.equal(state.current, 'idle');
  assert.deepEqual(events.map(e => e.type === 'state' ? e.state : ''), ['listening', 'thinking', 'speaking', 'happy', 'listening', 'idle']);
  state.reset(); detach();
});
test('playback timeout and reset invalidate old completion callbacks', async () => {
  const detach = addClient(fakeElder, 'elder');
  const state = new ConversationState(() => {}, 50, 15, 5);
  state.wake(); state.think(); state.speak('alert');
  await delay(18); assert.equal(state.current, 'alert');
  state.reset(); await delay(15); assert.equal(state.current, 'idle');
  state.wake(); state.think(); state.speak('happy'); state.reset();
  await delay(25); assert.equal(state.current, 'idle');
  detach();
});
