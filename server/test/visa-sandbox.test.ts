import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compactDecrypt, CompactEncrypt, decodeProtectedHeader } from 'jose';
import {
  encryptPayload, decryptPayload, parseValidation, loadSandboxCredentials, parseSandboxAuth,
  VisaSandboxClient, type SandboxCredentials, type SandboxTransport,
} from '../src/modules/visa-sandbox.js';

const serverKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const clientKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const approved = { actionCode: '00', approvalCode: '12AB54', transactionIdentifier: 123456789012345,
  addressVerificationResults: 'Y', cvv2ResultCode: 'M' };
const config: SandboxCredentials = { username: 'test-user', password: 'test-secret', cert: '', key: '',
  keyId: 'test-key-id', mleKey: clientKeys.privateKey, mleServerKey: serverKeys.publicKey,
  fixture: { primaryAccountNumber: 'synthetic-test-fixture' } };
const encryptedResponse = async (data: unknown) => ({ encData: await new CompactEncrypt(Buffer.from(JSON.stringify(data)))
  .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A128GCM', kid: config.keyId })
  .encrypt(clientKeys.publicKey) });

test('MLE uses Visa algorithms, a real millisecond clock and server encryption key', async () => {
  const before = Date.now();
  const body = await encryptPayload(config.fixture, config.keyId, serverKeys.publicKey);
  const header = decodeProtectedHeader(body.encData);
  assert.equal(header.alg, 'RSA-OAEP-256'); assert.equal(header.enc, 'A128GCM');
  assert.equal(header.kid, config.keyId);
  assert.ok(Number(header.iat) >= before && Number(header.iat) <= Date.now());
  const decoded = await compactDecrypt(body.encData, serverKeys.privateKey);
  assert.deepEqual(JSON.parse(Buffer.from(decoded.plaintext).toString()), config.fixture);
  assert.equal(JSON.stringify(body).includes('synthetic-test-fixture'), false);
});

test('MLE decrypts responses but rejects tampering, wrong keys, plaintext and wrong algorithms', async () => {
  const envelope = await encryptedResponse(approved);
  assert.deepEqual(await decryptPayload(envelope, clientKeys.privateKey), approved);
  const parts = envelope.encData.split('.');
  parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  for (const data of [approved, { encData: parts.join('.') }, { encData: 'invalid' }]) {
    await assert.rejects(decryptPayload(data, clientKeys.privateKey), /invalid_encrypted_response/);
  }
  await assert.rejects(decryptPayload(envelope, serverKeys.privateKey), /invalid_encrypted_response/);
  const weak = { encData: await new CompactEncrypt(Buffer.from('{}'))
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' }).encrypt(clientKeys.publicKey) };
  await assert.rejects(decryptPayload(weak, clientKeys.privateKey), /invalid_encrypted_response/);
});

test('only approved, complete account checks yield sanitized sandbox evidence', () => {
  for (const actionCode of ['00', '85']) {
    const result = parseValidation({ ...approved, actionCode, secret: 'do-not-expose' });
    assert.equal(result.approved, true); assert.equal(result.actionCode, actionCode);
    assert.equal(result.environment, 'sandbox'); assert.equal(result.testFixture, true);
    assert.equal(JSON.stringify(result).includes('do-not-expose'), false);
    assert.equal('approvalCode' in result, false);
  }
  for (const data of [{}, null, { ...approved, actionCode: '25' }, { ...approved, approvalCode: '' },
    { ...approved, transactionIdentifier: null }, { ...approved, cvv2ResultCode: 'N' },
    { ...approved, addressVerificationResults: 'N' }]) {
    assert.throws(() => parseValidation(data), /account_validation_failed/);
  }
});

test('client sends encrypted test data only to the PAV path and rejects HTTP errors without echoing bodies', async () => {
  const transport: SandboxTransport = async (credentials, path, body) => {
    assert.equal(path, '/pav/v1/cardvalidation'); assert.equal(credentials.keyId, config.keyId);
    const decoded = await compactDecrypt(JSON.parse(body!).encData, serverKeys.privateKey);
    assert.deepEqual(JSON.parse(Buffer.from(decoded.plaintext).toString()), config.fixture);
    return { status: 200, body: await encryptedResponse(approved) };
  };
  assert.equal((await new VisaSandboxClient(config, transport).validateTestAccount()).approved, true);
  for (const status of [301, 401, 500]) {
    await assert.rejects(new VisaSandboxClient(config, async () => ({ status, body: { message: config.password } }))
      .validateTestAccount(), error => error instanceof Error && error.message === 'visa_sandbox_http_error');
  }
  await assert.rejects(new VisaSandboxClient(config, async () => ({ status: 200, body: approved }))
    .validateTestAccount(), /invalid_encrypted_response/);
  await assert.rejects(new VisaSandboxClient(config, async () => { throw new Error(config.password); })
    .validateTestAccount(), error => error instanceof Error && !error.message.includes(config.password));
});

test('Hello World requires the expected response and never establishes a payment', async () => {
  const client = new VisaSandboxClient(config, async (_c, path, body) => {
    assert.equal(path, '/vdp/helloworld'); assert.equal(body, undefined);
    return { status: 200, body: { message: 'helloworld' } };
  });
  assert.deepEqual(await client.hello(), { environment: 'sandbox', connected: true });
  await assert.rejects(new VisaSandboxClient(config, async () => ({ status: 200, body: {} })).hello(), /invalid_response/);
});

test('missing files fail with a safe configuration error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'visa-config-'));
  try {
    for (const password of ['', '<redacted>', 'PASTE_VISA_SANDBOX_API_PASSWORD_HERE', 'test-secret']) {
      writeFileSync(join(dir, 'auth.json'), JSON.stringify({ username: 'test-user', password }));
      assert.throws(() => loadSandboxCredentials(dir), error => error instanceof Error && error.message === 'visa_sandbox_configuration_error');
    }
    assert.throws(() => loadSandboxCredentials('relative-path'), /configuration_error/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('auth validation accepts real values and independently rejects placeholder/redacted passwords', () => {
  assert.deepEqual(parseSandboxAuth({ username: 'test-user', password: 'test-secret' }),
    { username: 'test-user', password: 'test-secret' });
  for (const password of ['', ' ', '<redacted>', 'PASTE_VISA_SANDBOX_API_PASSWORD_HERE']) {
    assert.throws(() => parseSandboxAuth({ username: 'test-user', password }), /configuration_error/);
  }
  assert.throws(() => parseSandboxAuth({ username: 'invalid:user', password: 'test-secret' }), /configuration_error/);
});
test('a single uploaded bundle is unpacked into a private folder and found without VISA_SANDBOX_DIR', async () => {
  const { mkdtempSync, writeFileSync, statSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { CREDENTIAL_FILES, credentialDir, credentialStatus } = await import('../src/modules/visa-sandbox.js');
  const dir = mkdtempSync(join(tmpdir(), 'visa-bundle-test-'));
  const bundle = join(dir, 'visa-bundle.json');
  writeFileSync(bundle, JSON.stringify({ files: Object.fromEntries(CREDENTIAL_FILES.map(name => [name, `dummy ${name}`])) }));
  const saved = { dir: process.env.VISA_SANDBOX_DIR, bundle: process.env.VISA_SANDBOX_BUNDLE };
  delete process.env.VISA_SANDBOX_DIR; process.env.VISA_SANDBOX_BUNDLE = bundle;
  try {
    const found = credentialDir();
    assert.ok(found && found !== dir, 'unpacked into its own folder');
    assert.deepEqual(credentialStatus().missing, []);
    assert.equal(readFileSync(join(found!, 'auth.json'), 'utf8'), 'dummy auth.json');
    assert.equal(statSync(join(found!, 'client-key.pem')).mode & 0o777, 0o600);
    assert.equal(credentialDir(), found); // unpacked once, reused
  } finally {
    if (saved.dir === undefined) delete process.env.VISA_SANDBOX_DIR; else process.env.VISA_SANDBOX_DIR = saved.dir;
    if (saved.bundle === undefined) delete process.env.VISA_SANDBOX_BUNDLE; else process.env.VISA_SANDBOX_BUNDLE = saved.bundle;
  }
});
