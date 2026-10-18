import { performance } from 'node:perf_hooks';
import { toAll } from './bus.js';
import { DEMO_START } from './seed.js';

let base = Date.parse(DEMO_START);
let realBase = performance.now();
export const now = (): string => new Date(base + performance.now() - realBase).toISOString();
export type TickHandler = (prevNow: string, now: string) => void | Promise<void>;
const handlers = new Set<TickHandler>();
let previous = now();
let timer: ReturnType<typeof setInterval> | undefined;
let pending = Promise.resolve();
let generation = 0;
export function onTick(handler: TickHandler): () => void { handlers.add(handler); return () => { handlers.delete(handler); }; }
// `clock` is broadcast only when the demo clock is set or reset (and on connect in index.ts),
// matching the mock server; the 1 s timer only drives tick handlers.
function dispatch(current: string, broadcast = false): Promise<void> {
  const prev = previous;
  previous = current;
  const version = generation;
  if (broadcast) toAll({ type: 'clock', now: current });
  pending = pending.then(async () => {
    if (version !== generation) return;
    for (const handler of handlers) {
      try { await handler(prev, current); }
      catch { console.warn('Clock tick handler failed'); }
    }
  });
  return pending;
}
export async function setClock(value: string): Promise<string> {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Invalid clock');
  base = parsed;
  realBase = performance.now();
  const current = now();
  await dispatch(current, true); // Same path as the real timer, including forward jumps.
  return current;
}
export function resetClock(): void {
  generation++;
  base = Date.parse(DEMO_START);
  realBase = performance.now();
  previous = now(); // Reset is not a delivery/reminder time crossing.
  toAll({ type: 'clock', now: previous });
}
export function startClock(): void {
  if (timer) return;
  timer = setInterval(() => { void dispatch(now()); }, 1_000);
  timer.unref();
}
export function stopClock(): void { if (timer) clearInterval(timer); timer = undefined; }
