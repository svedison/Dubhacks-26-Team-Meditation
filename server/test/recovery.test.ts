// The 2026-10-18 live incident: one voice turn sat in `thinking` for ever and every later utterance queued behind it.
// These tests pin the recovery rules: a turn always ends, the queue always moves on, a sentence the elder is still
// saying is answered once as a whole, and /debug stays reachable when the token is pasted with stray whitespace.
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { WebSocket } from 'ws';
import type { Decision } from '../src/llm.js';
import type { ServerEvent } from '../src/contracts.js';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.MINIMAX_API_KEY = '';
process.env.DEEPGRAM_API_KEY = '';
const db = await import('../src/db.js');
const clock = await import('../src/clock.js');
const { ConversationPipeline, pipeline } = await import('../src/pipeline.js');
const { acknowledgeSpoke, addClient } = await import('../src/bus.js');
const { state } = await import('../src/state.js');
const { buildServer } = await import('../src/index.js');
const { createLiveTranscriber } = await import('../src/stt.js');
const { FALLBACK_REPLY } = await import('../src/llm.js');

const chat = (reply = 'How can I help?'): Decision => ({ intent: 'chat', product_id: null, reply, elder_name: null });
const events: ServerEvent[] = [];
// A connected elder device: awaitSpoke() then really waits for `spoke`, as on the iPad.
const elder = { readyState: 1, send(json: string) { events.push(JSON.parse(json) as ServerEvent); } } as unknown as WebSocket;
let detach = () => {};
beforeEach(() => { pipeline.reset(); db.resetDatabase(); clock.resetClock(); events.length = 0; detach = addClient(elder, 'elder'); });
afterEach(() => { detach(); });
after(() => { pipeline.reset(); clock.stopClock(); db.sqlite.close(); });
const states = () => events.flatMap(e => e.type === 'state' ? [e.state] : []);
const never = () => new Promise<Decision>(() => {});

test('a Claude call that never returns is abandoned after the step timeout; the turn ends with the spoken fallback', async () => {
  const flow = new ConversationPipeline({ decide: never, synthesize: async () => null }, { step: 60, stage: 5_000 });
  const started = Date.now();
  const result = await flow.handleUtterance('I want to buy something to eat, I', 'keyboard');
  assert.ok(Date.now() - started < 1_000);
  assert.equal(result.reply_text, FALLBACK_REPLY);
  assert.equal(state.current, 'worried');
  acknowledgeSpoke(); await state.waitForSpeech();
  assert.equal(state.current, 'listening');
  assert.deepEqual(states(), ['listening', 'thinking', 'worried', 'listening']);
  // The queue is free: the next sentence is handled, not stuck behind the dead turn.
  const next = await flow.handleUtterance('feeling a little bit of a headache', 'keyboard');
  assert.equal(next.reply_text, FALLBACK_REPLY);
  flow.reset();
});
test('a turn that stalls anywhere else is released by the stage watchdog and the elder hears the fallback', async () => {
  // A dependency that hangs and ignores the step guard models an unforeseen stall between stages.
  const flow = new ConversationPipeline({ decide: never, synthesize: async () => null }, { step: 60_000, stage: 120 });
  const result = await flow.handleUtterance('buy calcium', 'keyboard');
  assert.equal(result.reply_text, FALLBACK_REPLY);
  assert.equal(state.current, 'worried');
  assert.equal(flow.status().turn, null);
  acknowledgeSpoke(); await state.waitForSpeech();
  assert.equal(state.current, 'listening');
  const after = await flow.handleUtterance('hello', 'keyboard');
  assert.equal(after.reply_text, FALLBACK_REPLY);
  flow.reset();
});
test('a TTS call that never returns does not block the speak event', async () => {
  const flow = new ConversationPipeline({ decide: async () => chat('Sure.'), synthesize: () => new Promise(() => {}) }, { step: 60 });
  const result = await flow.handleUtterance('hello', 'keyboard');
  assert.equal(result.reply_text, 'Sure.'); assert.equal(result.audio_url, null);
  assert.ok(events.some(e => e.type === 'speak' && e.text === 'Sure.' && e.audio_url === null));
  flow.reset();
});
test('the rest of a sentence arriving while Claude is still thinking replaces the turn: one joined request, one answer', async () => {
  const calls: { text: string; aborted: boolean }[] = [];
  const flow = new ConversationPipeline({
    decide: (text, _context, signal) => new Promise(resolve => {
      const call = { text, aborted: false }; calls.push(call);
      signal?.addEventListener('abort', () => { call.aborted = true; });
      setTimeout(() => resolve(chat()), 80);
    }),
    synthesize: async () => null,
  });
  const first = flow.handleUtterance('Milo, I want to buy something to eat, I', 'voice');
  await delay(20); // the first half is with Claude
  const second = flow.handleUtterance('feeling a little bit of a headache.', 'voice');
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.reply_text, ''); // folded into the second turn
  assert.equal(r2.reply_text, 'How can I help?');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].aborted, true);
  assert.equal(calls[1].text, 'Milo, I want to buy something to eat, I feeling a little bit of a headache.');
  const captions = events.flatMap(e => e.type === 'transcript' && e.role === 'grandma' ? [e.text] : []);
  assert.deepEqual(captions, ['Milo, I want to buy something to eat, I', 'feeling a little bit of a headache.']);
  assert.equal(events.filter(e => e.type === 'speak').length, 1);
  assert.equal(flow.status().turn, null);
  flow.reset();
});
test('while the mic still reports speech, Claude is not asked about half a sentence', async () => {
  const calls: string[] = [];
  const flow = new ConversationPipeline({ decide: async text => { calls.push(text); return chat(); }, synthesize: async () => null }, { hold: 2_000 });
  flow.noteMic('speech'); // chunks are still arriving: the elder has not finished
  const first = flow.handleUtterance('Milo, the purple bottle', 'voice');
  await delay(60);
  assert.equal(calls.length, 0); assert.equal(flow.status().turn?.stage, 'holding');
  flow.noteMic('end'); // she stopped; Deepgram's final for the rest follows
  const second = flow.handleUtterance('is almost empty.', 'voice');
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.reply_text, ''); assert.equal(r2.reply_text, 'How can I help?');
  assert.deepEqual(calls, ['Milo, the purple bottle is almost empty.']);
  flow.reset();
});
test('after the answer is spoken, the next voice utterance is a new turn; keyboard text never joins', async () => {
  const calls: string[] = [];
  const flow = new ConversationPipeline({ decide: async text => { calls.push(text); return chat(); }, synthesize: async () => null });
  await flow.handleUtterance('Milo, hello there', 'voice');
  assert.equal(state.current, 'happy'); // playing; the window reopens on spoke
  const next = flow.handleUtterance('what is the weather', 'voice');
  await delay(20);
  acknowledgeSpoke(); // device finished playing
  await next;
  assert.deepEqual(calls, ['Milo, hello there', 'what is the weather']);
  acknowledgeSpoke(); await state.waitForSpeech();
  const typed = flow.handleUtterance('calcium please', 'keyboard');
  await delay(0);
  const spoken = flow.handleUtterance('and vitamin d', 'voice');
  await Promise.all([typed, spoken]);
  assert.deepEqual(calls.slice(2), ['calcium please', 'and vitamin d']);
  flow.reset();
});
test('state.recover() reopens the window even mid-speech', async () => {
  state.wake(); state.think(); state.speak('alert');
  assert.equal(state.isSpeaking, true);
  state.recover();
  assert.equal(state.current, 'listening'); assert.equal(state.isSpeaking, false);
  state.reset();
});
test('a live transcriber reports closed after close(); the no-key stub never does', () => {
  const stub = createLiveTranscriber(() => {});
  assert.equal(stub.closed, false); stub.close(); assert.equal(stub.closed, false);
  process.env.DEEPGRAM_API_KEY = 'test-only';
  try {
    const live = createLiveTranscriber(() => {});
    assert.equal(live.closed, false); live.close(); assert.equal(live.closed, true);
  } finally { process.env.DEEPGRAM_API_KEY = ''; }
});
test('/debug accepts the token via header, Bearer or query, trims pasted whitespace, and /api/health is public', async () => {
  process.env.DEBUG_TOKEN = ' demo-token\n';
  const app = await buildServer();
  try {
    const health = await app.inject('/api/health');
    assert.equal(health.statusCode, 200); assert.equal(health.json().state, 'idle'); assert.equal(health.json().turn, null);
    const payload = { now: '2026-10-22T09:00:00Z' };
    assert.equal((await app.inject({ method: 'POST', url: '/debug/clock', payload })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/debug/clock?token=wrong', payload })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/debug/clock?token=demo-token', payload })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/debug/clock', headers: { 'x-debug-token': 'demo-token ' }, payload })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/debug/reset', headers: { authorization: 'Bearer demo-token' } })).statusCode, 200);
    // A PCM chunk marked speech=1 tells the pipeline the elder is talking; end=1 that she stopped.
    const chunk = { method: 'POST' as const, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(512) };
    assert.equal((await app.inject({ ...chunk, url: '/api/audio?seq=0&sr=16000&speech=1' })).statusCode, 202);
    assert.equal((await app.inject({ ...chunk, url: '/api/audio?seq=1&sr=16000&speech=1&end=1' })).statusCode, 202);
    assert.equal((await app.inject('/api/health')).json().mic_session, true);
  } finally { delete process.env.DEBUG_TOKEN; await app.close(); }
});
