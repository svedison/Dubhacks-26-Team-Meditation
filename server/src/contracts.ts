import { z } from 'zod';

export const productSchema = z.object({
  id: z.string(), name: z.string(), price_cents: z.number().int().nonnegative(),
  category: z.string(), certification: z.string().nullable(), aliases: z.array(z.string()),
  label_dose: z.string().nullable(), units: z.number().int().positive(), units_per_dose: z.number().positive(),
  risk: z.object({ kind: z.enum(['fda_fraud', 'recall', 'unverified']), alternative_id: z.string() }).nullable(),
  image_url: z.string().url().nullable().optional(), // store photo (QFC listing); the elder page falls back to its local images by id
});
export const orderSchema = z.object({
  id: z.string(), product_id: z.string(), price_cents: z.number().int().nonnegative(),
  status: z.enum(['paid', 'simulated_paid', 'blocked']), block_reason: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }), deliver_on: z.string().date(), received: z.boolean(),
});
export const memorySchema = z.object({
  id: z.string(), product_id: z.string(), dose_text: z.string(),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)),
  start_date: z.string().date(), end_date: z.string().date().nullable(),
  stock_units: z.number().nonnegative(), units_per_dose: z.number().positive(), paused: z.boolean(),
  log: z.array(z.object({ at: z.string().datetime({ offset: true }), answer: z.enum(['taken', 'skipped', 'later', 'unconfirmed']) })),
});
export const settingsSchema = z.object({
  elder_name: z.string().max(100), address: z.string().max(500), phone: z.string().max(100),
  card_last4: z.string().regex(/^\d{4}$/), card_owner: z.enum(['elder', 'guardian']),
  monthly_baseline_cents: z.number().int().nonnegative(), share_level: z.enum(['minimum', 'default', 'open']),
  wake_name: z.string().trim().max(80), photos: z.array(z.string()),
});
export type Product = z.infer<typeof productSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Memory = z.infer<typeof memorySchema>;
export type Settings = z.infer<typeof settingsSchema>;
export interface Alert {
  id: string; level: 'red' | 'yellow' | 'normal'; rule: number | null; title: string;
  body: string; grandma_note: string | null; created_at: string; archived: boolean;
}
export type State = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'worried' | 'alert';
export type Emotion = Extract<State, 'happy' | 'worried' | 'alert'>;
export type Source = 'voice' | 'keyboard';
export interface Card { product: Product; alternative?: Product }
export interface UtteranceResult { reply_text: string; audio_url: string | null; state: State; card?: Card; order?: Order }
export type ServerEvent =
  | { type: 'state'; state: State }
  | { type: 'transcript'; role: 'grandma' | 'ai'; text: string }
  | { type: 'speak'; text: string; audio_url: string | null }
  | ({ type: 'card' } & Card)
  | { type: 'clock'; now: string }
  | { type: 'ask'; text: string; audio_url: string | null; kind: 'received' | 'dose_confirm' | 'reminder' }
  | ({ type: 'order' } & Order)
  | ({ type: 'memory' } & Memory)
  | ({ type: 'alert' } & Alert);
