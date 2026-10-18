import { performance } from 'node:perf_hooks';
import { toAll } from './bus.js';
import { DEMO_START } from './seed.js';

// The demo clock is a wall clock. Its ISO strings end in Z, but the digits are Seattle wall time: both frontends show
// them as written (setZone), D's "08:00" reminders fire at 8 in the morning on it, the ledger month and deliver_on
// dates are its dates. Nothing compares it with the real instant. So "now" means the wall clock in Seattle right now,
// read as if it were UTC; `/debug/clock` moves it for the delivery and reminder scenes.
const ZONE = 'America/Los_Angeles';
const wall = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** Seattle's wall clock at the instant `at`, as the milliseconds of the same digits read as UTC (PDT or PST as the date demands). */
export function seattleWallNow(at = Date.now()): number {
  const part: Record<string, number> = {};
  for (const { type, value } of wall.formatToParts(new Date(at))) if (type !== 'literal') part[type] = Number(value);
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second, at % 1000);
}
/** Where the clock starts on boot and after /debug/reset: Seattle now, unless pinned (tests pin 2026-10-17 18:00; Render could too). */
export function startingPoint(): number {
  const pinned = Date.parse(process.env.DEMO_CLOCK_START ?? '');
  if (Number.isFinite(pinned)) return pinned;
  if (process.env.NODE_TEST_CONTEXT) return Date.parse(DEMO_START); // a test file run on its own stays deterministic
  return seattleWallNow();
}
let base = startingPoint();
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
  base = startingPoint();
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
