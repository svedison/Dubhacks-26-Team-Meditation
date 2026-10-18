export const DAY = 86_400_000;
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))
    || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) {
    throw new Error('Expected a valid ISO timestamp with timezone');
  }
  return new Date(value).toISOString();
}
export class DemoClock {
  private offset: number;
  private wall: () => number;
  constructor(offset: number, wall: () => number = Date.now) { this.offset = offset; this.wall = wall; }
  now(): string { return new Date(this.wall() + this.offset).toISOString(); }
  set(value: string): number { this.offset = Date.parse(timestamp(value)) - this.wall(); return this.offset; }
}
