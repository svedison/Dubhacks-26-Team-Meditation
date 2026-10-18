import './config.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { audioDir, serverRoot } from './config.js';
import { all, get, getSettings, put, remove, resetDatabase, saveSettings } from './db.js';
import { acknowledgeSpoke, addClient, toGuardian } from './bus.js';
import { now, resetClock, setClock, startClock, stopClock } from './clock.js';
import { memorySchema, settingsSchema } from './contracts.js';
import { handleUtterance, pipeline } from './pipeline.js';
import { state } from './state.js';
import { createLiveTranscriber, transcribeAudio, type LiveTranscriber } from './stt.js';
import { ledger, publishOrder } from './modules/risk.js';
import { deleteMemory, receiveOrder, registerMemoryTicks, resetMemoryModule, updateMemory } from './modules/memory.js';
import { FALLBACK_REPLY } from './llm.js';

const utteranceSchema = z.object({ text: z.string().trim().min(1).max(8_000), source: z.enum(['voice', 'keyboard']).default('keyboard') });
const idSchema = z.object({ id: z.string().min(1).max(200) });
const clockSchema = z.object({ now: z.string().datetime({ offset: true }) });
const audioQuerySchema = z.object({ seq: z.coerce.number().int().nonnegative().optional(), sr: z.coerce.number().int().positive().default(16000),
  speech: z.coerce.number().int().optional(), end: z.coerce.number().int().optional() });
// A builds to frontend/dist; when present the backend hosts it so /elder, /guardian, /api and /ws share one origin (iPad needs one HTTPS URL).
const frontendDist = resolve(serverRoot, '../frontend/dist');

export async function buildServer() {
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
  await app.register(cors, { origin: '*' });
  await app.register(websocket, { options: { maxPayload: 2 * 1024 * 1024 } });
  await mkdir(audioDir, { recursive: true });
  await app.register(staticFiles, { root: audioDir, prefix: '/audio/', index: false });
  for (const contentType of ['application/octet-stream', /^audio\//, /^video\/webm/]) {
    app.addContentTypeParser(contentType, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues });
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status >= 400 && status < 500) return reply.code(status).send({ error: 'Invalid request' });
    app.log.error('Request failed');
    return reply.code(500).send({ error: 'Internal error' });
  });

  const liveConnections = new Set<LiveTranscriber>();
  let audioGeneration = 0;
  app.get('/ws', { websocket: true }, (socket, request) => {
    const query = request.query as { role?: string };
    if (query.role && query.role !== 'elder' && query.role !== 'guardian') { socket.close(1008, 'Unknown role'); return; }
    const role = query.role === 'guardian' ? 'guardian' : 'elder';
    const removeClient = addClient(socket, role);
    let live: LiveTranscriber | undefined;
    socket.send(JSON.stringify({ type: 'clock', now: now() }));
    if (role === 'elder') socket.send(JSON.stringify({ type: 'state', state: state.current }));
    // Attach synchronously: no initial messages are lost while awaiting provider setup.
    socket.on('message', (data, binary) => {
      if (role !== 'elder') return;
      if (binary) {
        if (!live || !liveConnections.has(live)) {
          const version = audioGeneration;
          live = createLiveTranscriber(text => version === audioGeneration ? handleUtterance(text, 'voice') : undefined);
          liveConnections.add(live);
        }
        live.send(Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer));
        return;
      }
      try {
        const message: unknown = JSON.parse(data.toString());
        if (!message || typeof message !== 'object' || !('type' in message)) return;
        if (message.type === 'spoke') acknowledgeSpoke();
        else if (message.type === 'utterance') {
          const result = utteranceSchema.safeParse(message);
          if (result.success) void handleUtterance(result.data.text, result.data.source).catch(() => app.log.warn('WebSocket utterance failed'));
        }
      } catch { /* Bad client JSON does not close the voice session. */ }
    });
    socket.on('error', () => app.log.warn('Client WebSocket error'));
    socket.on('close', () => { removeClient(); if (live) { live.close(); liveConnections.delete(live); } });
  });
  app.post('/api/utterance', async request => {
    const body = utteranceSchema.parse(request.body);
    return handleUtterance(body.text, body.source);
  });
  // Two upload modes. A's iPad mic: many small raw PCM chunks (16 kHz mono s16le) with ?seq=N[&end=1], one request
  // in flight at a time, so this must answer immediately and never block on Claude; chunks are streamed to one shared
  // Deepgram live session and final transcripts enter the pipeline asynchronously. Legacy: a whole clip with no ?seq.
  let pcmSession: { live: LiveTranscriber; sampleRate: number; idle?: ReturnType<typeof setTimeout> } | null = null;
  const dropPcmSession = () => { if (pcmSession) { clearTimeout(pcmSession.idle); pcmSession.live.close(); liveConnections.delete(pcmSession.live); pcmSession = null; } };
  app.post('/api/audio', async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: 'Send an audio blob with an audio/* or application/octet-stream content type' });
    const query = audioQuerySchema.parse(request.query ?? {});
    const version = audioGeneration;
    if (query.seq !== undefined) {
      if (pcmSession && pcmSession.sampleRate !== query.sr) dropPcmSession();
      if (!pcmSession || !liveConnections.has(pcmSession.live)) {
        const live = createLiveTranscriber(text => version === audioGeneration ? handleUtterance(text, 'voice') : undefined, { pcmSampleRate: query.sr });
        liveConnections.add(live);
        pcmSession = { live, sampleRate: query.sr };
      }
      clearTimeout(pcmSession.idle);
      pcmSession.idle = setTimeout(dropPcmSession, 90_000);
      pcmSession.idle.unref();
      if (request.body.length) pcmSession.live.send(request.body);
      if (query.end) pcmSession.live.finalize();
      return reply.code(202).send({ ok: true, seq: query.seq, stt: Boolean(process.env.DEEPGRAM_API_KEY) });
    }
    const text = await transcribeAudio(request.body, request.headers['content-type'] || 'application/octet-stream');
    if (!text || version !== audioGeneration) return { reply_text: FALLBACK_REPLY, audio_url: null, state: state.current };
    return handleUtterance(text, 'voice');
  });
  app.get('/api/products', async () => all('products'));
  app.get('/api/orders', async () => ledger());
  app.post('/api/orders/:id/received', async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const existing = get('orders', id);
    if (!existing) return reply.code(404).send({ error: 'Order not found' });
    if (existing.status === 'blocked') return reply.code(409).send({ error: 'Blocked order cannot be received' });
    const order = receiveOrder(id)!;
    if (!existing.received) publishOrder(order);
    return order;
  });
  app.get('/api/memories', async () => all('memories'));
  app.get('/api/memories/:id', async (request, reply) => {
    const memory = get('memories', idSchema.parse(request.params).id);
    return memory || reply.code(404).send({ error: 'Memory not found' });
  });
  app.put('/api/memories/:id', async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    if (!get('memories', id)) return reply.code(404).send({ error: 'Memory not found' });
    // The shared contract has no deletion event. PUT null deletes; GET refreshes the list.
    if (request.body === null) { deleteMemory(id); return { ok: true }; }
    const patch = memorySchema.omit({ id: true, product_id: true, log: true }).partial().strict().parse(request.body);
    try { return updateMemory(id, patch); } // D validates the schedule, cancels stale prompts and pushes the memory event
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid memory' }); }
  });
  app.get('/api/alerts', async () => all('alerts'));
  app.post('/api/alerts/:id/archive', async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const alert = get('alerts', id);
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });
    alert.archived = true; put('alerts', id, alert);
    return { ok: true };
  });
  app.get('/api/settings', async () => getSettings());
  app.put('/api/settings', async request => {
    const patch = settingsSchema.partial().strict().parse(request.body);
    return saveSettings(settingsSchema.parse({ ...getSettings(), ...patch }));
  });
  app.post('/debug/clock', async request => ({ now: await setClock(clockSchema.parse(request.body).now) }));
  app.post('/debug/reset', async () => {
    audioGeneration++; dropPcmSession();
    for (const live of liveConnections) live.close();
    liveConnections.clear();
    pipeline.reset(); resetDatabase(); resetClock(); resetMemoryModule();
    return { ok: true };
  });
  if (existsSync(resolve(frontendDist, 'index.html'))) {
    await app.register(staticFiles, { root: frontendDist, prefix: '/', decorateReply: false, wildcard: false, index: ['index.html'] });
    // SPA fallback: /elder, /guardian/* etc. render index.html; API-looking paths still 404 as JSON.
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0];
      if (request.method === 'GET' && !/^\/(api|debug|ws|audio)(\/|$)/.test(path) && !path.includes('.')) return reply.type('text/html').sendFile('index.html', frontendDist);
      return reply.code(404).send({ error: 'Not found' });
    });
    app.log.info(`Hosting frontend from ${frontendDist}`);
  }
  const unregisterMemory = registerMemoryTicks();
  app.addHook('onReady', async () => { startClock(); });
  app.addHook('onClose', async () => {
    audioGeneration++; dropPcmSession();
    for (const live of liveConnections) live.close();
    liveConnections.clear(); stopClock(); unregisterMemory(); pipeline.reset();
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildServer();
  const close = () => { void app.close().then(() => process.exit(0)); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  try { await app.listen({ port: Number(process.env.PORT || 8787), host: '0.0.0.0' }); }
  catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
}
