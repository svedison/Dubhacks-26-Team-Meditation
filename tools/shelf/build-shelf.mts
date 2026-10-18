// Build modules/role-d/data/products.json from tools/shelf/catalogue.json with real listings:
//   - Kroger Products API (a QFC near the demo): real name, brand, size and today's store price. Needs
//     KROGER_CLIENT_ID / KROGER_CLIENT_SECRET (developer.kroger.com, client-credentials, scope product.compact).
//     Without them the catalogue's typical prices are used and marked price_source.kind = "typical".
//   - NIH Dietary Supplement Label Database (no key): pack size and ingredients for supplements.
//   - openFDA (no key): OTC label directions (label_dose) and current dietary-supplement recalls (risk samples).
// Usage (from the repo root):  cd server && npx tsx ../tools/shelf/build-shelf.mts [--write] [--out path] [--recalls]
// Default output: tools/shelf/out/products.json. --write replaces modules/role-d/data/products.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const outPath = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : resolve(here, 'out/products.json');
const write = args.includes('--write');
const ZIP = process.env.KROGER_ZIP || '98105'; // University District, Seattle
const CHAIN = process.env.KROGER_CHAIN || 'QFC';

interface CatalogueItem { id: string; search: string; search2?: string; category: string; aliases: string[]; typical_cents: number; dose_from_label?: boolean; dsld?: string; certification?: string; keep_demo_record?: boolean }
interface Product {
  id: string; name: string; price_cents: number; category: string; certification: string | null; aliases: string[]; label_dose: string | null;
  units: number; units_per_dose: number; risk: { kind: 'fda_fraud' | 'recall' | 'unverified'; alternative_id: string } | null;
  brand: string; merchant: string; ingredients: string[];
  certification_source: { status: string; url: string | null; note: string }; demo_only: boolean;
  price_source?: { kind: 'store' | 'typical'; store?: string; location_id?: string; fetched_at: string };
}
const catalogue = JSON.parse(readFileSync(resolve(here, 'catalogue.json'), 'utf8')) as { items: CatalogueItem[]; risk_samples_kept_from_demo: string[] };
// The five scripted demo records, as the scenes quote them. Read from this file, never from the generated products.json,
// so a rebuild cannot drift them (an earlier run replaced the calcium name with the store's before this existed).
const current = JSON.parse(readFileSync(resolve(here, 'demo-records.json'), 'utf8')) as Product[];
const byId = new Map(current.map(p => [p.id, p]));
const now = new Date().toISOString();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) { console.warn(`  ${r.status} ${url.slice(0, 100)}`); return null; }
    return await r.json() as T;
  } catch (e) { console.warn(`  fetch failed ${url.slice(0, 100)}: ${e instanceof Error ? e.message : e}`); return null; }
}
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
// Store descriptions can run long ("Kroger® Vitamin D Whole Milk Gallon Jug"); Milo reads the name aloud, so keep it short.
function storeName(hit: KrogerProduct): string {
  let base = hit.description.replace(/[®™]/g, '').replace(/\b(BIG DEAL!?|NEW!?|Value Pack)\b/gi, '').replace(/\s+!/g, '').replace(/\s+/g, ' ').trim();
  // Marketing copy after the first separator ("| Small Meal Replacement Shake", "- Soft White (2700K)", ", Gain Lavender Scent") is not the name.
  const cut = base.split(/\s[|–-]\s|,\s/)[0].trim();
  if (cut.length >= 12) base = cut;
  base = base.replace(/\s+(for|with|in)\s+[^,]{25,}$/i, '').replace(/[.\s]+$/, '');
  const size = hit.items?.[0]?.size?.trim().replace(/\s*\/\s*/g, ' / ');
  const addSize = Boolean(size && !base.toLowerCase().includes(size.toLowerCase()));
  // Shorten the description, never the pack size: "...6 Double Rolls, 6" must not happen.
  const room = 60 - (addSize ? size!.length + 2 : 0);
  if (base.length > room) base = base.slice(0, room).replace(/[\s,(+-]+\S*$/, '').replace(/\s+\d+$/, '').replace(/[,\s]+$/, ''); // no dangling "10mg 10"
  return addSize ? `${base}, ${size}` : base;
}

// ---------- Kroger ----------
interface KrogerProduct { productId: string; upc?: string; brand?: string; description: string; items?: { size?: string; price?: { regular?: number; promo?: number }; inventory?: { stockLevel?: string } }[] }
async function kroger(): Promise<{ store: string; locationId: string; search: (term: string) => Promise<KrogerProduct | null> } | null> {
  const id = process.env.KROGER_CLIENT_ID, secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) { console.log('Kroger: no KROGER_CLIENT_ID/SECRET, using typical prices'); return null; }
  const token = await getJson<{ access_token: string }>('https://api.kroger.com/v1/connect/oauth2/token', {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=product.compact',
  });
  if (!token?.access_token) { console.warn('Kroger: token request failed'); return null; }
  const auth = { headers: { Authorization: `Bearer ${token.access_token}` } };
  const loc = await getJson<{ data: { locationId: string; name: string; chain: string; address?: { addressLine1?: string; city?: string } }[] }>(
    `https://api.kroger.com/v1/locations?filter.zipCode.near=${ZIP}&filter.chain=${CHAIN}&filter.limit=1`, auth);
  const store = loc?.data?.[0];
  if (!store) { console.warn(`Kroger: no ${CHAIN} store near ${ZIP}`); return null; }
  const storeName = `${store.chain} ${store.name}${store.address?.addressLine1 ? `, ${store.address.addressLine1}` : ''}${store.address?.city ? `, ${store.address.city}` : ''}`;
  console.log(`Kroger: pricing from ${storeName} (location ${store.locationId})`);
  return {
    store: storeName, locationId: store.locationId,
    async search(term) {
      await sleep(120);
      const r = await getJson<{ data: KrogerProduct[] }>(`https://api.kroger.com/v1/products?filter.term=${encodeURIComponent(term)}&filter.locationId=${store.locationId}&filter.limit=5`, auth);
      const priced = (r?.data ?? []).filter(p => (p.items?.[0]?.price?.regular ?? 0) > 0);
      return priced.find(p => p.items?.[0]?.inventory?.stockLevel !== 'TEMPORARILY_OUT_OF_STOCK') ?? priced[0] ?? null;
    },
  };
}
// ---------- NIH DSLD ----------
interface DsldHit { _id?: string; _source: { fullName: string; brandName: string; offMarket: number; netContents?: { unit: string; quantity: number }[]; allIngredients?: ({ name?: string } | string)[] } }
async function dsld(q: string, brand: string): Promise<DsldHit['_source'] | null> {
  const r = await getJson<{ hits: DsldHit[] }>(`https://api.ods.od.nih.gov/dsld/v9/search-filter?q=${encodeURIComponent(`${brand} ${q}`)}&size=10`);
  const hits = (r?.hits ?? []).map(h => h._source).filter(Boolean);
  const sameBrand = hits.filter(h => h.brandName?.toLowerCase().includes(brand.toLowerCase()));
  return sameBrand.find(h => h.offMarket === 0) ?? sameBrand[0] ?? null; // another brand's label would mislabel the bottle
}
// ---------- openFDA ----------
async function otcDirections(brand: string): Promise<string | null> {
  const r = await getJson<{ results?: { dosage_and_administration?: string[] }[] }>(
    `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(brand)}"+AND+openfda.product_type:"HUMAN+OTC+DRUG"&limit=1`);
  const text = r?.results?.[0]?.dosage_and_administration?.[0];
  if (!text) return null;
  // Keep the adult line only, as printed on the label; Milo repeats labels, it never invents a dose.
  const adult = text.replace(/^Directions\s*/i, '').match(/adults[^.]{0,160}/i)?.[0] ?? text.slice(0, 160);
  return `Label: ${adult.trim().replace(/\s+/g, ' ')}`;
}
async function recalls(limit: number): Promise<Product[]> {
  const r = await getJson<{ results?: { recalling_firm: string; product_description: string; reason_for_recall: string; recall_initiation_date: string; recall_number: string }[] }>(
    `https://api.fda.gov/food/enforcement.json?search=product_description:"dietary+supplement"+AND+status:"Ongoing"&sort=recall_initiation_date:desc&limit=${limit * 3}`);
  const out: Product[] = [];
  for (const rec of r?.results ?? []) {
    if (out.length >= limit) break;
    const raw = rec.product_description.split(/,|;|\bNET\b|\bUPC\b|\(/)[0].replace(/\bdietary supplement\b/i, '').replace(/\s+/g, ' ').trim();
    const name = title(raw.length > 60 ? raw.slice(0, 60).replace(/\s+\S*$/, '') : raw);
    if (name.length < 8 || out.some(p => p.name === name)) continue;
    out.push({
      id: `recall-${rec.recall_number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, price_cents: 2999, category: 'supplement', certification: null,
      aliases: [name.toLowerCase()], label_dose: null, units: 60, units_per_dose: 1,
      risk: { kind: 'recall', alternative_id: 'multivitamin' }, brand: title(rec.recalling_firm), merchant: 'Not sold: FDA recall in progress', ingredients: [],
      certification_source: { status: 'fda_enforcement', url: 'https://open.fda.gov/apis/food/enforcement/', note: `FDA recall ${rec.recall_number} (${rec.recall_initiation_date}): ${rec.reason_for_recall.slice(0, 200)}` },
      demo_only: false, price_source: { kind: 'typical', fetched_at: now },
    });
  }
  return out;
}

// ---------- build ----------
const store = await kroger();
const products: Product[] = [];
let priced = 0, labelled = 0;
for (const item of catalogue.items) {
  const existing = byId.get(item.id);
  const listing = store ? (await store.search(item.search)) ?? (item.search2 ? await store.search(item.search2) : null) : null;
  // Scripted records (the $18 calcium refill, the $24 glucosamine alternative) keep their quoted name, price and pack size.
  const pinned = Boolean(item.keep_demo_record && existing);
  const hit = pinned ? null : listing;
  const [w1, w2] = item.search.split(' ');
  const brandGuess = w2 && /^[A-Z][a-z]/.test(w2) && /^[A-Z]/.test(w1) && !['Large', 'Whole', 'Plain', 'Soft', 'Gentle', 'Wild', 'Hard', 'Dark', 'Extra', 'Long', 'Sliced', 'Frozen', 'Pitted', 'Ground', 'Salted', 'Bottled', 'Digital', 'Plug', 'Kitchen', 'Reading', 'Hearing', 'Alcohol', 'Artificial', 'Dry', 'Postage', 'Crossword', 'Chicken', 'Tomato', 'Strawberry', 'Peanut', 'Orange', 'Prune', 'Navel', 'Gala', 'Russet', 'Yellow', 'Saltine', 'Oatmeal', 'Butterscotch', 'Chamomile', 'Granulated', 'Iodized', 'All', 'Lip', 'Nail', 'Cotton', 'Denture', 'Wild'].includes(w1) ? `${w1} ${w2}` : w1;
  const product: Product = {
    id: item.id,
    name: hit ? storeName(hit) : existing?.name ?? title(item.search),
    price_cents: hit ? Math.round(((hit.items?.[0]?.price?.promo || hit.items?.[0]?.price?.regular) ?? 0) * 100) : item.typical_cents,
    category: item.category, certification: item.certification ?? null, aliases: item.aliases,
    label_dose: existing?.label_dose ?? null, units: existing?.units ?? 1, units_per_dose: existing?.units_per_dose ?? 1, risk: null,
    brand: hit?.brand ?? (/^[A-Z]/.test(brandGuess) && !['Large', 'Whole', 'Plain', 'Soft', 'Gentle', 'Wild', 'Hard'].includes(brandGuess) ? brandGuess : 'Store brand'),
    merchant: store ? store.store : 'Typical US grocery listing',
    ingredients: existing?.ingredients ?? [],
    certification_source: pinned
      ? { status: 'demo_scripted', url: null, note: `Scripted demo record kept as quoted in the scenes${listing ? `; ${store!.store} lists ${storeName(listing)} at $${(((listing.items?.[0]?.price?.promo || listing.items?.[0]?.price?.regular) ?? 0)).toFixed(2)}` : ''}` }
      : item.certification === 'USP'
      ? { status: 'usp_verified_program', url: 'https://www.usp.org/verification-services/verified-mark', note: `${brandGuess} products carry the USP Verified Mark; check the mark on this bottle` }
      : { status: hit ? 'store_listing' : 'typical_listing', url: null, note: hit ? `Listed at ${store!.store} on ${now.slice(0, 10)}` : 'Curated everyday item; price is a typical US price, not a live quote' },
    demo_only: false,
    price_source: hit ? { kind: 'store', store: store!.store, location_id: store!.locationId, fetched_at: now } : { kind: 'typical', fetched_at: now },
  };
  if (hit) priced++;
  if (item.dsld) {
    const label = await dsld(item.dsld, brandGuess);
    if (label) {
      const pack = label.netContents?.[0];
      // Demo records keep their pack size and name (scene 4 counts the 120 calcium tablets); new items take the label's.
      if (pack?.quantity && !existing) product.units = pack.quantity;
      if (!hit && !existing) product.name = `${label.fullName}${pack ? `, ${pack.quantity} ${pack.unit.replace(/\(s\)/, 's').toLowerCase()}` : ''}`;
      if (!hit) product.brand = label.brandName; // same brand as the search term by construction
      const ingredients = (label.allIngredients ?? []).map(i => typeof i === 'string' ? i : i.name ?? '').filter(Boolean).slice(0, 6);
      if (ingredients.length) product.ingredients = ingredients;
      product.label_dose ??= 'Take as directed on the label';
      labelled++;
    }
  }
  if (item.dose_from_label) {
    const directions = await otcDirections(brandGuess);
    if (directions) { product.label_dose = directions; labelled++; }
  }
  products.push(product);
}
for (const id of catalogue.risk_samples_kept_from_demo) { const sample = byId.get(id); if (sample) products.push(sample); }
// Real FDA recalls are opt-in (--recalls): the scripted scene counts on exactly the three demo risk items.
if (args.includes('--recalls')) products.push(...await recalls(2));
const ids = new Set<string>();
for (const p of products) { if (ids.has(p.id)) throw new Error(`duplicate id ${p.id}`); ids.add(p.id); }
for (const p of products) if (p.risk && !ids.has(p.risk.alternative_id)) throw new Error(`${p.id}: alternative ${p.risk.alternative_id} missing`);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(products, null, 2) + '\n');
if (write) writeFileSync(resolve(root, 'modules/role-d/data/products.json'), JSON.stringify(products, null, 2) + '\n');
const cats = products.reduce<Record<string, number>>((m, p) => ((m[p.category] = (m[p.category] ?? 0) + 1), m), {});
console.log(`\n${products.length} products -> ${write ? 'modules/role-d/data/products.json and ' : ''}${outPath}`);
console.log(`store-priced: ${priced}, label data: ${labelled}, risk items: ${products.filter(p => p.risk).length}`, cats);
