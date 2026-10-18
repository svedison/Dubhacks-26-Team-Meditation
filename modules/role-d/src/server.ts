import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createRoleD, SqliteStore, isScamText } from './index.ts';
import type { Options, Event } from './index.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
const MAX_BODY = 65_536;
class RequestError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new RequestError('Request too large', 413); chunks.push(chunk); }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new RequestError('Invalid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new RequestError('Expected a JSON object');
  return data as Record<string, unknown>;
}
export function createServer(options: Options & {scheduler?: boolean; allowedOrigins?: string[]} ) {
  const clients = new Map<WebSocket, 'elder' | 'guardian'>();
  let replies: Event[] = [];
  const app = createRoleD({...options, emit: (audience, event) => {
    replies.push(event);
    for (const [ws, role] of clients) if ((audience === 'all' || role === audience) && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
    options.emit?.(audience, event);
  }});
  const allowedOrigins = options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'];
  function utterance(input: Record<string, unknown>) {
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 8000 || (typeof input.source !== 'string' || !['voice', 'keyboard'].includes(input.source))) throw new RequestError('Expected text and source voice|keyboard');
    replies = [];
    const text = input.text;
    let state = 'listening';
    if (!app.handleAnswer(text)) {
      if (isScamText(text)) {
        app.recordAnomaly({rule: 7, level: 'red', title: 'Check on Mom', body: 'A request suggests possible pressure or a scam. Please check in.'}, randomUUID()); state = 'alert';
      } else {
        const suggestion = app.takeRefillSuggestion();
        const reply = suggestion ?? "This is the Role D demo. I can confirm deliveries and record reminder replies.";
        replies.push({type: 'speak', text: reply, audio_url: null});
        for (const [ws, role] of clients) if (role === 'elder' && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(replies.at(-1)));
      }
    }
    const spoken = replies.findLast(e => e.type === 'speak' || e.type === 'ask');
    return {reply_text: spoken?.text ?? 'Recorded.', audio_url: spoken?.audio_url ?? null, state};
  }
  const server = http.createServer(async (req, res) => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-trusttag-mode': 'synthetic-local-demo'});
      res.end(JSON.stringify(value));
    };
    try {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) return json(403, {error: 'Origin not allowed'});
      if (origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
      res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const method = (expected: string) => { if (req.method !== expected) throw new RequestError('Method not allowed', 405); };
      if (path.startsWith('/assets/')) {
        method('GET');
        // Allowlist generated assets; never resolve a request-supplied filesystem path.
        if (!/^\/assets\/(?:sounds\/(?:idle|listening|thinking|speaking|happy|worried|alert)\.wav|photos\/family-[1-5]\.svg)$/.test(path)) return json(404, {error: 'Asset not found'});
        const content = readFileSync(join(root, path.slice(1)));
        res.writeHead(200, {'content-type': path.endsWith('.wav') ? 'audio/wav' : 'image/svg+xml', 'cache-control': 'public, max-age=3600'}); res.end(content); return;
      }
      if (path === '/health') { method('GET'); return json(200, {ok: true, mode: 'role-d-local-demo', now: app.now()}); }
      if (path === '/api/products') { method('GET'); return json(200, app.products()); }
      if (path === '/api/orders') { method('GET'); return json(200, app.snapshot().orders); }
      if (path === '/api/settings') { method('GET'); return json(200, app.snapshot().settings); }
      if (path === '/api/memories') { method('GET'); return json(200, app.snapshot().memories); }
      if (path === '/api/alerts') { method('GET'); return json(200, app.snapshot().alerts); }
      if (path === '/api/utterance') { method('POST'); return json(200, utterance(await body(req))); }
      if (path === '/debug/clock') {
        method('POST'); const input = await body(req);
        if (typeof input.now !== 'string') throw new RequestError('now is required');
        return json(200, {now: app.setClock(input.now)});
      }
      if (path === '/debug/reset') { method('POST'); app.reset(); return json(200, {ok: true, now: app.now()}); }
      if (path === '/debug/orders') {
        method('POST'); const input = await body(req);
        const product = app.products().find(p => p.id === input.product_id);
        if (!product || product.risk || typeof input.deliver_on !== 'string') throw new RequestError('Expected safe demo product_id and deliver_on');
        const order = app.addOrder({id: `ord_${randomUUID()}`, product_id: product.id, price_cents: product.price_cents,
          status: 'simulated_paid', block_reason: null, created_at: app.now(), deliver_on: input.deliver_on, received: false});
        return json(201, order);
      }
      const receipt = path.match(/^\/api\/orders\/([^/]+)\/received$/);
      if (receipt) { method('POST'); return json(200, app.receiveOrder(receipt[1])); }
      const memory = path.match(/^\/api\/memories\/([^/]+)$/);
      if (memory) {
        if (req.method === 'DELETE') { app.deleteMemory(memory[1]); return json(200, {ok: true}); }
        method('PUT'); return json(200, app.updateMemory(memory[1], await body(req)));
      }
      const archive = path.match(/^\/api\/alerts\/([^/]+)\/archive$/);
      if (archive) { method('POST'); return json(200, app.archiveAlert(archive[1])); }
      return json(404, {error: 'Not found'});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      const status = error instanceof RequestError ? error.status : /not found/i.test(message) ? 404 : 400;
      json(status, {error: message});
    }
  });
  const wss = new WebSocketServer({noServer: true, maxPayload: MAX_BODY});
  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { socket.destroy(); return; }
    const role = url.searchParams.get('role') ?? 'elder';
    if (url.pathname !== '/ws' || !['elder', 'guardian'].includes(role) || (req.headers.origin && !allowedOrigins.includes(req.headers.origin))) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      clients.set(ws, role as 'elder' | 'guardian');
      ws.send(JSON.stringify({type: 'clock', now: app.now()}));
      ws.on('close', () => clients.delete(ws)); ws.on('error', () => clients.delete(ws));
      ws.on('message', data => {
        try {
          const input = JSON.parse(data.toString());
          if (!input || typeof input !== 'object' || Array.isArray(input) || role !== 'elder') throw new RequestError('Invalid client message');
          if (input.type === 'utterance') utterance(input);
          else if (input.type === 'spoke') ws.send(JSON.stringify({type: 'state', state: 'listening'}));
          else throw new RequestError('Unknown message type');
        } catch (error) { ws.send(JSON.stringify({type: 'error', message: error instanceof Error ? error.message : 'Invalid message'})); }
      });
    });
  });
  const timer = options.scheduler === false ? undefined : setInterval(() => {
    try { app.tick(); } catch (error) { console.error('Role D scheduler failed:', error); }
  }, 1000);
  timer?.unref();
  return {server, app, async close() {
    if (timer) clearInterval(timer);
    for (const ws of clients.keys()) ws.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.env.ROLE_D_DB ?? join(root, 'runtime', 'role-d.sqlite');
  mkdirSync(dirname(dbPath), {recursive: true});
  const store = new SqliteStore(dbPath);
  const instance = createServer({store, allowedOrigins: process.env.CORS_ORIGINS?.split(',')});
  const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? '127.0.0.1';
  instance.server.listen(port, host, () => console.log(`Role D local demo at http://${host}:${port}; synthetic data; no payment/production sharing filter.`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void instance.close().finally(() => store.close()); });
}
