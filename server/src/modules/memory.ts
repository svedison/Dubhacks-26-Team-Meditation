// Bridge between B's skeleton and D's Role D module (modules/role-d): Memory, delivery/dose/reminder prompts,
// refill notes and anomaly alerts. D owns the logic and its own state snapshot; this file (1) keeps D's clock in
// step with B's demo clock, (2) forwards D's events through B's bus + TTS, and (3) mirrors D's memories/alerts/
// orders into B's SQLite tables so the REST routes keep working. Scam alerts raised by the conversation pipeline
// are still created here (createAlert) so the existing rule-7 flow is unchanged.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createRoleD, SqliteStore } from '../../../modules/role-d/src/index.ts';
import type { Event as RoleDEvent, State as RoleDState, Store } from '../../../modules/role-d/src/types.ts';
import { all, get, put, remove, transaction } from '../db.js';
import { now, onTick } from '../clock.js';
import { toGuardian } from '../bus.js';
import { serverRoot } from '../config.js';
import { publishOrder } from './risk.js';
import type { Alert, Memory, Order } from '../contracts.js';
export { shelfSeed } from '../seed.js';

// ---------- D instance ----------
function memoryStore(): Store { let snapshot: RoleDState | null = null; return { load: () => snapshot, save: s => { snapshot = structuredClone(s); } }; }
const dbPath = process.env.DB_PATH;
const store: Store = dbPath === ':memory:' ? memoryStore()
  : new SqliteStore(resolve(serverRoot, (dbPath || 'trusttag.db').replace(/\.db$/, '') + '.role-d.db'));

export interface ProactiveSpeech { type: 'speak' | 'ask'; text: string; kind?: 'received' | 'dose_confirm' | 'reminder' }
let speaker: (event: ProactiveSpeech) => void = () => {};
/** The pipeline registers how D's spoken prompts reach the elder (serialised with normal replies, with TTS). */
export function setSpeaker(fn: (event: ProactiveSpeech) => void): void { speaker = fn; }
let lastSpoken: string | null = null;

const strip = <T extends object>(event: RoleDEvent): T => { const { type: _t, ...rest } = event; return rest as T; };
function route(_audience: 'elder' | 'guardian' | 'all', event: RoleDEvent): void {
  switch (event.type) {
    case 'clock': case 'state': return; // B owns the demo clock broadcast and the state machine.
    case 'speak': case 'ask': {
      const text = String(event.text ?? '');
      if (!text) return;
      lastSpoken = text;
      speaker(event.type === 'ask' ? { type: 'ask', text, kind: event.kind as ProactiveSpeech['kind'] } : { type: 'speak', text });
      return;
    }
    case 'memory': { const memory = strip<Memory>(event); put('memories', memory.id, memory); toGuardian({ type: 'memory', ...memory }); return; }
    case 'alert': { const alert = strip<Alert>(event); put('alerts', alert.id, alert); toGuardian({ type: 'alert', ...alert }); return; }
    case 'order': {
      const order = strip<Order>(event);
      const existing = get('orders', order.id);
      const merged: Order = { ...(existing ?? order), received: order.received };
      put('orders', merged.id, merged); publishOrder(merged); return;
    }
    default: return;
  }
}
const roleD = createRoleD({ store, emit: route });

// ---------- clock ----------
function syncClock(current: string): void {
  try {
    if (Math.abs(Date.parse(roleD.now()) - Date.parse(current)) > 1_500) roleD.setClock(current); // setClock also ticks
    else roleD.tick();
  } catch (error) { console.warn(`Role D tick failed: ${error instanceof Error ? error.message : error}`); }
}
export function registerMemoryTicks(): () => void {
  syncClock(now());
  return onTick((_prev, current) => syncClock(current));
}
export function resetMemoryModule(): void {
  roleD.reset();
  syncClock(now());
  for (const memory of roleD.snapshot().memories) put('memories', memory.id, memory);
}

// ---------- conversation hooks (called by the pipeline) ----------
/** Returns D's spoken reply when the utterance answered a delivery / dose / reminder prompt, else null. */
export function handleAnswer(text: string): string | null {
  lastSpoken = null;
  // Only consult D while it is actually waiting for an answer; otherwise product mentions in ordinary shopping
  // talk ("the purple bottle is empty") would be mistaken for an ambiguous reminder reply.
  const snap = roleD.snapshot();
  const waiting = snap.prompts.some(p => p.askedAt) || snap.expiredPrompts.length > 0 || snap.noteQueue.length > 0
    || (snap.replyBarrierUntil !== undefined && snap.replyBarrierUntil > roleD.now());
  if (!waiting) return null;
  try { return roleD.handleAnswer(text) ? (lastSpoken ?? '') : null; }
  catch (error) { console.warn(`Role D answer failed: ${error instanceof Error ? error.message : error}`); return null; }
}
/** Once per refill note: the question to tack onto the next reply, and the product it is about. */
export function takeRefillSuggestion(): { text: string; productId: string } | null {
  const snapshot = roleD.snapshot();
  const entry = Object.entries(snapshot.refills).find(([id, r]) => !r.offered && snapshot.memories.some(m => m.id === id && !m.paused));
  const memory = entry && snapshot.memories.find(m => m.id === entry[0]);
  const text = roleD.takeRefillSuggestion();
  return text && memory ? { text, productId: memory.product_id } : null;
}
export function registerOrder(order: Order): void {
  try { roleD.addOrder(order); }
  catch (error) { console.warn(`Role D did not accept order ${order.id}: ${error instanceof Error ? error.message : error}`); }
}

// ---------- REST hooks ----------
export function receiveOrder(id: string): Order | undefined {
  const order = transaction(() => {
    const existing = get('orders', id);
    if (!existing || existing.received || existing.status === 'blocked') return existing;
    existing.received = true; put('orders', id, existing); return existing;
  });
  if (!order || order.received !== true) return order;
  let handledByD = false;
  try { roleD.receiveOrder(id); handledByD = true; } // D credits stock / asks for the dose confirmation and emits order + memory events.
  catch (error) { console.warn(`Role D receive failed for ${id}: ${error instanceof Error ? error.message : error}`); }
  // Memories that exist only in B's table (created via REST before D knew them) still get the new pack once.
  const known = handledByD ? new Set(roleD.snapshot().memories.map(m => m.id)) : new Set<string>();
  const product = get('products', order.product_id);
  if (product && !get('kv', `received:${id}`)) {
    put('kv', `received:${id}`, true);
    for (const mem of all('memories').filter(m => m.product_id === product.id && !known.has(m.id))) {
      mem.stock_units += product.units; put('memories', mem.id, mem); toGuardian({ type: 'memory', ...mem });
    }
  }
  return order;
}
export function updateMemory(id: string, patch: Partial<Memory>): Memory {
  const known = roleD.snapshot().memories.some(m => m.id === id);
  if (known) { const memory = roleD.updateMemory(id, patch) as Memory; put('memories', id, memory); return memory; }
  // Mirror-only memory (inserted via REST before D knew it): patch B's copy and notify the guardian.
  const existing = get('memories', id);
  if (!existing) throw new Error('Memory not found');
  const memory: Memory = { ...existing, ...patch, id };
  put('memories', id, memory); toGuardian({ type: 'memory', ...memory });
  return memory;
}
export function deleteMemory(id: string): void {
  try { roleD.deleteMemory(id); } catch { /* unknown to D: still drop the mirror */ }
  remove('memories', id);
}
export const listMemories = (): Memory[] => all('memories');

// ---------- scam alerts from the conversation path (rule 7) ----------
export function createAlert(level: Alert['level'], rule: number | null, title: string, body: string, note: string | null = null): Alert {
  const alert: Alert = { id: `al_${randomUUID()}`, level, rule, title, body, grandma_note: note, created_at: now(), archived: false };
  put('alerts', alert.id, alert);
  if (level === 'red' || level === 'normal') toGuardian({ type: 'alert', ...alert });
  return alert;
}
/** The emergency card follows the outcome (911 called / stopped): rewrite the action line and push it again. */
export function updateAlert(id: string, body: string): void {
  const alert = get('alerts', id);
  if (!alert) return;
  alert.body = body;
  put('alerts', id, alert);
  if (alert.level === 'red' || alert.level === 'normal') toGuardian({ type: 'alert', ...alert });
}
/** Deepgram split one scam sentence in two: add the second half to the same alert instead of raising another. */
export function extendAlert(id: string, text: string): void {
  const alert = get('alerts', id);
  if (!alert) return;
  alert.body = `${alert.body} ${text}`.trim();
  put('alerts', id, alert);
  if (alert.level === 'red') toGuardian({ type: 'alert', ...alert });
}
export function saveGrandmaNote(id: string, note: string): void {
  const alert = get('alerts', id);
  if (!alert) return;
  alert.grandma_note = note;
  put('alerts', id, alert);
  if (alert.level === 'red') toGuardian({ type: 'alert', ...alert });
}
