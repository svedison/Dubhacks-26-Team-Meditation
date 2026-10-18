import './config.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { audioDir } from './config.js';
import { all, get, getSettings, put, remove, resetDatabase, saveSettings } from './db.js';
import { acknowledgeSpoke, addClient, toGuardian } from './bus.js';
import { now, resetClock, setClock, startClock, stopClock } from './clock.js';
import { memorySchema, settingsSchema } from './contracts.js';
import { handleUtterance, pipeline } from './pipeline.js';
import { state } from './state.js';
import { createLiveTranscriber, transcribeAudio, type LiveTranscriber } from './stt.js';
import { ledger, publishOrder } from './modules/risk.js';
import { markReceived, registerMemoryTicks } from './modules/memory.js';
import { FALLBACK_REPLY } from './llm.js';

const utteranceSchema = z.object({ text: z.string().trim().min(1).max(8_000), source: z.enum(['voice', 'keyboard']).default('keyboard') });
const idSchema = z.object({ id: z.string().min(1).max(200) });
const clockSchema = z.object({ now: z.string().datetime({ offset: true }) });

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
  app.post('/api/audio', async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: 'Send an audio blob with an audio/* or application/octet-stream content type' });
    const version = audioGeneration;
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
    const order = markReceived(id)!;
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
    const existing = get('memories', id);
    if (!existing) return reply.code(404).send({ error: 'Memory not found' });
    // The shared contract has no deletion event. PUT null deletes; GET refreshes the list.
    if (request.body === null) { remove('memories', id); return { ok: true }; }
    const patch = memorySchema.omit({ id: true }).partial().strict().parse(request.body);
    const memory = memorySchema.parse({ ...existing, ...patch, id });
    if (!get('products', memory.product_id)) return reply.code(400).send({ error: 'Product not on shelf' });
    put('memories', id, memory); toGuardian({ type: 'memory', ...memory });
    return memory;
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
    audioGeneration++;
    for (const live of liveConnections) live.close();
    liveConnections.clear();
    pipeline.reset(); resetDatabase(); resetClock();
    return { ok: true };
  });
  const unregisterMemory = registerMemoryTicks();
  app.addHook('onReady', async () => { startClock(); });
  app.addHook('onClose', async () => {
    audioGeneration++;
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
