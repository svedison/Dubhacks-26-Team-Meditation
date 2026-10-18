export type Answer = 'taken' | 'skipped' | 'later' | 'unconfirmed';
export interface Product {
  id: string; name: string; price_cents: number; category: string;
  certification: string | null; aliases: string[]; label_dose: string | null;
  units: number; units_per_dose: number;
  risk: {kind: 'fda_fraud' | 'recall' | 'unverified'; alternative_id: string} | null;
  brand: string; merchant: string; ingredients: string[];
  // demo_only fixtures are synthetic; real shelf rows (2026-10-18, tools/shelf/build-shelf.mts) say where the listing,
  // label data or FDA finding came from.
  certification_source: {status: 'demo_only' | 'not_verified' | 'store_listing' | 'typical_listing' | 'usp_verified_program' | 'fda_enforcement' | 'demo_scripted'; url: string | null; note: string};
  demo_only: boolean;
  price_source?: {kind: 'store' | 'typical'; store?: string; location_id?: string; fetched_at: string};
  image_url?: string | null; // store front image; the elder page falls back to its local pictures by id
}
export interface Order {
  id: string; product_id: string; price_cents: number;
  status: 'paid' | 'simulated_paid' | 'blocked'; block_reason: string | null;
  created_at: string; deliver_on: string; received: boolean;
}
export interface Memory {
  id: string; product_id: string; dose_text: string; times: string[];
  start_date: string; end_date: string | null; stock_units: number;
  units_per_dose: number; paused: boolean; log: {at: string; answer: Answer}[];
}
export interface Alert {
  id: string; level: 'red' | 'yellow' | 'normal'; rule: number;
  title: string; body: string; grandma_note: string | null;
  created_at: string; archived: boolean;
}
export interface Settings {
  elder_name: string; address: string; phone: string; card_last4: string;
  card_owner: 'elder' | 'guardian'; monthly_baseline_cents: number;
  share_level: 'minimum' | 'default' | 'open'; wake_name: string; photos: string[];
}
export type Event = {type: string; [key: string]: unknown};
export type EventSink = (audience: 'elder' | 'guardian' | 'all', event: Event) => void;
export interface Prompt {
  kind: 'received' | 'dose_confirm' | 'reminder'; ref: string;
  at?: string; readyAt: string; askedAt?: string;
}
export interface Occurrence {
  memoryId: string; at: string; units: number; debited: number;
  answer: Answer | null; snoozeAt?: string; cancelled?: boolean;
}
export interface State {
  version: 1; clockOffsetMs: number; lastTick: string;
  orders: Order[]; memories: Memory[]; alerts: Alert[]; settings: Settings;
  prompts: Prompt[]; expiredPrompts: (Prompt & {expiredAt: string})[]; replyBarrierUntil?: string; occurrences: Record<string, Occurrence>;
  receivedOrders: string[]; inventory: Record<string, number>;
  deliveryAsked: Record<string, string>; memorySince: Record<string, string>;
  refills: Record<string, {alertId: string; offered: boolean}>;
  alertEvents: Record<string, string>; pushedAlerts: string[]; noteQueue: string[];
}
export interface Store { load(): State | null; save(state: State): void; }
