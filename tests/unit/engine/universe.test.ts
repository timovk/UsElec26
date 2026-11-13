import { beforeAll, describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { ENGINE_HISTORY, ENGINE_VERSION, Universe, engineVersionName } from '../../../src/engine/universe';
import { contentHash, integrityReport } from '../../../src/persistence/audit';
import { MINUTES_PER_DAY, SIM_START } from '../../../src/core/time';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let sqlite3: Sqlite3Static;
let files: Map<string, Uint8Array>;
const names = fixtureNames();

beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

async function make(seed: string) {
  const storage = new MemoryStorage(sqlite3);
  const u = await Universe.create(storage, { name: 'Test', seed }, files, names);
  return { storage, u };
}

describe('Universe lifecycle', () => {
  it('creates a coherent 2016 government', async () => {
    const { u } = await make('gov-1');
    const w = u.world;
    expect(w.time).toBe(SIM_START);
    const count = (k: string) => w.offices.filter((o) => o.kind === k).length;
    expect(count('president')).toBe(1); expect(count('vice_president')).toBe(1); expect(count('cabinet')).toBe(15);
    expect(count('us_senator')).toBe(100); expect(count('us_representative')).toBe(435); expect(count('governor')).toBe(50);
    expect(count('attorney_general')).toBe(50); // 43 elected + 7 appointed
    const senate = w.chambers.find((c) => c.kind === 'us_senate')!;
    expect([...senate.composition.values()].reduce((a, b) => a + b, 0)).toBe(100);
    const leg = w.chambers.filter((c) => c.kind.startsWith('state'));
    expect(leg.length).toBe(99);
    expect(leg.reduce((a, c) => a + c.seats, 0)).toBe(7383);
    for (const c of leg) expect([...c.composition.values()].reduce((a, b) => a + b, 0)).toBe(c.seats);
    // Louisiana and Mississippi swear in 2015 winners in January 2016 (scheduled assumption of office).
    expect(integrityReport(u.db).ok).toBe(true);
    u.close();
  });

  it('is deterministic: same seed → identical database content', async () => {
    const a = await make('det-1'), b = await make('det-1'), c = await make('det-2');
    expect(await contentHash(a.u.db)).toBe(await contentHash(b.u.db));
    expect(await contentHash(a.u.db)).not.toBe(await contentHash(c.u.db));
  });

  it('save/reload continuity: one 400-day advance equals 200 + reload + 200', async () => {
    const a = await make('fork-1');
    await a.u.advance({ kind: 'days', days: 400 });
    const b = await make('fork-1');
    await b.u.advance({ kind: 'days', days: 200 });
    const name = b.u.fileName; b.u.close();
    const reopened = await Universe.open(b.storage, name, names);
    await reopened.advance({ kind: 'days', days: 200 });
    expect(reopened.world.time).toBe(a.u.world.time);
    // Command logs differ by construction (different command sequence); compare simulation content.
    const strip = async (u: Universe) => { u.db.exec('DELETE FROM command_log'); return contentHash(u.db); };
    expect(await strip(reopened)).toBe(await strip(a.u));
    expect(integrityReport(reopened.db).ok).toBe(true);
  }, 900_000);

  it('advances time, ages people and handles vacancies over several years', async () => {
    const { u } = await make('years-1');
    const news = await u.advance({ kind: 'days', days: 365 * 4 });
    expect(u.world.time).toBe(SIM_START + 365 * 4 * MINUTES_PER_DAY);
    expect(news.some((n) => n.kind === 'inauguration')).toBe(true); // LA/MS January 2016
    const deaths = news.filter((n) => n.kind === 'death').length;
    expect(deaths).toBeGreaterThan(0);
    // Deaths in the news: officeholders and former officeholders (about 9,000 people, including 7,400 state
    // legislators). U.S. mortality at these ages is about 1% a year; allow well under that.
    expect(deaths).toBeLessThan(0.01 * 4 * 9500);
    const rep = integrityReport(u.db);
    expect(rep.checks.filter((c) => !c.ok)).toEqual([]);
  }, 900_000);

  it('export → import round-trips to identical content', async () => {
    const { storage, u } = await make('exp-1');
    await u.advance({ kind: 'days', days: 30 });
    const bytes = u.exportBytes(); const h = await contentHash(u.db); u.close();
    const s2 = new MemoryStorage(sqlite3);
    await s2.importFile('/universes/u-imported.sqlite3', bytes);
    const v = await Universe.open(s2, '/universes/u-imported.sqlite3', names);
    expect(await contentHash(v.db)).toBe(h);
    void storage;
  });
});

describe('Engine versions', () => {
  it('count updates 1.0, 2.0, … (a minor fix adds .1); an old phase-based name is the same engine', async () => {
    const v = ENGINE_HISTORY.map((e) => e.version.split('.').map(Number) as [number, number]);
    expect(v[0]).toEqual([1, 0]);
    for (let i = 1; i < v.length; i++) {
      const [a, b] = v[i - 1]!, [c, d] = v[i]!;
      expect((c === a + 1 && d === 0) || (c === a && d === b + 1)).toBe(true);
    }
    expect(ENGINE_VERSION).toBe(ENGINE_HISTORY[ENGINE_HISTORY.length - 1]!.version);
    expect(engineVersionName('0.1.0')).toBe('1.0'); expect(engineVersionName('0.7.3.1')).toBe('9.1'); expect(engineVersionName('0.7.4')).toBe('10.0');
    expect(engineVersionName('10.0')).toBe('10.0');
    // Opening a universe records an engine switch only when the engine really changed.
    for (const [old, newer] of [['0.1.0', true], ['0.7.4', ENGINE_VERSION !== '10.0']] as const) {
      const { storage, u } = await make('ledger-1');
      u.db.run('UPDATE engine_ledger SET engine_version = ?', [old]);
      const name = u.fileName; u.close();
      const r = await Universe.open(storage, name, names);
      const ledger = r.db.all<{ engine_version: string; to_time: number | null }>('SELECT engine_version, to_time FROM engine_ledger ORDER BY seq');
      expect(ledger.length).toBe(newer ? 2 : 1);
      expect(engineVersionName(ledger[ledger.length - 1]!.engine_version)).toBe(ENGINE_VERSION);
      r.close();
    }
  }, 300_000);
});
