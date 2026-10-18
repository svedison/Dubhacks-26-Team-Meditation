import '../config.js';
import { createPrivateKey, X509Certificate, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import https from 'node:https';
import { CompactEncrypt, compactDecrypt } from 'jose';
import { z } from 'zod';

export interface SandboxCredentials { username: string; password: string; cert: string; key: string; keyId: string;
  mleKey: KeyObject; mleServerKey: KeyObject; fixture: Record<string, unknown> }
export type SandboxPath = '/vdp/helloworld' | '/pav/v1/cardvalidation';
export type SandboxTransport = (credentials: SandboxCredentials, path: SandboxPath, body?: string) => Promise<{status: number; body: unknown}>;
export class VisaSandboxError extends Error {
  constructor(readonly code: 'configuration_error' | 'http_error' | 'network_error' | 'invalid_response'
    | 'invalid_encrypted_response' | 'account_validation_failed', readonly httpStatus?: number) {
    super(`visa_sandbox_${code}`); this.name = 'VisaSandboxError';
  }
}

export async function encryptPayload(data: unknown, keyId: string, key: KeyObject): Promise<{encData: string}> {
  const encData = await new CompactEncrypt(Buffer.from(JSON.stringify(data)))
    // Visa specifies milliseconds, unlike JWT NumericDate. Never use the demo clock.
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A128GCM', iat: Date.now(), kid: keyId }).encrypt(key);
  return { encData };
}
export async function decryptPayload(data: unknown, key: KeyObject): Promise<unknown> {
  try {
    const envelope = z.object({ encData: z.string().min(1) }).parse(data);
    const result = await compactDecrypt(envelope.encData, key,
      { keyManagementAlgorithms: ['RSA-OAEP-256'], contentEncryptionAlgorithms: ['A128GCM'] });
    return JSON.parse(Buffer.from(result.plaintext).toString('utf8'));
  } catch { throw new VisaSandboxError('invalid_encrypted_response'); }
}

const approvalSchema = z.object({
  actionCode: z.enum(['00', '85']), approvalCode: z.string().trim().min(1),
  transactionIdentifier: z.union([z.number().int().positive().safe(), z.string().regex(/^\d{15}$/)]),
  addressVerificationResults: z.literal('Y'), cvv2ResultCode: z.literal('M'),
});
export function parseValidation(data: unknown) {
  const result = approvalSchema.safeParse(data);
  if (!result.success) throw new VisaSandboxError('account_validation_failed');
  // Retain no PAN, CVV, address, approval code, or raw provider response.
  return { service: 'visa_pav' as const, environment: 'sandbox' as const, testFixture: true as const,
    approved: true as const, actionCode: result.data.actionCode, checkedAt: new Date().toISOString() };
}

const fixtureSchema = z.object({
  primaryAccountNumber: z.string().regex(/^\d{13,19}$/), cardExpiryDate: z.string().regex(/^\d{4}-\d{2}$/),
  cardCvv2Value: z.string().regex(/^\d{3,4}$/), acquiringBin: z.string().regex(/^\d{6,11}$/),
  acquirerCountryCode: z.string().regex(/^\d{3}$/),
  addressVerificationResults: z.object({ street: z.string().min(1), postalCode: z.string().min(1) }).strict(),
  cardAcceptor: z.object({ idCode: z.string().min(1), terminalId: z.string().min(1), name: z.string().min(1),
    address: z.object({ state: z.string().min(1), city: z.string().min(1), zipCode: z.string().min(1), country: z.string().min(1) }).strict(),
  }).strict(),
}).strict();
export function parseSandboxAuth(data: unknown): { username: string; password: string } {
  try {
    const auth = z.object({ username: z.string().min(1).regex(/^[^:\s]+$/), password: z.string().min(1) }).parse(data);
    if (!auth.password.trim() || /PASTE_|<redacted>/i.test(auth.password)) throw new Error();
    return auth;
  } catch { throw new VisaSandboxError('configuration_error'); }
}
export function loadSandboxCredentials(dir = process.env.VISA_SANDBOX_DIR): SandboxCredentials {
  try {
    if (!dir || !isAbsolute(dir)) throw new Error();
    const read = (name: string) => readFileSync(join(dir, name), 'utf8');
    const auth = parseSandboxAuth(JSON.parse(read('auth.json')));
    const cert = read('client-cert.pem'); const key = read('client-key.pem');
    if (!new X509Certificate(cert).checkPrivateKey(createPrivateKey(key))) throw new Error();
    const mleKey = createPrivateKey(read('mle-key.pem'));
    if (!new X509Certificate(read('mle-client-cert.pem')).checkPrivateKey(mleKey)) throw new Error();
    const keyId = z.string().uuid().parse(read('mle-key-id.txt').trim());
    return { ...auth, cert, key, keyId, mleKey, mleServerKey: new X509Certificate(read('mle-server-cert.pem')).publicKey,
      fixture: fixtureSchema.parse(JSON.parse(read('pav-fixture.json'))) };
  } catch { throw new VisaSandboxError('configuration_error'); }
}

// No configurable host, redirects, production mode, automatic retries or raw error bodies.
export const requestSandbox: SandboxTransport = async (credentials, path, body) => {
  if (path !== '/vdp/helloworld' && path !== '/pav/v1/cardvalidation') throw new VisaSandboxError('configuration_error');
  try {
    return await new Promise((resolve, reject) => {
      const signal = AbortSignal.timeout(10_000); // Includes DNS, TLS and the full response body.
      const req = https.request({ hostname: 'sandbox.api.visa.com', port: 443, path,
        method: body === undefined ? 'GET' : 'POST', signal,
        cert: credentials.cert, key: credentials.key, auth: `${credentials.username}:${credentials.password}`,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : {
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), keyId: credentials.keyId,
        }) },
      }, res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) { req.destroy(); reject(new VisaSandboxError('invalid_response')); return; }
          chunks.push(chunk);
        });
        res.on('error', () => reject(new VisaSandboxError('network_error')));
        res.on('end', () => {
          if (res.statusCode !== 200) { reject(new VisaSandboxError('http_error', res.statusCode)); return; }
          try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch { reject(new VisaSandboxError('invalid_response')); }
        });
      });
      req.on('error', () => reject(new VisaSandboxError('network_error')));
      req.end(body);
    });
  } catch (error) {
    if (error instanceof VisaSandboxError) throw error;
    throw new VisaSandboxError('network_error');
  }
};

export class VisaSandboxClient {
  constructor(private readonly config: SandboxCredentials, private readonly transport: SandboxTransport = requestSandbox) {}
  private async request(path: SandboxPath, body?: string) {
    try {
      const result = await this.transport(this.config, path, body);
      if (result.status !== 200) throw new VisaSandboxError('http_error', result.status);
      return result.body;
    } catch (error) {
      if (error instanceof VisaSandboxError) throw error;
      throw new VisaSandboxError('network_error');
    }
  }
  async hello() {
    const response = await this.request('/vdp/helloworld');
    if (!z.object({ message: z.literal('helloworld') }).safeParse(response).success) throw new VisaSandboxError('invalid_response');
    return { environment: 'sandbox' as const, connected: true as const };
  }
  async validateTestAccount() {
    let encrypted: { encData: string };
    try { encrypted = await encryptPayload(this.config.fixture, this.config.keyId, this.config.mleServerKey); }
    catch { throw new VisaSandboxError('configuration_error'); }
    const response = await this.request('/pav/v1/cardvalidation', JSON.stringify(encrypted));
    return parseValidation(await decryptPayload(response, this.config.mleKey));
  }
}

export const visaSandbox = {
  async validateTestAccount() { return new VisaSandboxClient(loadSandboxCredentials()).validateTestAccount(); },
};
