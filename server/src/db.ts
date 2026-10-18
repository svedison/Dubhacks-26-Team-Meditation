import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { serverRoot } from './config.js';
import type { Alert, Memory, Order, Product, Settings } from './contracts.js';
import { defaultSettings, historicalOrder, shelfSeed } from './seed.js';

interface Tables { products: Product; orders: Order; memories: Memory; alerts: Alert; settings: Settings; kv: unknown }
export type Table = keyof Tables;
const tables: Table[] = ['products', 'orders', 'memories', 'alerts', 'settings', 'kv'];
const path = process.env.DB_PATH === ':memory:' ? ':memory:' : resolve(serverRoot, process.env.DB_PATH || 'trusttag.db');
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
export const sqlite = new DatabaseSync(path);
sqlite.exec('PRAGMA busy_timeout = 5000');
for (const table of tables) sqlite.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))`);

function tableName(table: Table): Table {
  if (!tables.includes(table)) throw new Error('Unknown table');
  return table;
}
export function get<T extends Table>(table: T, id: string): Tables[T] | undefined {
  const row = sqlite.prepare(`SELECT data FROM ${tableName(table)} WHERE id = ?`).get(id);
  return row ? JSON.parse(row.data as string) as Tables[T] : undefined;
}
export function all<T extends Table>(table: T): Tables[T][] {
  return sqlite.prepare(`SELECT data FROM ${tableName(table)} ORDER BY rowid`).all().map(row => JSON.parse(row.data as string) as Tables[T]);
}
export function put<T extends Table>(table: T, id: string, value: Tables[T]): Tables[T] {
  sqlite.prepare(`INSERT INTO ${tableName(table)} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(id, JSON.stringify(value));
  return value;
}
export function remove(table: Table, id: string): boolean {
  return sqlite.prepare(`DELETE FROM ${tableName(table)} WHERE id = ?`).run(id).changes > 0;
}
export function transaction<T>(fn: () => T): T {
  sqlite.exec('BEGIN IMMEDIATE');
  try { const value = fn(); sqlite.exec('COMMIT'); return value; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
}
export function resetDatabase(): void {
  transaction(() => {
    for (const table of tables) sqlite.exec(`DELETE FROM ${table}`);
    for (const product of shelfSeed) put('products', product.id, product);
    put('orders', historicalOrder.id, historicalOrder);
    put('settings', 'default', defaultSettings);
    put('kv', 'seeded', true);
  });
}
export const getSettings = (): Settings => get('settings', 'default')!;
export const saveSettings = (settings: Settings): Settings => put('settings', 'default', settings);
if (!get('kv', 'seeded')) resetDatabase();
export const db = { get, all, put, remove, transaction, getSettings, saveSettings };
