/**
 * Profile one simulated month of a saved universe (opt-in): ENA_CPU=<universe.sqlite3> opens it, advances to
 * September 1 of its year, then records September. Writes `<file>.ms` (wall time), `<file>.sql` (time per SQL
 * statement) and, unless ENA_SQL=1, `<file>.cpuprofile` (open it in Chrome DevTools). Used in Phase 6 to find
 * the unindexed contest lookups that made election years slower every year.
 */
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { parseNameFile } from '../../../src/politicians/nameData';
import { zonedToUtc, daysToCivil, easternDay } from '../../../src/core/time';
it.skipIf(!process.env.ENA_CPU)('profile September', async () => {
  const sqlite3 = await initSqlite();
  const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
  const st = new MemoryStorage(sqlite3);
  await st.importFile('/universes/p.sqlite3', new Uint8Array(readFileSync(process.env.ENA_CPU!)));
  const u = await Universe.open(st, '/universes/p.sqlite3', names);
  const y = daysToCivil(easternDay(u.world.time)).y;
  await u.advance({ kind: 'until', time: zonedToUtc(y, 9, 1, 0, 0, 'America/New_York') });
  const s = new Session(); s.connect();
  // Time every SQL statement by its text.
  const sqlMs = new Map<string, [number, number]>();
  const db = u.db as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ['all', 'get', 'value', 'run']) { const f = db[m]!.bind(db); db[m] = (sql: unknown, params?: unknown) => { const t = performance.now(); try { return f(sql, params); } finally { const k = String(sql).replace(/\s+/g, ' ').slice(0, 160); const e = sqlMs.get(k) ?? [0, 0]; e[0] += performance.now() - t; e[1]++; sqlMs.set(k, e); } }; }
  if (!process.env.ENA_SQL) { await s.post('Profiler.enable'); await s.post('Profiler.start'); }
  const t0 = performance.now();
  await u.advance({ kind: 'until', time: zonedToUtc(y, 10, 1, 0, 0, 'America/New_York') });
  const ms = performance.now() - t0;
  if (!process.env.ENA_SQL) { const { profile } = await s.post('Profiler.stop'); writeFileSync(process.env.ENA_CPU + '.cpuprofile', JSON.stringify(profile)); }
  writeFileSync(process.env.ENA_CPU + '.sql', [...sqlMs].sort((a, b) => b[1][0] - a[1][0]).slice(0, 40).map(([k, [t, n]]) => `${Math.round(t)} ms ×${n}  ${k}`).join('\n'));
  writeFileSync(process.env.ENA_CPU + '.ms', `${y} September: ${Math.round(ms)} ms, persons ${u.world.persons.size}`);
}, 3600_000);
