import { DAY, timestamp } from './clock.ts';
import type { Alert, Memory, Order, Product } from './types.ts';
export interface Finding {rule: number; level: Alert['level']; title: string; body: string;}
export interface CognitiveEvent {
  kind: 'order_question' | 'denies_purchase' | 'wrong_wake_name' | 'correct_wake_name';
  at: string; orderId?: string;
}
export interface RuleContext {
  now: string; products: Product[]; orders: Order[]; memories: Memory[]; candidate?: Order;
  coldStart?: boolean; intentionalStockup?: boolean; holidayWithin14Days?: boolean;
  scam?: boolean; text?: string;
  blockedAttempts?: {product_id: string; at: string}[];
  cognition?: CognitiveEvent[];
}
function quantile(values: number[], p: number): number {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = (a.length - 1) * p, low = Math.floor(i);
  return a[low] + (a[Math.ceil(i)] - a[low]) * (i - low);
}
const paid = (o: Order) => o.status === 'paid' || o.status === 'simulated_paid';
/** C remains the authoritative risk classifier; this fallback is useful for deterministic fixtures. */
export function isScamText(text: string): boolean {
  return /gift\s*cards?|wire\s+(?:money|transfer)|someone\s+(?:called|(?:told|asked)\s+me)|(?:must|have to|need to)\s+(?:buy|pay).*today|buy\s+(?:it\s+)?for\s+him|礼品卡|转账|有人让我买|电话里说|帮他买|今天必须/i.test(text);
}
export function evaluateRules(context: RuleContext): Finding[] {
  const now = Date.parse(timestamp(context.now));
  const history = context.orders.filter(o => paid(o) && o.id !== context.candidate?.id && Date.parse(o.created_at) <= now);
  const candidate = context.candidate && paid(context.candidate) && Date.parse(context.candidate.created_at) <= now ? context.candidate : undefined;
  const all = candidate ? [...history, candidate] : history;
  const inDays = (o: Order, days: number) => Date.parse(o.created_at) > now - days * DAY && Date.parse(o.created_at) <= now;
  const cold = context.coldStart ?? (history.length < 10 || !history.some(o => Date.parse(o.created_at) <= now - 30 * DAY));
  const findings: Finding[] = [];
  const add = (rule: number, level: 'red' | 'yellow', body: string) => {
    if (cold && ![1, 4, 7, 8].includes(rule)) return;
    if (context.holidayWithin14Days && [3, 5].includes(rule)) return;
    findings.push({rule, level, title: 'Check on Mom', body});
  };
  if (candidate) {
    const product = context.products.find(p => p.id === candidate.product_id);
    const memory = context.memories.find(m => m.product_id === candidate.product_id && !m.paused);
    const daily = memory ? memory.units_per_dose * memory.times.length : 0;
    const hasPrevious = history.some(o => o.product_id === candidate.product_id);
    const stockDays = memory && daily > 0 ? memory.stock_units / daily : 0;
    const halfPack = product && daily > 0 && stockDays > product.units / daily * 0.5;
    const third = all.filter(o => o.product_id === candidate.product_id && inDays(o, 7)).length >= 3;
    if (stockDays >= 90 || (!context.intentionalStockup && ((hasPrevious && halfPack) || third))) {
      add(1, 'red', 'Repeated purchases or a large supply may need a check-in.');
    }
    // Three complete UTC calendar months preceding this month form the baseline.
    const date = new Date(now), monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const earliest = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 3, 1);
    if (history.some(o => Date.parse(o.created_at) <= earliest + DAY)) {
      const months = [3, 2, 1].map(back => {
        const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - back, 1);
        const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - back + 1, 1);
        return history.filter(o => Date.parse(o.created_at) >= start && Date.parse(o.created_at) < end).reduce((sum, o) => sum + o.price_cents, 0);
      });
      const median = quantile(months, 0.5), mad = quantile(months.map(v => Math.abs(v - median)), 0.5);
      const total = all.filter(o => inDays(o, 30)).reduce((sum, o) => sum + o.price_cents, 0);
      if (total > median + 3 * mad && total > 2 * median) add(2, 'red', 'Recent spending is much higher than the usual monthly pattern.');
    }
    const weeklyBaseline = history.filter(o => Date.parse(o.created_at) > now - 90 * DAY && Date.parse(o.created_at) <= now - 7 * DAY).length / (83 / 7);
    if (all.filter(o => inDays(o, 7)).length >= Math.max(4, 3 * weeklyBaseline)) add(3, 'yellow', 'Shopping has become more frequent this week.');
    const prices = history.map(o => o.price_cents);
    if (prices.length && candidate.price_cents > 10000 && candidate.price_cents > 3 * quantile(prices, 0.5)) {
      add(4, 'yellow', 'A purchase is unusually large compared with previous purchases.');
    }
    const category = (o: Order) => context.products.find(p => p.id === o.product_id)?.category;
    const candidateCategory = category(candidate);
    const previousCategories = new Set(history.map(category));
    const oldCategories = new Set(history.filter(o => !inDays(o, 7)).map(category));
    const newCategories = new Set(all.filter(o => inDays(o, 7)).map(category).filter(c => c && !oldCategories.has(c)));
    if (candidateCategory && !previousCategories.has(candidateCategory)
      && ((prices.length > 0 && candidate.price_cents > quantile(prices, 0.9)) || newCategories.size >= 2)) {
      add(5, 'yellow', 'Shopping includes an unfamiliar category alongside another unusual pattern.');
    }
    const hour = (at: string) => { const d = new Date(at); return d.getUTCHours() + d.getUTCMinutes() / 60; };
    const hours = history.map(o => hour(o.created_at)), h = hour(candidate.created_at);
    if (hours.length && (h < quantile(hours, 0.05) || h > quantile(hours, 0.95) || h >= 23 || h < 5)) {
      add(6, 'yellow', 'A purchase happened outside the usual shopping hours.');
    }
  }
  const attempts = (context.blockedAttempts ?? []).filter(a => Date.parse(a.at) > now - DAY && Date.parse(a.at) <= now);
  const counts = new Map<string, number>();
  for (const a of attempts) counts.set(a.product_id, (counts.get(a.product_id) ?? 0) + 1);
  if (context.scam || isScamText(context.text ?? '') || [...counts.values()].some(n => n >= 2)) {
    add(7, 'red', 'A request suggests possible pressure or a scam. Please check in.');
  }
  const cognition = (context.cognition ?? []).filter(e => Date.parse(e.at) <= now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const today = cognition.filter(e => e.at.slice(0, 10) === context.now.slice(0, 10));
  const questions = new Map<string, number>();
  for (const e of today) if (e.kind === 'order_question' && e.orderId && history.some(o => o.id === e.orderId)) questions.set(e.orderId, (questions.get(e.orderId) ?? 0) + 1);
  const denial = today.some(e => e.kind === 'denies_purchase' && history.some(o => o.id === e.orderId));
  const names = cognition.filter(e => e.kind === 'wrong_wake_name' || e.kind === 'correct_wake_name').slice(-3);
  if ([...questions.values()].some(n => n >= 3) || denial || (names.length === 3 && names.every(e => e.kind === 'wrong_wake_name'))) {
    add(8, 'red', 'Repeated confusion during recent interactions may need a check-in.');
  }
  return findings;
}
