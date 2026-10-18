// Pack the eight Visa sandbox credential files into ONE JSON file to upload as a single Render Secret File named
// visa-bundle.json. Usage: npx tsx tools/visa/make-bundle.mts <credential dir> <output file outside the repo>
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: make-bundle.mts <credential dir> <output file>'); process.exit(2); }
const names = ['auth.json', 'client-cert.pem', 'client-key.pem', 'mle-key.pem', 'mle-client-cert.pem', 'mle-key-id.txt', 'mle-server-cert.pem', 'pav-fixture.json'];
const files = Object.fromEntries(names.map(name => [name, readFileSync(join(resolve(dir), name), 'utf8')]));
writeFileSync(resolve(out), JSON.stringify({ files }, null, 0));
chmodSync(resolve(out), 0o600);
console.log(`wrote ${resolve(out)} (${names.length} files, ${JSON.stringify({ files }).length} bytes). Upload it to Render as a Secret File named visa-bundle.json.`);
