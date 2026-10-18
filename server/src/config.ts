import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const serverRoot = fileURLToPath(new URL('../', import.meta.url));
// Explicit environment variables win, including empty keys in offline tests.
const envFile = resolve(serverRoot, '.env');
if (existsSync(envFile)) loadEnvFile(envFile);
export const audioDir = resolve(serverRoot, 'audio');
