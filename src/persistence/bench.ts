/** SQLite write throughput benchmark (in-memory database), used by Settings → Diagnostics. */
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { SqliteDb } from './db';

export function sqliteWriteBench(sqlite3: Sqlite3Static, rows = 20_000): { rows: number; ms: number } {
  const db = new SqliteDb(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'));
  try {
    db.exec('CREATE TABLE t(a INTEGER, b REAL, c TEXT)');
    const t0 = performance.now();
    db.tx(() => db.insertMany('INSERT INTO t VALUES (?,?,?)', Array.from({ length: rows }, (_, i) => [i, i * 0.5, `row ${i}`])));
    return { rows, ms: performance.now() - t0 };
  } finally { db.close(); }
}
