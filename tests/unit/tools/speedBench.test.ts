/**
 * Speed benchmark on the real Census geography (opt-in): ENA_SPEED=<label>.
 *
 * Creates a universe (seed ENA_SPEED_SEED, default SPEED-1) or opens ENA_SPEED_FROM (a saved universe), then
 * advances month by month to ENA_SPEED_UNTIL (default 2016-12-01), recording wall time per month, time per
 * progress step, and optionally time per SQL statement (ENA_SPEED_SQL=1) and a CPU profile (ENA_SPEED_CPU=1).
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

const label = process.env.ENA_SPEED ?? '';
const REAL = 'public/geo-packs/2016.1/';
const ET = 'America/New_York';

class FreeFlushStorage extends MemoryStorage { override flush(): void { /* like OPFS: write-through */ } }

/** SHA-256 of each table's rows in key order (wall-clock columns excluded). */
function fingerprints(db: Db): Record<string, string> {
  const out: Record<string, string> = {};
  const tables = db.all<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  for (const { name: t, sql } of tables) {
    if (t === 'meta' || t === 'command_log') continue;
    const h = createHash('sha256');
    const add = (rows: Record<string, unknown>[]) => { for (const r of rows) { for (const [k, v] of Object.entries(r)) { if (t === 'universe' && k === 'created_real') continue; h.update(v instanceof Uint8Array ? v : String(JSON.stringify(v))); h.update('\u001f'); } h.update('\n'); } };
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
    u = await Universe.create(storage, { name: 'Bench', seed: process.env.ENA_SPEED_SEED ?? 'SPEED-1' }, files, names);
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
  const fp = fingerprints(u.db);
  const report = {
    label, setupMs: Math.round(setupMs), runMs: Math.round(runMs), months,
    steps: [...steps].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ step: k, ms: Math.round(v) })),
    sql: [...sqlMs].sort((a, b) => b[1][0] - a[1][0]).slice(0, 40).map(([q, [ms, n]]) => ({ ms: Math.round(ms), n, q })),
    persons: u.world.persons.size, fingerprints: fp, fingerprint: createHash('sha256').update(JSON.stringify(fp)).digest('hex').slice(0, 16),
  };
  writeFileSync(`.cache/speed-${label}.json`, JSON.stringify(report, null, 1));
  console.log(`${label}: setup ${report.setupMs} ms, run ${report.runMs} ms, fingerprint ${report.fingerprint}\n${months.map((m) => `${m.month} ${m.ms}`).join(' · ')}\n${report.steps.slice(0, 20).map((s) => `${s.step}: ${s.ms}`).join('\n')}`);
  u.close();
}, 4 * 3600_000);
