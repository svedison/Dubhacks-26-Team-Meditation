// The Deepgram live session seen through a fake socket: a one-word wake must not depend on Deepgram answering a
// Finalize (its docs: the from_finalize reply is "not guaranteed" when little audio is buffered). The interim wakes the
// device, the Finalize is preceded by silence that carries the word past Deepgram's endpointing, and a final that comes
// back twice for the same stretch of audio is delivered once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { LiveSocket } from '../src/stt.js';

process.env.DEEPGRAM_API_KEY = 'test-only';
const { createLiveTranscriber, END_PAD_MS, recentDeepgram } = await import('../src/stt.js');

type Listener = (...args: unknown[]) => void;
class FakeSocket implements LiveSocket {
  readyState = 0; // CONNECTING
  bufferedAmount = 0;
  sent: (Buffer | string)[] = [];
  url = '';
  private listeners = new Map<string, Listener[]>();
  on(event: string, listener: Listener): this { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); return this; }
  emit(event: string, ...args: unknown[]): void { for (const listener of this.listeners.get(event) ?? []) listener(...args); }
  send(data: Buffer | string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.emit('close', 1000, Buffer.from('')); }
  terminate(): void { this.readyState = 3; }
  open(): void { this.readyState = 1; this.emit('open'); }
  /** A Deepgram `Results` message; `text` goes into the first alternative. */
  results(text: string, fields: Record<string, unknown> = {}): void {
    this.emit('message', Buffer.from(JSON.stringify({ type: 'Results', start: 0.4, duration: 0.5, is_final: false, speech_final: false, channel: { alternatives: [{ transcript: text }] }, ...fields })));
  }
  /** What was sent after the open handshake, as a readable list: 'pcm:<bytes>' or the JSON control message. */
  describe(): string[] { return this.sent.map(item => Buffer.isBuffer(item) ? `pcm:${item.length}` : item); }
}
const connectTo = (socket: FakeSocket) => (url: string) => { socket.url = url; return socket; };

test('a one-word wake: the interim is reported, Finalize follows a silence pad, the final is delivered once', async () => {
  const socket = new FakeSocket();
  const interims: string[] = [], finals: string[] = [];
  const live = createLiveTranscriber(text => { finals.push(text); }, { pcmSampleRate: 16000, keyterms: ['Milo'], onInterim: text => interims.push(text), connect: connectTo(socket) });
  assert.match(socket.url, /encoding=linear16&sample_rate=16000&channels=1/); assert.match(socket.url, /keyterm=Milo/);
  socket.open();
  live.send(Buffer.alloc(8192));
  socket.results('Milo');
  assert.deepEqual(interims, ['Milo']); assert.deepEqual(finals, []); // an interim never becomes an utterance
  live.finalize();
  const padBytes = 16000 * 2 * END_PAD_MS / 1000;
  assert.deepEqual(socket.describe(), ['pcm:8192', `pcm:${padBytes}`, '{"type":"Finalize"}']);
  socket.results('Milo.', { is_final: true, from_finalize: true, duration: 0.6 });
  await delay(0);
  assert.deepEqual(finals, ['Milo.']);
  // Deepgram's own endpoint closes the same stretch of audio again a moment later (now that the pad passed 1.5 s): not a second utterance.
  socket.results('Milo.', { is_final: true, speech_final: true, duration: 2.1 });
  await delay(0);
  assert.deepEqual(finals, ['Milo.']);
  const trace = recentDeepgram();
  assert.deepEqual(trace.map(t => t.event).slice(-5), ['open', 'interim', 'finalize', 'final (from_finalize)', 'final (speech_final)']);
  assert.equal(trace.find(t => t.event === 'finalize')?.pad_ms, END_PAD_MS);
  live.close();
});
test('a wake said before the handshake finished: audio, the pad and the Finalize go out in that order once the socket opens', async () => {
  const socket = new FakeSocket();
  const finals: string[] = [];
  const live = createLiveTranscriber(text => { finals.push(text); }, { pcmSampleRate: 16000, connect: connectTo(socket) });
  live.send(Buffer.alloc(4096)); live.send(Buffer.alloc(4096));
  live.finalize();
  assert.deepEqual(socket.sent, []);
  socket.open();
  assert.deepEqual(socket.describe(), ['pcm:4096', 'pcm:4096', `pcm:${16000 * 2 * END_PAD_MS / 1000}`, '{"type":"Finalize"}']);
  socket.results('Milo', { is_final: true, from_finalize: true });
  await delay(0);
  assert.deepEqual(finals, ['Milo']);
  live.close();
});
test('an interim carries the finals already heard in this sentence; container audio gets no pad', () => {
  const socket = new FakeSocket();
  const interims: string[] = [];
  const live = createLiveTranscriber(() => {}, { onInterim: text => interims.push(text), connect: connectTo(socket) });
  socket.open();
  socket.results('Milo, the purple', { is_final: true, start: 0.4 }); // is_final without speech_final: the sentence goes on
  socket.results('bottle is', { start: 2.0 });
  assert.deepEqual(interims, ['Milo, the purple bottle is']);
  live.finalize();
  assert.deepEqual(socket.describe(), ['{"type":"Finalize"}']);
  live.close();
});
test('empty interims, metadata and speech events are ignored; a provider close marks the session closed', () => {
  const socket = new FakeSocket();
  const interims: string[] = [];
  const live = createLiveTranscriber(() => {}, { onInterim: text => interims.push(text), connect: connectTo(socket) });
  socket.open();
  socket.results('');
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'Metadata', request_id: 'x' })));
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'SpeechStarted', timestamp: 0.1 })));
  assert.deepEqual(interims, []);
  assert.equal(live.closed, false);
  socket.emit('close', 1011, Buffer.from('timeout'));
  assert.equal(live.closed, true);
});
