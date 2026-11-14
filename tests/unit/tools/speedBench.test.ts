/**
 * Speed benchmark on the real Census geography (opt-in): ENA_SPEED=<label>.
 *
 * Creates a universe (seed ENA_SPEED_SEED, default SPEED-1; county offices ENA_SPEED_COUNTY = all, major or off) or opens ENA_SPEED_FROM (a saved universe), then
 * advances month by month to ENA_SPEED_UNTIL (default 2016-12-01; ENA_SPEED_SAVE=<path> saves the database at the end), recording wall time per month, time per
 * progress step and per section of the daily campaign season, and optionally time per SQL statement (ENA_SPEED_SQL=1) and a CPU profile (ENA_SPEED_CPU=1).
 * It also fingerprints every table (SHA-256 of its rows, in key order), so an optimization can be checked to
 * leave the simulation byte-identical: compare `.cache/speed-<label>.json` files.
 *
 * Storage is a memory store whose per-commit flush is free, like the browser's write-through OPFS store
 * (the regular test store copies the whole database at every commit, which the browser never does).
 */
import { it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { SEMANTIC_FILES } from '../../../src/geo/pack';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import type { Db } from '../../../src/persistence/db';
import { Universe } from '../../../src/engine/universe';
import { parseNameFile } from '../../../src/politicians/nameData';
import { daysToCivil, easternDay, zonedToUtc } from '../../../src/core/time';
import { decodeNightRecord } from '../../../src/counting/record';

const label = process.env.ENA_SPEED ?? '';
const REAL = 'public/geo-packs/2016.1/';
const ET = 'America/New_York';

class FreeFlushStorage extends MemoryStorage { override flush(): void { /* like OPFS: write-through */ } }

/**
 * A blob's content identity without its compression: every container records the CRC-32 (and length) of its
 * uncompressed bytes in its header, gzip in its trailer. Used by the semantic fingerprint, which then stays the
 * same when only the compressor changes.
 */
function contentId(v: Uint8Array): string {
  const hex = (a: Uint8Array) => Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  if (v.length > 18 && v[0] === 0x1f && v[1] === 0x8b) return `gz:${hex(v.subarray(v.length - 8))}`;
  if (v.length > 6 && v[0] === 0x45 && (v[1] === 0x5a || v[1] === 0x4a)) return `e${v[1]}:${hex(v.subarray(2, 6))}`;
  if (v.length > 8 && v[0] === 0x45 && v[1] === 0x31) { let i = 4; while (v[i]! & 0x80) i++; return `e1:${hex(v.subarray(4, i + 5))}`; }
  return `raw:${createHash('sha256').update(v).digest('hex').slice(0, 16)}`;
}
const SEAL_COLUMNS = new Set(['sha256', 'seal', 'payload_sha256', 'record_sha256', 'crc32']);
/** Night records nest compressed columns inside their container: compare them decoded. */
const canon = (v: unknown): unknown => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);

/** SHA-256 of each table's rows in key order (wall-clock columns excluded); `semantic`: blobs by content, seals skipped. */
async function fingerprints(db: Db, semantic = false): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const tables = db.all<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  for (const { name: t, sql } of tables) {
    if (t === 'meta' || t === 'command_log') continue;
    const h = createHash('sha256');
    const add = (rows: Record<string, unknown>[]) => { for (const r of rows) { for (const [k, v] of Object.entries(r)) { if (t === 'universe' && k === 'created_real') continue; if (semantic && SEAL_COLUMNS.has(k)) continue; h.update(v instanceof Uint8Array ? (semantic ? contentId(v) : v) : String(JSON.stringify(v))); h.update('\u001f'); } h.update('\n'); } };
    if (semantic && t === 'night') {
      for (const r of db.all<{ night_id: number; payload: Uint8Array }>('SELECT night_id, payload FROM night ORDER BY night_id')) h.update(`${r.night_id}:${JSON.stringify(canon(await decodeNightRecord(r.payload)))}\n`);
      add(db.all('SELECT night_id, day, kind, label, lock_time, coverage_start, night_end, feed_end, created_time FROM night ORDER BY night_id'));
      out[t] = h.digest('hex').slice(0, 16); continue;
    }
    if (/WITHOUT\s+ROWID/i.test(sql)) {
      const order = db.all<{ name: string; pk: number }>(`PRAGMA table_info("${t}")`).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => `"${c.name}"`).join(', ');
      add(db.all(`SELECT * FROM "${t}" ORDER BY ${order}`));
    } else {
      let last = -1;
      for (;;) {
        const rows = db.all<Record<string, unknown> & { _r: number }>(`SELECT rowid AS _r, * FROM "${t}" WHERE rowid > ? ORDER BY rowid LIMIT 20000`, [last]);
        if (!rows.length) break;
        last = rows[rows.length - 1]!._r;
        add(rows.map(({ _r, ...rest }) => { void _r; return rest; }));
      }
    }
    out[t] = h.digest('hex').slice(0, 16);
  }
  return out;
}

it.skipIf(!label || !existsSync(`${REAL}manifest.json`))(`speed benchmark (${label})`, async () => {
  const sqlite3 = await initSqlite();
  const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
  const storage = new FreeFlushStorage(sqlite3);
  const t0 = performance.now();
  let u: Universe;
  if (process.env.ENA_SPEED_FROM) {
    await storage.importFile('/universes/bench.sqlite3', new Uint8Array(readFileSync(process.env.ENA_SPEED_FROM)));
    u = await Universe.open(storage, '/universes/bench.sqlite3', names);
  } else {
    const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(REAL + f))]));
    u = await Universe.create(storage, { name: 'Bench', seed: process.env.ENA_SPEED_SEED ?? 'SPEED-1', ...(process.env.ENA_SPEED_COUNTY ? { county: process.env.ENA_SPEED_COUNTY as 'all' | 'major' | 'off' } : {}) }, files, names);
  }
  const setupMs = performance.now() - t0;

  // Time per progress step (the last label seen owns the time until the next one).
  const steps = new Map<string, number>(); let cur = '', curT = performance.now();
  u.onProgress = (step) => { const k = step.replace(/\d+/g, '#'); if (k === cur) return; const now = performance.now(); if (cur) steps.set(cur, (steps.get(cur) ?? 0) + now - curT); cur = k; curT = now; };
  // Time per SQL statement.
  const sqlMs = new Map<string, [number, number]>();
  if (process.env.ENA_SPEED_SQL) {
    const db = u.db as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ['all', 'get', 'value', 'run']) { const f = db[m]!.bind(db); db[m] = (q: unknown, p?: unknown) => { const t = performance.now(); try { return f(q, p); } finally { const k = String(q).replace(/\s+/g, ' ').slice(0, 150); const e = sqlMs.get(k) ?? [0, 0]; e[0] += performance.now() - t; e[1]++; sqlMs.set(k, e); } }; }
  }
  // Time per section of the daily campaign season (the season reads `globalThis.__seasonT` when set).
  const seasonT: Record<string, number> = {};
  (globalThis as unknown as { __seasonT?: Record<string, number> }).__seasonT = seasonT;
  // CPU profile of the whole run, or from ENA_SPEED_CPU=YYYY-MM (a month) to the end.
  const session = process.env.ENA_SPEED_CPU ? new Session() : null;
  const cpuFrom = /^\d{4}-\d{2}$/.test(process.env.ENA_SPEED_CPU ?? '') ? process.env.ENA_SPEED_CPU! : '';
  let profiling = false;
  const startProfile = async () => { if (!session || profiling) return; session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: 500 }); await session.post('Profiler.start'); profiling = true; };
  if (session && !cpuFrom) await startProfile();

  const [uy, um, ud] = (process.env.ENA_SPEED_UNTIL ?? '2016-12-01').split('-').map(Number) as [number, number, number];
  const end = zonedToUtc(uy, um, ud, 0, 0, ET);
  const months: { month: string; ms: number }[] = [];
  const tRun = performance.now();
  while (u.world.time < end) {
    const c = daysToCivil(easternDay(u.world.time));
    const next = Math.min(end, zonedToUtc(c.m === 12 ? c.y + 1 : c.y, c.m === 12 ? 1 : c.m + 1, 1, 0, 0, ET));
    if (cpuFrom && `${c.y}-${String(c.m).padStart(2, '0')}` >= cpuFrom) await startProfile();
    const tm = performance.now();
    await u.advance({ kind: 'until', time: next });
    months.push({ month: `${c.y}-${String(c.m).padStart(2, '0')}`, ms: Math.round(performance.now() - tm) });
  }
  const runMs = performance.now() - tRun;
  if (cur) steps.set(cur, (steps.get(cur) ?? 0) + performance.now() - curT);

  mkdirSync('.cache', { recursive: true });
  if (session && profiling) {
    const { profile } = await session.post('Profiler.stop');
    writeFileSync(`.cache/speed-${label}.cpuprofile`, JSON.stringify(profile));
  }
  const fp = await fingerprints(u.db), sem = await fingerprints(u.db, true);
  const report = {
    label, setupMs: Math.round(setupMs), runMs: Math.round(runMs), months,
    steps: [...steps].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ step: k, ms: Math.round(v) })),
    season: Object.fromEntries(Object.entries(seasonT).map(([k, v]) => [k, Math.round(v)])),
    sql: [...sqlMs].sort((a, b) => b[1][0] - a[1][0]).slice(0, 40).map(([q, [ms, n]]) => ({ ms: Math.round(ms), n, q })),
    persons: u.world.persons.size, offices: u.world.offices.length,
    // Memory and storage at the end (the heap after a full collection when node runs with --expose-gc).
    heapMB: (() => { (globalThis as { gc?: () => void }).gc?.(); return Math.round(process.memoryUsage().heapUsed / 1e6); })(),
    dbMB: Math.round(Number(u.db.value('PRAGMA page_count') ?? 0) * Number(u.db.value('PRAGMA page_size') ?? 0) / 1e5) / 10,
    fingerprints: fp, fingerprint: createHash('sha256').update(JSON.stringify(fp)).digest('hex').slice(0, 16),
    semantic: sem, semanticFingerprint: createHash('sha256').update(JSON.stringify(sem)).digest('hex').slice(0, 16),
  };
  writeFileSync(`.cache/speed-${label}.json`, JSON.stringify(report, null, 1));
  if (process.env.ENA_SPEED_SAVE) writeFileSync(process.env.ENA_SPEED_SAVE, u.db.exportBytes()); // the universe database, for inspection
  console.log(`${label}: setup ${report.setupMs} ms, run ${report.runMs} ms, ${report.persons} persons, heap ${report.heapMB} MB, database ${report.dbMB} MB, fingerprint ${report.fingerprint}, semantic ${report.semanticFingerprint}\n${months.map((m) => `${m.month} ${m.ms}`).join(' · ')}\n${report.steps.slice(0, 20).map((s) => `${s.step}: ${s.ms}`).join('\n')}\nseason ${JSON.stringify(report.season)}`);
  delete (globalThis as unknown as { __seasonT?: unknown }).__seasonT;
  u.close();
}, 4 * 3600_000);
