import { randomUUID } from 'node:crypto';
import { DAY, DemoClock, timestamp, validDate } from './clock.ts';
import { PRODUCTS, seed } from './seed.ts';
import type { Answer, Event, EventSink, Memory, Occurrence, Order, Prompt, State, Store } from './types.ts';

export interface ReplyContext { kind: Prompt['kind']; ref: string; at?: string; }
export interface Options {
  store: Store; emit?: EventSink; wallNow?: () => number;
  responseWindowMs?: number; snoozeMs?: number; refillLeadDays?: number; lateReplyWindowMs?: number;
}
const key = (id: string, at: string) => `${id}@${at}`;
const yes = /^(yes\b|yeah\b|yep\b|okay\b|ok\b|sure\b|got it\b|i (?:got|received)\b|received\b|是|好|拿到了|收到了)/i;
const no = /^(no\b|not yet\b|nope\b|没有|没拿到|不)/i;
export function parseAnswer(text: string): Answer | null {
  if (/\b(later|snooze|remind me later)\b|稍后|等会/i.test(text)) return 'later';
  if (/\b(skip|skipped|didn['’]?t take|did not take|haven['’]?t taken|have not taken)\b|没吃|跳过/i.test(text)) return 'skipped';
  if (/^(taken\b|took it\b|i took\b|yes\b|已服用|吃过了|吃了)/i.test(text)) return 'taken';
  return null;
}
export class MemoryService {
  protected state: State;
  protected store: Store;
  protected emit: EventSink;
  protected clock: DemoClock;
  protected wallNow: () => number;
  protected responseWindowMs: number;
  protected snoozeMs: number;
  protected refillLeadDays: number;
  protected lateReplyWindowMs: number;
  constructor(options: Options) {
    this.store = options.store; this.emit = options.emit ?? (() => {});
    this.wallNow = options.wallNow ?? Date.now;
    this.responseWindowMs = options.responseWindowMs ?? 60_000;
    this.snoozeMs = options.snoozeMs ?? 15 * 60_000;
    this.refillLeadDays = options.refillLeadDays ?? 3;
    this.lateReplyWindowMs = options.lateReplyWindowMs ?? 300_000;
    for (const value of [this.responseWindowMs, this.snoozeMs, this.refillLeadDays, this.lateReplyWindowMs]) {
      if (!Number.isFinite(value) || value <= 0) throw new Error('Timing options must be positive');
    }
    this.state = this.store.load() ?? seed(this.wallNow());
    this.state.expiredPrompts ??= [];
    this.clock = new DemoClock(this.state.clockOffsetMs, this.wallNow);
    this.save();
  }
  now(): string { return this.clock.now(); }
  snapshot(): State { return structuredClone(this.state); }
  products() { return structuredClone(PRODUCTS); }
  protected save(): void { this.store.save(this.state); }
  protected publish(audience: 'elder' | 'guardian' | 'all', event: Event): void {
    this.save(); this.emit(audience, structuredClone(event));
  }
  protected say(text: string): void { this.publish('elder', {type: 'speak', text, audio_url: null}); }
  reset(): void {
    this.state = seed(this.wallNow()); this.clock = new DemoClock(this.state.clockOffsetMs, this.wallNow);
    this.publish('all', {type: 'clock', now: this.now()});
    this.publish('elder', {type: 'state', state: 'idle'});
  }
  setClock(value: string): string {
    this.state.clockOffsetMs = this.clock.set(value);
    this.publish('all', {type: 'clock', now: this.now()}); this.tick(); return this.now();
  }
  addOrder(order: Order): Order {
    if (!order || !order.id || !PRODUCTS.some(p => p.id === order.product_id)
      || !['paid', 'simulated_paid', 'blocked'].includes(order.status)
      || !Number.isSafeInteger(order.price_cents) || order.price_cents < 0
      || !validDate(order.deliver_on) || typeof order.received !== 'boolean') throw new Error('Invalid order');
    timestamp(order.created_at);
    const existing = this.state.orders.find(o => o.id === order.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(order)) throw new Error('Order id already exists');
      return structuredClone(existing);
    }
    if (order.received) throw new Error('Register orders before receipt; use receiveOrder to credit inventory');
    this.state.orders.push(structuredClone(order)); this.save(); return structuredClone(order);
  }
  private queue(prompt: Prompt): void {
    if (!this.state.prompts.some(p => p.kind === prompt.kind && p.ref === prompt.ref && p.at === prompt.at)) {
      this.state.prompts.push(prompt);
    }
  }
  protected dispatch(): void {
    if (this.state.noteQueue.length || this.state.prompts.some(p => p.askedAt)) return;
    const now = this.now();
    const prompt = this.state.prompts.find(p => p.readyAt <= now);
    if (!prompt) return;
    let text: string;
    if (prompt.kind === 'received' || prompt.kind === 'dose_confirm') {
      const order = this.state.orders.find(o => o.id === prompt.ref)!;
      const product = PRODUCTS.find(p => p.id === order.product_id)!;
      text = prompt.kind === 'received'
        ? `Your ${product.name} is due to arrive. Did you get it?`
        : `The label says ${product.label_dose}. Start today, and remind you every morning at eight. Okay?`;
    } else {
      const memory = this.state.memories.find(m => m.id === prompt.ref)!;
      const product = PRODUCTS.find(p => p.id === memory.product_id)!;
      text = `Time for your ${product.name}: ${memory.dose_text}. Have you taken it?`;
    }
    prompt.askedAt = now;
    this.publish('elder', {type: 'ask', kind: prompt.kind, text, audio_url: null});
  }
  receiveOrder(id: string): Order {
    const order = this.state.orders.find(o => o.id === id);
    if (!order) throw new Error('Order not found');
    if (order.status === 'blocked') throw new Error('Blocked order cannot be received');
    if (this.state.receivedOrders.includes(id)) return structuredClone(order);
    const product = PRODUCTS.find(p => p.id === order.product_id)!;
    order.received = true; this.state.receivedOrders.push(id);
    this.state.prompts = this.state.prompts.filter(p => !(p.ref === id && p.kind === 'received'));
    const memory = this.state.memories.find(m => m.product_id === order.product_id);
    if (memory) {
      memory.stock_units += product.units; delete this.state.refills[memory.id];
      this.publish('guardian', {type: 'memory', ...memory});
    } else {
      this.state.inventory[product.id] = (this.state.inventory[product.id] ?? 0) + product.units;
      if (product.label_dose && !product.risk) this.queue({kind: 'dose_confirm', ref: id, readyAt: this.now()});
    }
    this.publish('guardian', {type: 'order', ...order}); this.dispatch(); return structuredClone(order);
  }
  private confirmDose(orderId: string): void {
    const order = this.state.orders.find(o => o.id === orderId)!;
    const product = PRODUCTS.find(p => p.id === order.product_id)!;
    if (this.state.memories.some(m => m.product_id === product.id)) return;
    const memory: Memory = {id: `mem_${randomUUID()}`, product_id: product.id,
      dose_text: product.label_dose!, times: ['08:00'], start_date: this.now().slice(0, 10), end_date: null,
      stock_units: this.state.inventory[product.id] ?? 0, units_per_dose: product.units_per_dose,
      paused: false, log: []};
    delete this.state.inventory[product.id];
    this.state.memories.push(memory); this.state.memorySince[memory.id] = this.now();
    this.publish('guardian', {type: 'memory', ...memory});
  }
  private promptProduct(prompt: Prompt) {
    const productId = prompt.kind === 'reminder'
      ? this.state.memories.find(m => m.id === prompt.ref)?.product_id
      : this.state.orders.find(o => o.id === prompt.ref)?.product_id;
    return PRODUCTS.find(p => p.id === productId);
  }
  private mentionedProducts(text: string): Set<string> {
    const normalized = text.toLowerCase();
    const tokens = (name: string): string[] => name.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const words = new Set(tokens(normalized));
    return new Set(PRODUCTS.filter(product => {
      if ([product.name, ...product.aliases].some(name => normalized.includes(name.toLowerCase()))) return true;
      // Only distinctive catalog words can identify a product: e.g. calcium, tea, glucosamine.
      return tokens(product.name).some(word => words.has(word)
        && PRODUCTS.filter(p => tokens(p.name).includes(word)).length === 1);
    }).map(p => p.id));
  }
  handleAnswer(text: string, context?: ReplyContext): boolean {
    if (typeof text !== 'string' || !text.trim()) return false;
    this.tick(); // enforce deadlines even when a reply beats the one-second interval callback
    const active = this.state.prompts.find(p => p.askedAt);
    const available = [...(active ? [active] : []), ...this.state.expiredPrompts];
    let prompt: Prompt | undefined = active;
    if (context) {
      prompt = available.find(p => p.kind === context.kind && p.ref === context.ref && p.at === context.at);
      if (!prompt) return false;
    } else {
      const mentioned = this.mentionedProducts(text);
      if (mentioned.size) {
        const matches = available.filter(p => mentioned.has(this.promptProduct(p)?.id ?? ''));
        const identities = new Map(matches.map(p => [`${p.kind}:${p.ref}:${p.at ?? ''}`, p]));
        if (identities.size !== 1) {
          this.say('Please confirm the product and which reminder or delivery you mean.'); return true;
        }
        prompt = [...identities.values()][0];
      } else if (this.state.expiredPrompts.length || (this.state.replyBarrierUntil && this.now() < this.state.replyBarrierUntil)) {
        if (!yes.test(text.trim()) && !no.test(text.trim()) && !parseAnswer(text.trim())) return false;
        this.say('Please include the product name so I record your answer for the right delivery or reminder.'); return true;
      }
    }
    if (!prompt) return false;
    if (prompt.kind === 'reminder') {
      const answer = parseAnswer(text.trim()); if (!answer) return false;
      this.answerReminder(prompt.ref, prompt.at!, answer); return true;
    }
    if (!yes.test(text.trim()) && !no.test(text.trim())) return false;
    this.state.prompts = this.state.prompts.filter(p => p !== prompt);
    this.state.expiredPrompts = this.state.expiredPrompts.filter(p => p !== prompt);
    if (yes.test(text.trim())) {
      if (prompt.kind === 'received') this.receiveOrder(prompt.ref);
      else this.confirmDose(prompt.ref);
    } else if (prompt.kind === 'received') {
      this.state.deliveryAsked[prompt.ref] = this.now().slice(0, 10);
      this.say("Okay. I'll ask again tomorrow.");
    } else {
      this.say("Okay. I won't start reminders without your confirmation.");
    }
    // Re-state the current question after correcting a previous answer.
    if (active && active !== prompt) delete active.askedAt;
    this.save(); this.dispatch(); return true;
  }
  private setAnswer(occurrence: Occurrence, answer: Answer): void {
    const memory = this.state.memories.find(m => m.id === occurrence.memoryId)!;
    const debit = answer === 'taken' || answer === 'unconfirmed';
    const alreadyAccounted = occurrence.answer === 'taken' || occurrence.answer === 'unconfirmed';
    if (debit && !alreadyAccounted) {
      occurrence.debited = Math.min(memory.stock_units, occurrence.units);
      memory.stock_units -= occurrence.debited;
    } else if (!debit && alreadyAccounted) {
      memory.stock_units += occurrence.debited; occurrence.debited = 0;
    }
    occurrence.answer = answer;
    const log = memory.log.find(l => l.at === occurrence.at);
    if (log) log.answer = answer; else memory.log.push({at: occurrence.at, answer});
    this.publish('guardian', {type: 'memory', ...memory}); this.checkRefill(memory);
  }
  answerReminder(memoryId: string, at: string, answer: Answer): void {
    if (!['taken', 'skipped', 'later', 'unconfirmed'].includes(answer)) throw new Error('Invalid reminder answer');
    const occurrence = this.state.occurrences[key(memoryId, timestamp(at))];
    if (!occurrence || occurrence.cancelled) throw new Error('Reminder not found or cancelled');
    if (occurrence.answer === answer && answer !== 'later') return;
    this.state.prompts = this.state.prompts.filter(p => !(p.kind === 'reminder' && p.ref === memoryId && p.at === occurrence.at));
    this.state.expiredPrompts = this.state.expiredPrompts.filter(p => !(p.ref === memoryId && p.at === occurrence.at));
    delete occurrence.snoozeAt;
    if (answer === 'later') occurrence.snoozeAt = new Date(Date.parse(this.now()) + this.snoozeMs).toISOString();
    this.setAnswer(occurrence, answer);
    const memory = this.state.memories.find(m => m.id === memoryId)!;
    const days = this.remainingDays(memory);
    if (answer !== 'unconfirmed') this.say(answer === 'later'
      ? `I'll remind you later. Your supply is estimated to last ${days} days.`
      : `Recorded. Your supply is estimated to last ${days} days.`);
    this.save(); this.dispatch();
  }
  remainingDays(memory: Memory): number {
    return Math.round(memory.stock_units / (memory.units_per_dose * memory.times.length) * 10) / 10;
  }
  private checkRefill(memory: Memory): void {
    const days = this.remainingDays(memory);
    if (days >= this.refillLeadDays) { delete this.state.refills[memory.id]; return; }
    if (memory.end_date) {
      const remainingDates = Math.max(0, (Date.parse(memory.end_date) - Date.parse(this.now().slice(0, 10))) / DAY + 1);
      if (days >= remainingDates) return;
    }
    if (this.state.refills[memory.id]) return;
    const alert = {id: `al_${randomUUID()}`, level: 'normal' as const, rule: 0,
      title: 'Refill note', body: `${PRODUCTS.find(p => p.id === memory.product_id)!.name}: estimated ${days} days remaining. Based on received packs and the confirmed schedule; unconfirmed doses count toward estimated use.`,
      grandma_note: null, created_at: this.now(), archived: false};
    this.state.alerts.push(alert); this.state.refills[memory.id] = {alertId: alert.id, offered: false};
    this.publish('guardian', {type: 'alert', ...alert});
  }
  takeRefillSuggestion(): string | null {
    for (const [memoryId, refill] of Object.entries(this.state.refills)) {
      const memory = this.state.memories.find(m => m.id === memoryId);
      if (!memory || memory.paused || refill.offered) continue;
      refill.offered = true; this.save();
      return `Your ${PRODUCTS.find(p => p.id === memory.product_id)!.name} is estimated to last ${this.remainingDays(memory)} days. Would you like to buy another pack?`;
    }
    return null;
  }
  updateMemory(id: string, patch: Partial<Memory>): Memory {
    const memory = this.state.memories.find(m => m.id === id);
    if (!memory) throw new Error('Memory not found');
    const allowed = ['dose_text', 'times', 'start_date', 'end_date', 'stock_units', 'units_per_dose', 'paused'];
    if (!patch || typeof patch !== 'object' || Object.keys(patch).some(k => !allowed.includes(k))) throw new Error('Invalid memory fields');
    const next = {...memory, ...structuredClone(patch)};
    if (!Array.isArray(next.times) || !next.times.length || next.times.length > 24
      || next.times.some(t => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
      || new Set(next.times).size !== next.times.length
      || !Number.isFinite(next.stock_units) || next.stock_units < 0
      || !Number.isFinite(next.units_per_dose) || next.units_per_dose <= 0
      || typeof next.paused !== 'boolean' || typeof next.dose_text !== 'string' || !next.dose_text.trim()
      || !validDate(next.start_date) || (next.end_date !== null && (!validDate(next.end_date) || next.end_date < next.start_date))) {
      throw new Error('Invalid memory schedule or inventory');
    }
    const scheduleChanged = Object.keys(patch).length > 0;
    if (scheduleChanged) {
      this.cancelMemoryPrompts(id); this.state.memorySince[id] = this.now();
    }
    Object.assign(memory, next);
    if (this.remainingDays(memory) >= this.refillLeadDays) delete this.state.refills[id];
    this.publish('all', {type: 'memory', ...memory}); this.dispatch(); return structuredClone(memory);
  }
  private cancelMemoryPrompts(id: string): void {
    this.state.expiredPrompts = this.state.expiredPrompts.filter(p => !(p.kind === 'reminder' && p.ref === id));
    this.state.prompts = this.state.prompts.filter(p => !(p.kind === 'reminder' && p.ref === id));
    for (const occurrence of Object.values(this.state.occurrences)) {
      if (occurrence.memoryId === id && (occurrence.answer === null || occurrence.answer === 'later')) {
        occurrence.cancelled = true; delete occurrence.snoozeAt;
      }
    }
  }
  deleteMemory(id: string): void {
    const memory = this.state.memories.find(m => m.id === id);
    if (!memory) throw new Error('Memory not found');
    this.cancelMemoryPrompts(id);
    this.state.memories = this.state.memories.filter(m => m.id !== id);
    delete this.state.refills[id]; delete this.state.memorySince[id];
    // No tombstone exists in the shared contract. B's DELETE route should trigger a GET refresh.
    this.save(); this.dispatch();
  }
  tick(): void {
    const now = this.now();
    if (now < this.state.lastTick) return; // watermark never moves backwards
    const nowMs = Date.parse(now);
    this.state.expiredPrompts = this.state.expiredPrompts.filter(p => nowMs - Date.parse(p.expiredAt) < this.lateReplyWindowMs);
    for (const prompt of [...this.state.prompts]) {
      if (prompt.askedAt && nowMs - Date.parse(prompt.askedAt) >= this.responseWindowMs) {
        const expiredAt = new Date(Date.parse(prompt.askedAt) + this.responseWindowMs).toISOString();
        if (nowMs - Date.parse(expiredAt) < this.lateReplyWindowMs) this.state.expiredPrompts.push({...prompt, expiredAt});
        this.state.prompts = this.state.prompts.filter(p => p !== prompt);
        if (prompt.kind === 'reminder') {
          const occurrence = this.state.occurrences[key(prompt.ref, prompt.at!)]!;
          if (!occurrence.cancelled) this.setAnswer(occurrence, 'unconfirmed');
        } else if (prompt.kind === 'received') this.state.deliveryAsked[prompt.ref] = now.slice(0, 10);
      }
    }
    for (const memory of this.state.memories) {
      if (memory.paused) continue;
      const since = [this.state.lastTick, this.state.memorySince[memory.id] ?? this.state.lastTick].sort().at(-1)!;
      const firstDate = [since.slice(0, 10), memory.start_date].sort().at(-1)!;
      const lastDate = memory.end_date && memory.end_date < now.slice(0, 10) ? memory.end_date : now.slice(0, 10);
      for (let day = Date.parse(firstDate); day <= Date.parse(lastDate); day += DAY) {
        for (const time of memory.times) {
          const at = `${new Date(day).toISOString().slice(0, 10)}T${time}:00.000Z`;
          if (at <= since || at > now || this.state.occurrences[key(memory.id, at)]) continue;
          const occurrence: Occurrence = {memoryId: memory.id, at, units: memory.units_per_dose, debited: 0, answer: null};
          this.state.occurrences[key(memory.id, at)] = occurrence;
          if (nowMs - Date.parse(at) >= this.responseWindowMs) this.setAnswer(occurrence, 'unconfirmed');
          else this.queue({kind: 'reminder', ref: memory.id, at, readyAt: at});
        }
      }
    }
    for (const occurrence of Object.values(this.state.occurrences)) {
      if (occurrence.cancelled || !occurrence.snoozeAt || occurrence.snoozeAt > now) continue;
      const readyAt = occurrence.snoozeAt; delete occurrence.snoozeAt;
      if (nowMs - Date.parse(readyAt) >= this.responseWindowMs) this.setAnswer(occurrence, 'unconfirmed');
      else this.queue({kind: 'reminder', ref: occurrence.memoryId, at: occurrence.at, readyAt});
    }
    // Expire reminders queued behind another conversation too, never consume a future reply for a stale dose.
    for (const prompt of [...this.state.prompts]) {
      if (prompt.kind === 'reminder' && !prompt.askedAt && nowMs - Date.parse(prompt.readyAt) >= this.responseWindowMs) {
        this.state.prompts = this.state.prompts.filter(p => p !== prompt);
        this.setAnswer(this.state.occurrences[key(prompt.ref, prompt.at!)]!, 'unconfirmed');
      }
    }
    for (const order of this.state.orders) {
      if (order.received || order.status === 'blocked' || order.deliver_on > now.slice(0, 10)
        || this.state.deliveryAsked[order.id] === now.slice(0, 10)) continue;
      this.state.deliveryAsked[order.id] = now.slice(0, 10);
      this.queue({kind: 'received', ref: order.id, readyAt: now});
    }
    this.state.lastTick = now; this.save(); this.dispatch();
  }
}
