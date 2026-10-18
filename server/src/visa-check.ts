import { loadSandboxCredentials, VisaSandboxClient, VisaSandboxError } from './modules/visa-sandbox.js';

try {
  const client = new VisaSandboxClient(loadSandboxCredentials());
  const connectivity = await client.hello();
  const validation = await client.validateTestAccount();
  console.log(JSON.stringify({ connectivity, validation, payment: 'simulated_only' }, null, 2));
} catch (error) {
  // No credentials, raw provider data or underlying TLS/JSON exceptions in logs.
  console.error(JSON.stringify({ ok: false, error: error instanceof VisaSandboxError ? error.code : 'check_failed',
    ...(error instanceof VisaSandboxError && error.httpStatus ? { httpStatus: error.httpStatus } : {}) }));
  process.exitCode = 1;
}
