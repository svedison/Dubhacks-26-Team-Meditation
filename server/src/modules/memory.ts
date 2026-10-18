import { randomUUID } from 'node:crypto';
import { all, get, put, transaction } from '../db.js';
import { now, onTick } from '../clock.js';
import { toGuardian } from '../bus.js';
import type { Alert, Memory, Order } from '../contracts.js';
export { shelfSeed } from '../seed.js';

export function createAlert(level: Alert['level'], rule: number | null, title: string, body: string): Alert {
  const alert: Alert = { id: `al_${randomUUID()}`, level, rule, title, body, grandma_note: null, created_at: now(), archived: false };
  put('alerts', alert.id, alert);
  if (level === 'red' || level === 'normal') toGuardian({ type: 'alert', ...alert });
  // D will add yellow aggregation and rules 1–8 here.
  return alert;
}
export function saveGrandmaNote(id: string, note: string): void {
  const alert = get('alerts', id);
  if (!alert) return;
  alert.grandma_note = note;
  put('alerts', id, alert);
  if (alert.level === 'red') toGuardian({ type: 'alert', ...alert });
}
// Called atomically with the received flag; retries cannot add another pack.
export function markReceived(id: string): Order | undefined {
  const changedMemories: Memory[] = [];
  const order = transaction(() => {
    const existing = get('orders', id);
    if (!existing || existing.received || existing.status === 'blocked') return existing;
    existing.received = true;
    put('orders', id, existing);
    const product = get('products', existing.product_id);
    if (product) {
      for (const memory of all('memories').filter(m => m.product_id === product.id)) {
        memory.stock_units += product.units;
        put('memories', memory.id, memory);
        changedMemories.push(memory);
      }
    }
    return existing;
  });
  for (const memory of changedMemories) toGuardian({ type: 'memory', ...memory });
  // D will ask dose_confirm and create a Memory when none exists, after consent.
  return order;
}
export function registerMemoryTicks(): () => void {
  return onTick((_prevNow, _now) => {
    // D: detect crossed delivery/reminder times here, persist dedupe keys in kv,
    // and use state + awaitSpoke before sending the next ask. Ignore backwards jumps.
  });
}
