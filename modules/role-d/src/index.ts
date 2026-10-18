import { RoleDService } from './alerts.ts';
import type { Options } from './memory.ts';
export function createRoleD(options: Options) { return new RoleDService(options); }
export { SqliteStore } from './store.ts';
export { evaluateRules, isScamText } from './anomalies.ts';
export { DemoClock } from './clock.ts';
export type { Options, ReplyContext } from './memory.ts';
export type { Finding, RuleContext } from './anomalies.ts';
export type * from './types.ts';
