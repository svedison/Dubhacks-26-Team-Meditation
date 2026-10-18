import { DatabaseSync } from 'node:sqlite';
import type { State, Store } from './types.ts';
/** Single-process adapter. B can supply its own Store on its existing SQLite connection. */
export class SqliteStore implements Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS role_d_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
  }
  load(): State | null {
    const row = this.db.prepare('SELECT body FROM role_d_state WHERE id=1').get();
    if (!row) return null;
    const state = JSON.parse(String(row.body));
    if (state.version !== 1) throw new Error('Unsupported Role D state version');
    return state;
  }
  save(state: State): void {
    this.db.prepare('INSERT INTO role_d_state(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(state));
  }
  close(): void { this.db.close(); }
}
