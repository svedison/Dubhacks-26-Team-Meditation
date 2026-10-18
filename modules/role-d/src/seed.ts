import catalog from '../data/products.json' with {type: 'json'};
import orders from '../data/orders.json' with {type: 'json'};
import type { Product, State, Order } from './types.ts';
export const INITIAL_NOW = '2026-10-17T18:00:00.000Z';
export const PRODUCTS = catalog as Product[];
export function seed(wallNow: number): State {
  return {version: 1, clockOffsetMs: Date.parse(INITIAL_NOW) - wallNow, lastTick: INITIAL_NOW,
    orders: structuredClone(orders) as Order[], memories: [], alerts: [],
    settings: {elder_name: 'Grandma', address: '123 Demo Lane', phone: '555-0100', card_last4: '4242',
      card_owner: 'guardian', monthly_baseline_cents: 15000, share_level: 'default', wake_name: 'Lily',
      photos: Array.from({length: 5}, (_, i) => `/assets/photos/family-${i + 1}.svg`)},
    prompts: [], occurrences: {}, receivedOrders: ['ord_00'], inventory: {}, deliveryAsked: {}, memorySince: {},
    refills: {}, alertEvents: {}, pushedAlerts: [], noteQueue: []};
}
