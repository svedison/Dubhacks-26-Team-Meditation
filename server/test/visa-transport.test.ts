import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, mock, test } from 'node:test';
import { requestSandbox, type SandboxCredentials } from '../src/modules/visa-sandbox.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config: SandboxCredentials = { username: 'user', password: 'secret', cert: 'test-cert', key: 'test-key',
  keyId: 'mle-id', mleKey: keys.privateKey, mleServerKey: keys.publicKey, fixture: {} };
afterEach(() => mock.restoreAll());

// Fake only the wire; exercise the real transport's framing, limits and error handling.
type WireResponse = PassThrough & { statusCode: number };
function wire(respond: (response: WireResponse) => void, beforeResponse = false) {
  let captured: https.RequestOptions | undefined; let posted = '';
  mock.method(https, 'request', ((options: https.RequestOptions, callback: (res: IncomingMessage) => void) => {
    captured = options;
    const request = new Writable({ autoDestroy: false, write(chunk, _encoding, done) { posted += chunk; done(); } });
    const response = Object.assign(new PassThrough(), { statusCode: 200 });
    options.signal?.addEventListener('abort', () => request.destroy(new Error('secret wire details')), { once: true });
    queueMicrotask(() => { if (!beforeResponse) { callback(response as unknown as IncomingMessage); respond(response); } });
    return request as unknown as ClientRequest;
  }) as typeof https.request);
  return { options: () => captured!, body: () => posted };
}

test('transport fixes the sandbox host and includes Basic auth, mTLS and the MLE header', async () => {
  const captured = wire(res => res.end('{"encData":"test-envelope"}'));
  assert.deepEqual(await requestSandbox(config, '/pav/v1/cardvalidation', '{"encData":"ciphertext"}'),
    { status: 200, body: { encData: 'test-envelope' } });
  const options = captured.options();
  assert.equal(options.hostname, 'sandbox.api.visa.com'); assert.equal(options.port, 443);
  assert.equal(options.path, '/pav/v1/cardvalidation'); assert.equal(options.method, 'POST');
  assert.equal(options.cert, 'test-cert'); assert.equal(options.key, 'test-key');
  assert.equal(options.auth, 'user:secret');
  assert.equal((options.headers as Record<string, unknown>).keyId, 'mle-id');
  assert.equal(captured.body(), '{"encData":"ciphertext"}');
  assert.ok(options.signal);
});

test('transport rejects redirects, oversized bodies and malformed JSON without exposing raw content', async () => {
  for (const respond of [
    (res: WireResponse) => { res.statusCode = 302; res.end('secret'); },
    (res: WireResponse) => res.end('secret'),
    (res: WireResponse) => res.end(Buffer.alloc(1024 * 1024 + 1)),
  ]) {
    wire(respond);
    await assert.rejects(requestSandbox(config, '/vdp/helloworld'), error =>
      error instanceof Error && /^visa_sandbox_(http_error|invalid_response)$/.test(error.message));
    mock.restoreAll();
  }
});

test('deadline also terminates a stalled connection and a response that never ends', async () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  for (const beforeResponse of [true, false]) {
    mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
      assert.ok(milliseconds > 0 && milliseconds <= 10_000);
      return realTimeout(20);
    });
    wire(() => {}, beforeResponse);
    // A real socket keeps the event loop alive. Our wire double has no socket.
    const keepAlive = setTimeout(() => {}, 1000);
    try { await assert.rejects(requestSandbox(config, '/vdp/helloworld'), /visa_sandbox_network_error/); }
    finally { clearTimeout(keepAlive); mock.restoreAll(); }
  }
});
