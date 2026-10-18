import { randomUUID } from 'node:crypto';
import { all, get, getSettings } from '../db.js';
import { now } from '../clock.js';
import { toGuardian } from '../bus.js';
import type { Order, Product, Settings } from '../contracts.js';
import { orderSchema } from '../contracts.js';

export interface CheckResult { ok: boolean; reason: string | null; alternative?: Product }
export interface PaymentResult { status: 'paid' | 'simulated_paid'; ref: string }
export function isScam(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(/[‐‑–—-]/g, ' ').replace(/\s+/g, ' ');
  return /\bgift\s*cards?\b|\b(?:wire|bank|money)\s+transfer\b|\bsend\s+money\b|\bsomeone\s+called\b|礼品卡|转账|有人打电话|今天必须/i.test(normalized)
    || /\b(?:must|have to|need to)\b[^.!?]{0,100}\btoday\b|\btoday\b[^.!?]{0,100}\b(?:must|have to|need to)\b/i.test(normalized);
}
// The pipeline creates rule-7 alerts through D,
// so check stays repeatable (it is called again immediately before payment).
export function check(product_id: string | null, text: string): CheckResult {
  if (isScam(text)) return { ok: false, reason: 'scam' };
  const product = product_id ? get('products', product_id) : undefined;
  if (!product) return { ok: false, reason: 'off_shelf' };
  if (!product.risk) return { ok: true, reason: null };
  const alternative = get('products', product.risk.alternative_id);
  return { ok: false, reason: product.risk.kind, ...(alternative && !alternative.risk ? { alternative } : {}) };
}
export async function pay(order: Order): Promise<PaymentResult> {
  orderSchema.strict().parse(order);
  if (!order.id.trim() || order.received || order.status === 'blocked' || order.block_reason !== null) {
    throw new Error('Order is not eligible for payment');
  }
  const product = get('products', order.product_id);
  if (!product || !check(order.product_id, '').ok) throw new Error('Product is not eligible for payment');
  if (order.price_cents !== product.price_cents) throw new Error('Order price does not match the shelf');
  // No external payment call. A future provider must throw on failure, never
  // silently convert a failed sandbox charge into a successful simulation.
  return { status: 'simulated_paid', ref: `sim_${randomUUID()}` };
}
export function visibleOrders(orders: Order[], level: Settings['share_level']): Order[] {
  return level === 'open' ? orders : orders.filter(order => order.status === 'blocked' || order.block_reason !== null);
}
export function ledger(): { share_level: Settings['share_level']; month_total_cents: number | null; orders: Order[] } {
  const level = getSettings().share_level;
  const orders = all('orders');
  const month = now().slice(0, 7);
  return {
    share_level: level,
    // Keep the mock's envelope; null means this total is intentionally withheld.
    month_total_cents: level === 'minimum' ? null : orders.filter(o => o.created_at.slice(0, 7) === month && o.status !== 'blocked').reduce((sum, o) => sum + o.price_cents, 0),
    orders: visibleOrders(orders, level),
  };
}
export function publishOrder(order: Order): void {
  if (visibleOrders([order], getSettings().share_level).length) toGuardian({ type: 'order', ...order });
}
