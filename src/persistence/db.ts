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

type Stmt = ReturnType<Database['prepare']>;
/** Prepared statements kept per connection (the engine issues a few hundred distinct statements). */
const STMT_CACHE = 512;

export class SqliteDb implements Db {
  private depth = 0;
  /**
   * Prepared statements by SQL text. Preparing (and copying the SQL into WebAssembly memory) for every call was
   * a large share of the engine's SQL time; a cached statement is reset, and its bindings cleared, after every
   * use. Text with a semicolon (possibly several statements) takes the uncached path. Results are the same as
   * the uncached calls': parameters are bound only to a statement that has some, `run` steps once, `all` rows
   * are null-prototype objects in column order and `get` rows plain objects.
   */
  private stmts = new Map<string, Stmt>();
  constructor(private readonly sqlite3: Sqlite3Static, readonly db: Database) {}

  private prepared(sql: string): Stmt | null {
    let s = this.stmts.get(sql);
    if (s) return s;
    if (sql.includes(';')) return null;
    s = this.db.prepare(sql);
    if (this.stmts.size >= STMT_CACHE) { const [k, old] = this.stmts.entries().next().value!; this.stmts.delete(k); old.finalize(); }
    this.stmts.set(sql, s);
    return s;
  }
  private static bind(s: Stmt, params: Params): void { if (params && s.parameterCount) s.bind(params); }
  private static done(s: Stmt): void { try { s.reset(true); } catch { /* the step's error has been thrown already */ } }

  exec(sql: string): void { this.db.exec(sql); }

  run(sql: string, params?: Params): number {
    const s = this.prepared(sql);
    if (!s) { this.db.exec({ sql, bind: params }); return this.db.changes(); }
    try { SqliteDb.bind(s, params); s.step(); } finally { SqliteDb.done(s); }
    return this.db.changes();
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    const s = this.prepared(sql);
    if (!s) return this.db.selectObjects(sql, params) as T[];
    try {
      SqliteDb.bind(s, params);
      const out: T[] = [];
      if (!s.columnCount) { s.step(); return out; }
      let names: string[] | null = null;
      const row: SqlValue[] = [];
      while (s.step()) {
        names ??= s.getColumnNames([]);
        s.get(row);
        const o = Object.create(null) as Record<string, SqlValue>;
        for (let i = 0; i < names.length; i++) o[names[i]!] = row[i]!;
        out.push(o as T);
      }
      return out;
    } finally { SqliteDb.done(s); }
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    const s = this.prepared(sql);
    if (!s) return (this.db.selectObject(sql, params) as T | undefined) ?? undefined;
    try { SqliteDb.bind(s, params); return s.step() ? (s.get({}) as T) : undefined; } finally { SqliteDb.done(s); }
  }

  value<T extends SqlValue = SqlValue>(sql: string, params?: Params): T | undefined {
    const s = this.prepared(sql);
    if (!s) return (this.db.selectValue(sql, params) as T | undefined) ?? undefined;
    try { SqliteDb.bind(s, params); return s.step() ? ((s.get(0) as T | undefined) ?? undefined) : undefined; } finally { SqliteDb.done(s); }
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

  /** Open a transaction; inside another one it is a savepoint (closed by the matching `end` or `abort`). */
  begin(): void {
    if (this.depth > 0) { this.db.exec(`SAVEPOINT sp${this.depth}`); this.depth++; return; }
    this.depth++; this.db.exec('BEGIN IMMEDIATE');
  }
  end(): void {
    this.depth--;
    if (this.depth > 0) this.db.exec(`RELEASE sp${this.depth}`); else this.db.exec('COMMIT');
  }
  abort(): void {
    this.depth--;
    if (this.depth > 0) { try { this.db.exec(`ROLLBACK TO sp${this.depth}; RELEASE sp${this.depth}`); } catch { /* already rolled back */ } return; }
    try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
  }
  /** Whether a transaction is open. */
  get inTransaction(): boolean { return this.depth > 0; }

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

  close(): void {
    for (const st of this.stmts.values()) { try { st.finalize(); } catch { /* closing anyway */ } }
    this.stmts.clear();
    this.db.close();
  }
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
