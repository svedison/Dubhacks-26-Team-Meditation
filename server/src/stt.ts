import './config.js';
import WebSocket from 'ws';

type TranscriptHandler = (text: string) => void | Promise<unknown>;
/** `closed` turns true once Deepgram hangs up or errors; the owner then opens a fresh session for the next chunk. */
export interface LiveTranscriber { send(chunk: Buffer): void; finalize(): void; close(): void; readonly closed: boolean }
/** What a session needs from the Deepgram socket; tests hand in a fake through `LiveOptions.connect`. */
export interface LiveSocket {
  readonly readyState: number; readonly bufferedAmount: number;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: any[]) => void): unknown;
  send(data: Buffer | string): void; close(): void; terminate(): void;
}
/** Raw PCM input (A's iPad mic uploads): 16 kHz mono 16-bit little-endian. Omit for container audio (webm/mp4). */
export interface LiveOptions {
  pcmSampleRate?: number;
  /** Words Deepgram should favour (nova-3 keyterm prompting): the wake name, so "Milo" is not heard as "my low". */
  keyterms?: string[];
  /** Deepgram's running hypothesis of the sentence being said (interim results): enough to wake the device, never to shop. */
  onInterim?: (text: string) => void;
  /** Opens the socket to Deepgram; tests substitute a fake. */
  connect?: (url: string, key: string) => LiveSocket;
}
// Silence appended before every Finalize (raw PCM only). Deepgram does not promise a final in reply to Finalize when
// little audio sits in its buffer: a one-word "Milo" (0.4 s of speech, then the 1.2 s of silence the iPad sends) could
// stay unfinalized until the next sentence pushed it out, so the device woke on that sentence instead of on the name.
// With the pad the silence after the word passes Deepgram's own 1.5 s endpointing and the word is delivered at once.
export const END_PAD_MS = 1500;
const FINALIZE = JSON.stringify({ type: 'Finalize' });
const TRACE_SIZE = 40;

interface DeepgramResult {
  type?: string; is_final?: boolean; speech_final?: boolean; from_finalize?: boolean; start?: number; duration?: number;
  channel?: { alternatives?: { transcript?: string }[] };
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
}
/** One Deepgram message (or one thing we sent it), kept for /debug/heard. */
export interface DeepgramTrace { at: string; session: number; event: string; text?: string; start?: number; duration?: number; pad_ms?: number; detail?: string }
const trace: DeepgramTrace[] = [];
let sessions = 0;
function record(session: number, event: string, extra: Partial<DeepgramTrace> = {}): void {
  trace.push({ at: new Date().toISOString(), session, event, ...extra });
  if (trace.length > TRACE_SIZE) trace.shift();
}
/** For /debug/heard: the last Deepgram messages as they came (interim, final, our Finalize), to see what a missed "Milo" turned into. */
export function recentDeepgram(): DeepgramTrace[] { return trace.slice(); }

const defaultConnect = (url: string, key: string): LiveSocket =>
  new WebSocket(url, { headers: { Authorization: `Token ${key}` }, handshakeTimeout: 5_000 });

export function createLiveTranscriber(onTranscript: TranscriptHandler, options: LiveOptions = {}): LiveTranscriber {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { send() {}, finalize() {}, close() {}, closed: false };
  const session = ++sessions;
  let closed = false;
  let bufferedBytes = 0;
  let buffered: Buffer[] = [];
  let segments: string[] = [];
  let lastFinal = '';
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let finalizeWhenOpen = false;
  // The iPad ends a sentence itself after 1.2 s of silence (end=1 -> Finalize), so Deepgram's own endpointing sits
  // above that: with the old 1000 ms a 1.1 s breath split one sentence into two turns before the device had decided.
  const params = new URLSearchParams({ model: 'nova-3', smart_format: 'true', interim_results: 'true', endpointing: '1500', utterance_end_ms: '2000', vad_events: 'true' });
  if (options.pcmSampleRate) { params.set('encoding', 'linear16'); params.set('sample_rate', String(options.pcmSampleRate)); params.set('channels', '1'); }
  for (const term of options.keyterms ?? []) if (term.trim()) params.append('keyterm', term.trim());
  const pad = options.pcmSampleRate ? Buffer.alloc(Math.round(options.pcmSampleRate * 2 * END_PAD_MS / 1000)) : null;
  const socket = (options.connect ?? defaultConnect)(`wss://api.deepgram.com/v1/listen?${params}`, key);
  const keepAlive = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'KeepAlive' }));
  }, 5_000);
  keepAlive.unref();
  const cleanup = () => {
    closed = true; clearInterval(keepAlive);
    if (flushTimer) clearTimeout(flushTimer);
    buffered = []; segments = []; bufferedBytes = 0;
  };
  const deliver = () => {
    if (flushTimer) clearTimeout(flushTimer);
    const text = segments.join(' ').trim();
    segments = [];
    if (text && !closed) void Promise.resolve().then(() => onTranscript(text)).catch(() => console.warn('Transcript handler failed'));
  };
  // Audio that arrives before the handshake finished waits here and is sent, in order, once the socket opens.
  const buffer = (chunk: Buffer) => {
    if (bufferedBytes + chunk.length > 2_000_000) { cleanup(); socket.terminate(); return; }
    buffered.push(chunk); bufferedBytes += chunk.length;
  };
  socket.on('open', () => {
    record(session, 'open');
    if (closed) { socket.close(); return; }
    for (const chunk of buffered) socket.send(chunk);
    buffered = []; bufferedBytes = 0;
    // A one-word wake ("Milo.") can end before the handshake finished; its Finalize must not be lost.
    if (finalizeWhenOpen) { finalizeWhenOpen = false; socket.send(FINALIZE); }
  });
  socket.on('message', data => {
    try {
      const result = JSON.parse(String(data)) as DeepgramResult;
      if (result.type === 'UtteranceEnd') { record(session, 'utterance_end'); deliver(); return; }
      if (result.type !== undefined && result.type !== 'Results') return; // Metadata, SpeechStarted
      const text = result.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
      const where = { start: result.start, duration: result.duration };
      if (!result.is_final) {
        // Interim hypotheses never enter the purchase pipeline; while the device is asleep they may wake it.
        if (text) { record(session, 'interim', { text, ...where }); options.onInterim?.([...segments, text].join(' ')); }
        return;
      }
      record(session, result.from_finalize ? 'final (from_finalize)' : result.speech_final ? 'final (speech_final)' : 'final', { text, ...where });
      // The same words can come back twice for one stretch of audio (Deepgram's endpoint and our Finalize): keep one.
      const marker = `${result.start}:${text}`;
      if (text && marker !== lastFinal) { segments.push(text); lastFinal = marker; }
      if (result.speech_final || result.from_finalize) deliver();
      else {
        // Safety net only: the device's end=1, Deepgram's endpointing and UtteranceEnd normally deliver first.
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(deliver, 4_000);
        flushTimer.unref();
      }
    } catch { /* Ignore malformed provider events. */ }
  });
  socket.on('close', (code, reason) => {
    const detail = `${code} ${String(reason) || 'no reason'}`;
    record(session, 'close', { detail });
    if (!closed) console.warn(`Deepgram live session closed by the provider (${detail}); the next mic chunk opens a new one`);
    cleanup();
  });
  socket.on('error', error => {
    const message = error instanceof Error ? error.message : String(error);
    record(session, 'error', { detail: message });
    cleanup(); console.warn(`Deepgram live unavailable (${message}); keyboard input remains available`); socket.terminate();
  });
  return {
    get closed() { return closed; },
    send(chunk) {
      if (closed) return;
      if (socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount + chunk.length > 2_000_000) { cleanup(); socket.close(); return; }
        socket.send(chunk);
      } else if (socket.readyState === WebSocket.CONNECTING) buffer(chunk);
    },
    // A marks the last chunk of an utterance with end=1: carry the silence past Deepgram's endpointing, then ask it to flush.
    finalize() {
      if (closed) return;
      record(session, 'finalize', pad ? { pad_ms: END_PAD_MS } : {});
      if (socket.readyState === WebSocket.OPEN) { if (pad) socket.send(pad); socket.send(FINALIZE); }
      else if (socket.readyState === WebSocket.CONNECTING) { if (pad) buffer(pad); finalizeWhenOpen = true; }
    },
    close() { cleanup(); if (socket.readyState === WebSocket.CONNECTING) socket.terminate(); else socket.close(); },
  };
}
export async function transcribeAudio(audio: Buffer, contentType: string): Promise<string | null> {
  if (!process.env.DEEPGRAM_API_KEY || !audio.length) return null;
  try {
    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true', {
      method: 'POST', headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': contentType },
      body: new Uint8Array(audio), signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const result = await response.json() as DeepgramResult;
    return result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || null;
  } catch { console.warn('Deepgram transcription unavailable; use keyboard input'); return null; }
}
