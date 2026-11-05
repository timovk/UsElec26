/**
 * Database abstraction over the official SQLite WebAssembly build.
 * All engine persistence goes through `Db`, so the same code runs against OPFS (browser) and
 * in-memory databases (Node tests). Transactions are synchronous by design: callers prepare
 * compressed blobs first, then write inside `tx`.
 */
import type { Database, Sqlite3Static, SqlValue, BindingSpec } from '@sqlite.org/sqlite-wasm';

export type Row = Record<string, SqlValue>;
export type Params = BindingSpec | undefined;

export interface Db {
  exec(sql: string): void;
  run(sql: string, params?: Params): number; // returns changes
  all<T = Row>(sql: string, params?: Params): T[];
  get<T = Row>(sql: string, params?: Params): T | undefined;
  value<T extends SqlValue = SqlValue>(sql: string, params?: Params): T | undefined;
  tx<T>(fn: () => T): T;
  /** Open a transaction that spans asynchronous work (`tx` calls inside become savepoints); close with `end` or `abort`. */
  begin(): void;
  end(): void;
  abort(): void;
  lastInsertRowid(): number;
  /** Prepared bulk insert: calls `bind` per row inside one statement. */
  insertMany(sql: string, rows: Iterable<BindingSpec>): void;
  exportBytes(): Uint8Array;
  close(): void;
}

export class SqliteDb implements Db {
  private depth = 0;
  constructor(private readonly sqlite3: Sqlite3Static, readonly db: Database) {}

  exec(sql: string): void { this.db.exec(sql); }

  run(sql: string, params?: Params): number {
    this.db.exec({ sql, bind: params });
    return this.db.changes();
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    return this.db.selectObjects(sql, params) as T[];
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    return (this.db.selectObject(sql, params) as T | undefined) ?? undefined;
  }

  value<T extends SqlValue = SqlValue>(sql: string, params?: Params): T | undefined {
    return (this.db.selectValue(sql, params) as T | undefined) ?? undefined;
  }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) { // nested: savepoint
      const name = `sp${this.depth}`;
      this.depth++;
      this.db.exec(`SAVEPOINT ${name}`);
      try { const r = fn(); this.db.exec(`RELEASE ${name}`); return r; }
      catch (e) { this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw e; }
      finally { this.depth--; }
    }
    this.depth++;
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
    finally { this.depth--; }
  }

  begin(): void {
    if (this.depth > 0) throw new Error('begin: a transaction is already open');
    this.depth++; this.db.exec('BEGIN IMMEDIATE');
  }
  end(): void { this.db.exec('COMMIT'); this.depth--; }
  abort(): void { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } this.depth--; }

  lastInsertRowid(): number {
    return Number(this.sqlite3.capi.sqlite3_last_insert_rowid(this.db.pointer!));
  }

  insertMany(sql: string, rows: Iterable<BindingSpec>): void {
    const stmt = this.db.prepare(sql);
    try {
      for (const r of rows) { stmt.bind(r); stmt.stepReset(); }
    } finally { stmt.finalize(); }
  }

  exportBytes(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer!);
  }

  close(): void { this.db.close(); }
}

/** Load a serialized database image into a fresh in-memory database. */
export function deserializeInto(sqlite3: Sqlite3Static, bytes: Uint8Array): Database {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const capi = sqlite3.capi;
  const rc = capi.sqlite3_deserialize(db.pointer!, 'main', p, bytes.length, bytes.length,
    capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
  if (rc !== 0) { db.close(); throw new Error(`sqlite3_deserialize failed: ${rc}`); }
  return db;
}
