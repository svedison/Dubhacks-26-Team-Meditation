import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serverRoot } from './config.js';
import type { Order, Product, Settings } from './contracts.js';

export const DEMO_START = '2026-10-17T18:00:00Z';
const fallbackShelf: Product[] = [
  { id: 'calcium-120', name: 'Calcium 600mg, 120 tablets', price_cents: 1800, category: 'supplement',
    certification: 'USP', aliases: ['the purple bottle'], label_dose: '1 tablet daily with food',
    units: 120, units_per_dose: 1, risk: null },
  { id: 'glucosamine-usp', name: 'Glucosamine 1500mg, 90 tablets', price_cents: 2400, category: 'supplement',
    certification: 'USP', aliases: [], label_dose: '1 tablet daily', units: 90, units_per_dose: 1, risk: null },
  { id: 'miracle-joint', name: 'Miracle Joint Pills (as seen on TV)', price_cents: 8900, category: 'supplement',
    certification: null, aliases: ['miracle joint pills'], label_dose: null, units: 60, units_per_dose: 2,
    risk: { kind: 'fda_fraud', alternative_id: 'glucosamine-usp' } },
];
// D owns the shelf (modules/role-d/data/products.json, 20 demo products). Keep only the contract fields so the LLM
// prompt stays small; D's module reads the full records itself.
function loadShelf(): Product[] {
  const file = resolve(serverRoot, '../modules/role-d/data/products.json');
  if (!existsSync(file)) return fallbackShelf;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Array<Product & Record<string, unknown>>;
    return raw.map(p => ({ id: p.id, name: p.name, price_cents: p.price_cents, category: p.category, certification: p.certification,
      aliases: p.aliases, label_dose: p.label_dose, units: p.units, units_per_dose: p.units_per_dose, risk: p.risk,
      image_url: typeof p.image_url === 'string' ? p.image_url : null }));
  } catch { return fallbackShelf; }
}
export const shelfSeed: Product[] = loadShelf();
export const defaultSettings: Settings = {
  elder_name: 'Grandma', address: '123 Maple St', phone: '555-0100', card_last4: '4242',
  card_owner: 'guardian', monthly_baseline_cents: 15000, share_level: 'default', wake_name: 'Milo', photos: [],
};
export const historicalOrder: Order = {
  id: 'ord_00', product_id: 'calcium-120', price_cents: 1800, status: 'paid', block_reason: null,
  created_at: '2026-09-10T15:00:00Z', deliver_on: '2026-09-14', received: true,
};
