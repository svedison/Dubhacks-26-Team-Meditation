import type { Order, Product, Settings } from './contracts.js';

export const DEMO_START = '2026-10-17T18:00:00Z';
export const shelfSeed: Product[] = [
  { id: 'calcium-120', name: 'Calcium 600mg, 120 tablets', price_cents: 1800, category: 'supplement',
    certification: 'USP', aliases: ['the purple bottle'], label_dose: '1 tablet daily with food',
    units: 120, units_per_dose: 1, risk: null },
  { id: 'glucosamine-usp', name: 'Glucosamine 1500mg, 90 tablets', price_cents: 2400, category: 'supplement',
    certification: 'USP', aliases: [], label_dose: '1 tablet daily', units: 90, units_per_dose: 1, risk: null },
  { id: 'miracle-joint', name: 'Miracle Joint Pills (as seen on TV)', price_cents: 8900, category: 'supplement',
    certification: null, aliases: ['miracle joint pills'], label_dose: null, units: 60, units_per_dose: 2,
    risk: { kind: 'fda_fraud', alternative_id: 'glucosamine-usp' } },
];
export const defaultSettings: Settings = {
  elder_name: 'Grandma', address: '123 Maple St', phone: '555-0100', card_last4: '4242',
  card_owner: 'guardian', monthly_baseline_cents: 15000, share_level: 'default', wake_name: 'Lily', photos: [],
};
export const historicalOrder: Order = {
  id: 'ord_00', product_id: 'calcium-120', price_cents: 1800, status: 'paid', block_reason: null,
  created_at: '2026-09-10T15:00:00Z', deliver_on: '2026-09-14', received: true,
};
