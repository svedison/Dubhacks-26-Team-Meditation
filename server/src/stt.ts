import './config.js';
import WebSocket from 'ws';

type TranscriptHandler = (text: string) => void | Promise<unknown>;
export interface LiveTranscriber { send(chunk: Buffer): void; finalize(): void; close(): void }
/** Raw PCM input (A's iPad mic uploads): 16 kHz mono 16-bit little-endian. Omit for container audio (webm/mp4). */
export interface LiveOptions { pcmSampleRate?: number }
interface DeepgramResult {
  type?: string; is_final?: boolean; speech_final?: boolean; from_finalize?: boolean; start?: number; duration?: number;
  channel?: { alternatives?: { transcript?: string }[] };
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
}
export function createLiveTranscriber(onTranscript: TranscriptHandler, options: LiveOptions = {}): LiveTranscriber {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { send() {}, finalize() {}, close() {} };
  let closed = false;
  let bufferedBytes = 0;
  let buffered: Buffer[] = [];
  let segments: string[] = [];
  let lastFinal = '';
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const params = new URLSearchParams({ model: 'nova-3', smart_format: 'true', interim_results: 'true', endpointing: '300', utterance_end_ms: '1200', vad_events: 'true' });
  if (options.pcmSampleRate) { params.set('encoding', 'linear16'); params.set('sample_rate', String(options.pcmSampleRate)); params.set('channels', '1'); }
  const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${key}` }, handshakeTimeout: 5_000,
  });
  const deliver = () => {
    if (flushTimer) clearTimeout(flushTimer);
    const text = segments.join(' ').trim();
    segments = [];
    if (text && !closed) void Promise.resolve().then(() => onTranscript(text)).catch(() => console.warn('Transcript handler failed'));
  };
  socket.on('open', () => {
    if (closed) { socket.close(); return; }
    for (const chunk of buffered) socket.send(chunk);
    buffered = []; bufferedBytes = 0;
  });
  socket.on('message', data => {
    try {
      const result = JSON.parse(data.toString()) as DeepgramResult;
      if (result.type === 'UtteranceEnd') { deliver(); return; }
      if (!result.is_final) return; // Interim hypotheses never enter the purchase pipeline.
      const text = result.channel?.alternatives?.[0]?.transcript?.trim();
      const marker = `${result.start}:${result.duration}:${text}`;
      if (text && marker !== lastFinal) { segments.push(text); lastFinal = marker; }
      if (result.speech_final || result.from_finalize) deliver();
      else {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(deliver, 1_000);
        flushTimer.unref();
      }
    } catch { /* Ignore malformed provider events. */ }
  });
  const keepAlive = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'KeepAlive' }));
  }, 5_000);
  keepAlive.unref();
  const cleanup = () => {
    closed = true; clearInterval(keepAlive);
    if (flushTimer) clearTimeout(flushTimer);
    buffered = []; segments = []; bufferedBytes = 0;
  };
  socket.on('close', cleanup);
  socket.on('error', () => { cleanup(); console.warn('Deepgram live unavailable; keyboard input remains available'); socket.terminate(); });
  return {
    send(chunk) {
      if (closed) return;
      if (socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount + chunk.length > 2_000_000) { cleanup(); socket.close(); return; }
        socket.send(chunk);
      } else if (socket.readyState === WebSocket.CONNECTING) {
        if (bufferedBytes + chunk.length > 2_000_000) { cleanup(); socket.terminate(); return; }
        buffered.push(chunk); bufferedBytes += chunk.length;
      }
    },
    // A marks the last chunk of an utterance with end=1; ask Deepgram to flush its final transcript now.
    finalize() { if (!closed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'Finalize' })); },
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
