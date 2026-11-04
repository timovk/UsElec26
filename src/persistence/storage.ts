/**
 * Storage backends. A universe is one SQLite database file.
 *  - OpfsStorage: browser, Origin Private File System via SQLite's SAH-pool VFS (no COOP/COEP needed).
 *  - MemoryStorage: Node tests and fallbacks; database images held as bytes.
 */
import type { Sqlite3Static, SAHPoolUtil } from '@sqlite.org/sqlite-wasm';
import { SqliteDb, deserializeInto, type Db } from './db';

export interface Storage {
  readonly kind: 'opfs' | 'memory';
  list(): string[];
  open(name: string): Db;
  exists(name: string): boolean;
  exportFile(name: string): Uint8Array;
  importFile(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): void;
  /** Persist an open database (memory backend only; OPFS writes through). */
  flush(name: string, db: Db): void;
}

export const UNIVERSE_DIR = '/universes/';

export async function initSqlite(): Promise<Sqlite3Static> {
  const mod = await import('@sqlite.org/sqlite-wasm');
  return mod.default();
}

export class OpfsStorage implements Storage {
  readonly kind = 'opfs' as const;
  private constructor(private readonly sqlite3: Sqlite3Static, private readonly pool: SAHPoolUtil) {}

  static async create(sqlite3: Sqlite3Static): Promise<OpfsStorage> {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'ena-sahpool', directory: '/ena', initialCapacity: 12 });
    return new OpfsStorage(sqlite3, pool);
  }

  /** Each database needs its file plus a rollup journal; keep headroom for backups and imports. */
  async ensureCapacity(extraDbs = 2): Promise<void> {
    const need = (this.list().length + extraDbs) * 2 + 4;
    await this.pool.reserveMinimumCapacity(need);
  }

  list(): string[] {
    return this.pool.getFileNames().filter((n) => n.startsWith(UNIVERSE_DIR) && n.endsWith('.sqlite3')).sort();
  }

  exists(name: string): boolean { return this.pool.getFileNames().includes(name); }

  open(name: string): Db {
    const db = new this.pool.OpfsSAHPoolDb(name);
    return new SqliteDb(this.sqlite3, db);
  }

  exportFile(name: string): Uint8Array { return this.pool.exportFile(name); }

  async importFile(name: string, bytes: Uint8Array): Promise<void> {
    await this.ensureCapacity(1);
    await this.pool.importDb(name, bytes);
  }

  remove(name: string): void { this.pool.unlink(name); }
  flush(): void { /* write-through */ }
}

export class MemoryStorage implements Storage {
  readonly kind = 'memory' as const;
  private files = new Map<string, Uint8Array>();
  constructor(private readonly sqlite3: Sqlite3Static) {}

  list(): string[] { return [...this.files.keys()].filter((n) => n.startsWith(UNIVERSE_DIR)).sort(); }
  exists(name: string): boolean { return this.files.has(name); }

  open(name: string): Db {
    const bytes = this.files.get(name);
    const raw = bytes ? deserializeInto(this.sqlite3, bytes) : new this.sqlite3.oo1.DB(':memory:', 'c');
    if (!bytes) this.files.set(name, new Uint8Array(0));
    return new SqliteDb(this.sqlite3, raw);
  }

  flush(name: string, db: Db): void { this.files.set(name, db.exportBytes()); }
  exportFile(name: string): Uint8Array {
    const b = this.files.get(name);
    if (!b) throw new Error(`no such file: ${name}`);
    return b.slice();
  }
  async importFile(name: string, bytes: Uint8Array): Promise<void> { this.files.set(name, bytes.slice()); }
  remove(name: string): void { this.files.delete(name); }
}
