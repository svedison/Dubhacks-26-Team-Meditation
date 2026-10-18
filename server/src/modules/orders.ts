import { orderSchema, type Order } from '../contracts.js';
import { get, put, transaction } from '../db.js';
import { pay, publishOrder } from './risk.js';

const inFlight = new Map<string, { intent: string; result: Promise<Order | null> }>();

function paymentIntent(order: Order): string {
  return JSON.stringify([order.product_id, order.price_cents, order.created_at, order.deliver_on]);
}
function previousOrder(draft: Order): Order | undefined {
  const existing = get('orders', draft.id);
  if (!existing) return undefined;
  if (paymentIntent(existing) !== paymentIntent(draft)) throw new Error('Order ID has a different payment intent');
  if (existing.status === 'blocked' || existing.block_reason !== null || !get('kv', `payment:${draft.id}`)) {
    throw new Error('Existing order has no successful payment reference');
  }
  return existing;
}

// Caller supplies a stable order ID and retains consent/generation ownership.
// Payment references are private; only the contract Order is returned/published.
export async function placeOrder(input: Order, isCurrent: () => boolean = () => true): Promise<Order | null> {
  const draft = orderSchema.strict().parse(input); // Snapshot before the first await.
  if (!isCurrent()) return null;
  const previous = previousOrder(draft);
  if (previous) return previous;
  const intent = paymentIntent(draft);
  const active = inFlight.get(draft.id);
  if (active) {
    if (active.intent !== intent) throw new Error('Order ID has a different payment intent');
    return active.result;
  }
  const result = (async (): Promise<Order | null> => {
    const payment = await pay(draft);
    if (!isCurrent()) return null; // A debug reset invalidated this simulation.
    const order: Order = { ...draft, status: payment.status, ...(payment.check ? { payment_check: payment.check } : {}) };
    transaction(() => {
      put('orders', order.id, order);
      put('kv', `payment:${order.id}`, payment.ref);
    });
    publishOrder(order);
    return order;
  })();
  inFlight.set(draft.id, { intent, result });
  try { return await result; }
  finally { inFlight.delete(draft.id); }
}
