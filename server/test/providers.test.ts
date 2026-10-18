import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { rm, readFile } from 'node:fs/promises';
import { decide, readDecision, FALLBACK_REPLY, type Context } from '../src/llm.js';
import { synthesize } from '../src/tts.js';
import { createLiveTranscriber, transcribeAudio } from '../src/stt.js';
import { defaultSettings, shelfSeed } from '../src/seed.js';
import { audioDir } from '../src/config.js';

const fetchOriginal = globalThis.fetch;
const originalEnv = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY, DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL };
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
const result = { intent: 'refill', product_id: 'calcium-120', reply: 'Would you like another bottle?', elder_name: null };
const context: Context = { products: shelfSeed, settings: defaultSettings, chatRounds: 0, pendingProductId: null, awaitingName: false, history: [] };
const content = (text: string) => [{ type: 'text' as const, text, citations: null }];

test('Claude rejects refusals, truncated output, invalid JSON and invented shelf IDs', () => {
  for (const stop_reason of ['refusal', 'max_tokens'] as const) {
    assert.equal(readDecision({ stop_reason, content: content(JSON.stringify(result)) }, shelfSeed).reply, FALLBACK_REPLY);
  }
  assert.equal(readDecision({ stop_reason: 'end_turn', content: content('not JSON') }, shelfSeed).reply, FALLBACK_REPLY);
  assert.equal(readDecision({ stop_reason: 'end_turn', content: content(JSON.stringify({ ...result, product_id: 'invented' })) }, shelfSeed).reply, FALLBACK_REPLY);
  assert.deepEqual(readDecision({ stop_reason: 'end_turn', content: content(JSON.stringify(result)) }, shelfSeed), result);
});
test('Anthropic SDK makes one streaming structured-output call with correct parameters', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-only';
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, process.env.ANTHROPIC_MODEL || 'claude-opus-5-5');
    assert.equal(request.stream, true); assert.equal(request.output_config.effort, 'low');
    assert.equal(request.output_config.format.type, 'json_schema');
    for (const field of ['thinking', 'temperature', 'budget_tokens', 'tool_choice']) assert.equal(field in request, false);
    const events = [
      { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: request.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(result) } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  assert.deepEqual(await decide('purple bottle is empty', context), result);
  assert.equal(calls, 1);
});
test('provider errors and missing keys degrade without throwing', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  process.env.ANTHROPIC_API_KEY = 'test-only'; process.env.OPENAI_API_KEY = 'test-only'; process.env.DEEPGRAM_API_KEY = 'test-only';
  assert.equal((await decide('hello', context)).reply, FALLBACK_REPLY);
  assert.equal(await synthesize('test ' + randomUUID()), null);
  assert.equal(await transcribeAudio(Buffer.from('x'), 'audio/webm'), null);
  process.env.ANTHROPIC_API_KEY = ''; process.env.OPENAI_API_KEY = ''; process.env.DEEPGRAM_API_KEY = '';
  assert.equal((await decide('hello', context)).reply, FALLBACK_REPLY);
  assert.equal(await synthesize('hello'), null);
  assert.equal(await transcribeAudio(Buffer.from('x'), 'audio/webm'), null);
  const live = createLiveTranscriber(() => { throw new Error('must not transcribe'); });
  live.send(Buffer.from('x')); live.close();
});
test('TTS uses fetch, caches MP3 atomically, and produces the public URL', async () => {
  process.env.OPENAI_API_KEY = 'test-only'; process.env.PUBLIC_BASE_URL = 'https://trusttag.example/';
  const text = `Cache check ${randomUUID()}`;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++; assert.equal(input, 'https://api.openai.com/v1/audio/speech');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-4o-mini-tts'); assert.equal(body.speed, 0.9);
    assert.equal(body.response_format, 'mp3'); assert.equal(body.input, text);
    return new Response(Buffer.from('mock-mp3'), { headers: { 'content-type': 'audio/mpeg' } });
  };
  const url = await synthesize(text);
  assert.ok(url?.startsWith('https://trusttag.example/audio/'));
  const path = resolve(audioDir, basename(url!));
  try {
    assert.equal((await readFile(path)).toString(), 'mock-mp3');
    assert.equal(await synthesize(text), url); assert.equal(calls, 1);
  } finally { await rm(path, { force: true }); }
});
test('Deepgram prerecorded request forwards bytes and extracts final text', async () => {
  process.env.DEEPGRAM_API_KEY = 'test-only';
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /api.deepgram.com\/v1\/listen\?model=nova-3/);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Token test-only');
    assert.deepEqual(Buffer.from(init?.body as Uint8Array), Buffer.from('audio'));
    return Response.json({ results: { channels: [{ alternatives: [{ transcript: 'Lily, the purple bottle is empty.' }] }] } });
  };
  assert.equal(await transcribeAudio(Buffer.from('audio'), 'audio/mp4'), 'Lily, the purple bottle is empty.');
});
