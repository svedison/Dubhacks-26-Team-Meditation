import { randomUUID } from 'node:crypto';
import { all, get, getSettings } from '../db.js';
import { now } from '../clock.js';
import { toGuardian } from '../bus.js';
import type { Order, Product, Settings } from '../contracts.js';

export interface CheckResult { ok: boolean; reason: string | null; alternative?: Product }
export function isScam(text: string): boolean {
  return /\bgift\s*cards?\b|\bwire\s+transfer\b|\bsomeone\s+called\b|\btoday\b|礼品卡|转账|有人打电话|今天必须/i.test(text);
}
// C replaces these two adapters. The pipeline creates rule-7 alerts through D,
// so check stays repeatable (it is called again immediately before payment).
export function check(product_id: string | null, text: string): CheckResult {
  if (isScam(text)) return { ok: false, reason: 'scam' };
  const product = product_id ? get('products', product_id) : undefined;
  if (!product) return { ok: false, reason: 'off_shelf' };
  if (!product.risk) return { ok: true, reason: null };
  const alternative = get('products', product.risk.alternative_id);
  return { ok: false, reason: product.risk.kind, ...(alternative && !alternative.risk ? { alternative } : {}) };
}
export async function pay(order: Order): Promise<{ status: 'simulated_paid'; ref: string }> {
  if (!check(order.product_id, '').ok) throw new Error('Product is not eligible for payment');
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
