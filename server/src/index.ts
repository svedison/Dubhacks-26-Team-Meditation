import './config.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { audioDir, serverRoot } from './config.js';
import { all, get, getSettings, put, remove, resetDatabase, saveSettings } from './db.js';
import { acknowledgeSpoke, addClient, hasElder, toGuardian } from './bus.js';
import { now, resetClock, seattleWallNow, setClock, startClock, stopClock } from './clock.js';
import { memorySchema, settingsSchema } from './contracts.js';
import { handleUtterance, pipeline } from './pipeline.js';
import { state } from './state.js';
import { createLiveTranscriber, recentDeepgram, transcribeAudio, type LiveTranscriber } from './stt.js';
import { ledger, publishOrder, visaMode } from './modules/risk.js';
import { credentialStatus, visaSandbox } from './modules/visa-sandbox.js';
import { deleteMemory, receiveOrder, registerMemoryTicks, resetMemoryModule, updateMemory } from './modules/memory.js';
import { FALLBACK_REPLY } from './llm.js';

const utteranceSchema = z.object({ text: z.string().trim().min(1).max(8_000), source: z.enum(['voice', 'keyboard']).default('keyboard') });
const idSchema = z.object({ id: z.string().min(1).max(200) });
const clockSchema = z.object({ now: z.string().datetime({ offset: true }) });
const jumpSchema = z.object({ now: z.string().datetime({ offset: true }).optional(), to: z.enum(['seattle', 'delivery', 'next-reminder']).optional() });
/** The demo remote's shortcuts: the dates come from what is on screen, so nobody computes them during the pitch. */
function jumpTarget(to: 'seattle' | 'delivery' | 'next-reminder'): string | { error: string } {
  const current = now(), today = current.slice(0, 10);
  const dayAfter = (date: string, days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  if (to === 'seattle') return new Date(seattleWallNow()).toISOString();
  if (to === 'delivery') {
    const due = all('orders').filter(o => !o.received && o.status !== 'blocked' && o.deliver_on >= today).map(o => o.deliver_on).sort()[0];
    return due ? `${due}T09:00:00.000Z` : { error: 'No order is waiting for delivery; place one first.' };
  }
  // The next dose on the schedule, 5 s past it (inside D's 60 s window); tomorrow 8:00 when no Memory exists yet.
  const candidates: string[] = [];
  for (const memory of all('memories')) {
    if (memory.paused) continue;
    for (const days of [0, 1, 2]) {
      const date = dayAfter(today, days);
      if (date < memory.start_date || (memory.end_date && date > memory.end_date)) continue;
      for (const time of memory.times) { const at = `${date}T${time}:00.000Z`; if (at > current) candidates.push(at); }
    }
  }
  const next = candidates.sort()[0] ?? `${dayAfter(today, 1)}T08:00:00.000Z`;
  return new Date(Date.parse(next) + 5_000).toISOString();
}
// A phone-sized page for whoever presents: the demo clock, and one tap per jump. Opened as /debug/remote?token=...
const REMOTE_PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Milo 演示遥控</title><style>
body{margin:0;padding:24px;font:18px/1.4 -apple-system,system-ui,sans-serif;background:#111;color:#eee}
h1{font-size:20px;margin:0 0 4px;color:#bbb}.now{font-size:34px;font-weight:700;margin:0 0 20px;font-variant-numeric:tabular-nums}
button{display:block;width:100%;padding:20px;margin:12px 0;font-size:22px;border:0;border-radius:14px;background:#2d6cdf;color:#fff}
button.warn{background:#8a2a2a;margin-top:32px}.msg{min-height:1.5em;color:#9ad}small{color:#888}
</style></head><body>
<h1>Milo 演示时钟</h1><p class="now" id="now">…</p>
<button data-to="delivery">到货当天 9:00 AM</button>
<button data-to="next-reminder">下一次吃药提醒</button>
<button data-to="seattle">回到西雅图现在</button>
<button class="warn" id="reset">重置演示（清数据，时钟回到现在）</button>
<p class="msg" id="msg"></p>
<small>按钮等同 GET /debug/clock?to=…；到货日按屏幕上的订单算，提醒按 Memory 的时间算。时钟每 5 秒从 /api/health 刷新。</small>
<script>
const token=new URLSearchParams(location.search).get('token')||'';
const q=p=>p+(p.includes('?')?'&':'?')+'token='+encodeURIComponent(token);
const nowEl=document.getElementById('now'),msg=document.getElementById('msg');
const show=iso=>iso?iso.slice(0,16).replace('T','  '):'—';
async function refresh(){try{const r=await fetch('/api/health');const j=await r.json();nowEl.textContent=show(j.now)+(j.state?'  ·  '+j.state:'')}catch{nowEl.textContent='后端无响应'}}
async function act(path,method){msg.textContent='…';try{const r=await fetch(q(path),{method});const j=await r.json().catch(()=>({}));msg.textContent=r.ok?(j.now?'已跳到 '+show(j.now):'已重置'):(j.error||('HTTP '+r.status))}catch(e){msg.textContent=String(e)}refresh()}
for(const b of document.querySelectorAll('button[data-to]'))b.onclick=()=>act('/debug/clock?to='+b.dataset.to,'GET');
document.getElementById('reset').onclick=()=>{if(confirm('清空订单、对话和时钟，回到演示开始？'))act('/debug/reset','POST')};
refresh();setInterval(refresh,5000);
</script></body></html>`;
const audioQuerySchema = z.object({ seq: z.coerce.number().int().nonnegative().optional(), sr: z.coerce.number().int().positive().default(16000),
  speech: z.coerce.number().int().optional(), end: z.coerce.number().int().optional() });
// A builds to frontend/dist; when present the backend hosts it so /elder, /guardian, /api and /ws share one origin (iPad needs one HTTPS URL).
const frontendDist = resolve(serverRoot, '../frontend/dist');

export async function buildServer() {
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
  await app.register(cors, { origin: '*' });
  await app.register(websocket, { options: { maxPayload: 2 * 1024 * 1024 } });
  await mkdir(audioDir, { recursive: true });
  // Audio files are named by the hash of their text and voice: they never change, so the iPad keeps them. This plugin's
  // reply.sendFile also serves the SPA fallback (index.html), which must always be revalidated.
  await app.register(staticFiles, {
    root: audioDir, prefix: '/audio/', index: false, cacheControl: false,
    setHeaders(res, path) { res.setHeader('cache-control', path.endsWith('.mp3') ? 'public, max-age=31536000, immutable' : 'no-cache'); },
  });
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
        if (!live || live.closed || !liveConnections.has(live)) {
          if (live) liveConnections.delete(live);
          const version = audioGeneration;
          live = createLiveTranscriber(text => version === audioGeneration ? handleUtterance(text, 'voice') : undefined,
            { keyterms: [getSettings().wake_name], onInterim: text => { if (version === audioGeneration) pipeline.heardInterim(text); } });
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
      // A session Deepgram hung up on is replaced on the next chunk; before, its chunks were silently dropped until 90 s of silence.
      if (pcmSession && (pcmSession.sampleRate !== query.sr || pcmSession.live.closed)) dropPcmSession();
      if (!pcmSession || !liveConnections.has(pcmSession.live)) {
        const live = createLiveTranscriber(text => version === audioGeneration ? handleUtterance(text, 'voice') : undefined,
          { pcmSampleRate: query.sr, keyterms: [getSettings().wake_name], onInterim: text => { if (version === audioGeneration) pipeline.heardInterim(text); } });
        liveConnections.add(live);
        pcmSession = { live, sampleRate: query.sr };
      }
      clearTimeout(pcmSession.idle);
      pcmSession.idle = setTimeout(dropPcmSession, 600_000); // KeepAlive holds the socket; a warm session answers the next wake faster
      pcmSession.idle.unref();
      if (request.body.length) pcmSession.live.send(request.body);
      if (query.end) { pcmSession.live.finalize(); pipeline.noteMic('end'); }
      else if (query.speech && request.body.length) pipeline.noteMic('speech'); // the elder is talking right now
      return reply.code(202).send({ ok: true, seq: query.seq, stt: Boolean(process.env.DEEPGRAM_API_KEY) });
    }
    const text = await transcribeAudio(request.body, request.headers['content-type'] || 'application/octet-stream');
    if (!text || version !== audioGeneration) return { reply_text: FALLBACK_REPLY, audio_url: null, state: state.current };
    return handleUtterance(text, 'voice');
  });
  // Public, read-only: what the conversation is doing. Lets anyone on the team see a stuck turn without the debug token.
  app.get('/api/health', async () => ({
    ok: true, now: now(), uptime_s: Math.round(process.uptime()), commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
    ...pipeline.status(), elder_connected: hasElder(), stt_sessions: liveConnections.size, mic_session: pcmSession !== null,
  }));
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
  // The deployed URL is public: when DEBUG_TOKEN is set, /debug/* needs it as the x-debug-token header, an
  // Authorization: Bearer header or ?token=. Both sides are trimmed (a newline pasted into Render's env field
  // must not lock everyone out) and a mismatch logs the lengths so the dashboard value can be checked.
  app.addHook('onRequest', async (request, reply) => {
    const expected = (process.env.DEBUG_TOKEN ?? '').trim();
    if (!expected || !request.url.startsWith('/debug')) return;
    const header = request.headers['x-debug-token'];
    const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const query = (request.query as { token?: string } | undefined)?.token;
    const [given, via] = typeof header === 'string' ? [header, 'x-debug-token header'] : bearer ? [bearer, 'Authorization header'] : [query, '?token='];
    if (typeof given !== 'string' || given.trim() !== expected) {
      request.log.warn(`Debug token mismatch: got ${typeof given === 'string' ? given.trim().length : 0} characters via ${via}, DEBUG_TOKEN has ${expected.length}`);
      return reply.code(401).send({ error: 'Debug token required' });
    }
  });
  app.post('/debug/clock', async request => ({ now: await setClock(clockSchema.parse(request.body).now) }));
  // The same jump from a browser tab or the remote page: ?now=<ISO> or ?to=delivery|next-reminder|seattle (plus ?token=).
  app.get('/debug/clock', async (request, reply) => {
    const query = jumpSchema.parse(request.query ?? {});
    const target = query.now ?? (query.to ? jumpTarget(query.to) : null);
    if (!target) return reply.code(400).send({ error: 'Give now=<ISO time> or to=delivery|next-reminder|seattle' });
    if (typeof target !== 'string') return reply.code(409).send(target);
    return { now: await setClock(target) };
  });
  app.get('/debug/remote', async (_request, reply) => reply.type('text/html; charset=utf-8').send(REMOTE_PAGE));
  // Is the Visa sandbox wired up on this deployment? File names only, the mode, and a live Hello World (no card data).
  app.get('/debug/visa', async () => {
    const files = credentialStatus();
    const mode = visaMode();
    let hello: { ok: boolean; detail: string } = { ok: false, detail: 'not attempted: credential files missing' };
    if (!files.missing.length) {
      try { await visaSandbox.hello(); hello = { ok: true, detail: 'sandbox.api.visa.com answered helloworld over mTLS' }; }
      catch (error) { hello = { ok: false, detail: error instanceof Error ? error.message : 'error' }; }
    }
    // Names only (never contents) of whatever Render mounted: shows a wrong filename or folder at a glance.
    let secret_files: string[] | null = null;
    try { secret_files = readdirSync('/etc/secrets'); } catch { secret_files = null; }
    return { mode, ...files, secret_files, env: { VISA_SANDBOX_DIR: process.env.VISA_SANDBOX_DIR ?? null, VISA_SANDBOX_PREFLIGHT: process.env.VISA_SANDBOX_PREFLIGHT ?? null }, hello };
  });
  // What Deepgram actually delivered lately and whether it woke the device, plus its raw interim/final messages:
  // the thing to look at when "Milo" is missed.
  app.get('/debug/heard', async () => ({ wake_name: getSettings().wake_name, heard: pipeline.recentlyHeard(), deepgram: recentDeepgram() }));
  app.post('/debug/reset', async () => {
    audioGeneration++; dropPcmSession();
    for (const live of liveConnections) live.close();
    liveConnections.clear();
    pipeline.reset(); resetDatabase(); resetClock(); resetMemoryModule();
    return { ok: true };
  });
  if (existsSync(resolve(frontendDist, 'index.html'))) {
    await app.register(staticFiles, {
      root: frontendDist, prefix: '/', decorateReply: false, wildcard: false, index: ['index.html'], cacheControl: false,
      // Cold start on the iPad: hashed bundles never change; the 16 MB voice-detection runtime and model change only with a
      // library upgrade. Keep both instead of re-asking the server on every open. Everything else (index.html) is revalidated.
      setHeaders(res, path) {
        const assets = /[\\/]assets[\\/]/.test(path), vad = /[\\/]vad[\\/]/.test(path);
        res.setHeader('cache-control', assets ? 'public, max-age=31536000, immutable' : vad ? 'public, max-age=86400' : 'no-cache');
      },
    });
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
