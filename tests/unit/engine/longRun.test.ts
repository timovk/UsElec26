/**
 * Long headless runs with stylized-fact checks (opt-in; they take a long time).
 *
 * - ENA_LONGRUN=<years>[,seed] — the fixture geography from 2016 for that many years (the roadmap's 50-year run).
 * - ENA_ACCEPT=<seed> — the Phase 6 acceptance run: real Census geography from January 1, 2016 to January 1, 2041.
 *   It checkpoints the universe to ENA_CHECKPOINT_DIR (default: .cache/acceptance; not test-results/, which Playwright clears) every year and resumes
 *   from the latest checkpoint, so it can run in pieces.
 *
 * Both print a year-by-year table and every check, then assert the checks.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { SEMANTIC_FILES } from '../../../src/geo/pack';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { parseNameFile } from '../../../src/politicians/nameData';
import { daysToCivil, easternDay, zonedToUtc } from '../../../src/core/time';
import { formatRows, longRunChecks, yearRow, type YearRow } from './longRunChecks';

const ET = 'America/New_York';
const [yearsArg, seedArg] = (process.env.ENA_LONGRUN ?? '').split(',');
const accept = process.env.ENA_ACCEPT ?? '';
const REAL = 'public/geo-packs/2016.1/';

async function run(u: Universe, from: number, to: number, rows: YearRow[], after?: (u: Universe, year: number) => void): Promise<void> {
  for (let y = from + 1; y <= to; y++) {
    const t0 = performance.now();
    // January 2: the year's evolution (demography, electorate) runs on January 1.
    await u.advance({ kind: 'until', time: zonedToUtc(y, 1, 2, 0, 0, ET) });
    const r = yearRow(u, y, (performance.now() - t0) / 1000);
    rows.push(r);
    console.log(`${y}: ${Math.round(r.seconds)} s · House ${r.houseD}–${r.houseR} · Senate ${r.senateD}–${r.senateR} · persons ${r.persons}`);
    after?.(u, y);
  }
}

describe.skipIf(!yearsArg)('long fixture run', () => {
  it(`${yearsArg} years with stylized facts`, async () => {
    const years = Number(yearsArg);
    const sqlite3 = await initSqlite();
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Long', seed: seedArg ?? 'long-1' }, await packToFiles(makeFixturePack()), fixtureNames());
    await u.advance({ kind: 'until', time: zonedToUtc(2016, 1, 2, 0, 0, ET) });
    const rows: YearRow[] = [yearRow(u, 2016, 0)];
    await run(u, 2016, 2016 + years, rows);
    const checks = longRunChecks(u, rows, { from: 2016, to: 2016 + years, real: false });
    console.log(`${formatRows(rows)}\n\n${checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`).join('\n')}`);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  }, 6 * 3600_000);
});

describe.skipIf(!accept || !existsSync(`${REAL}manifest.json`))('Phase 6 acceptance on real geography', () => {
  it(`2016 → 2040, seed ${accept}`, async () => {
    const sqlite3 = await initSqlite();
    const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
    const dir = process.env.ENA_CHECKPOINT_DIR ?? '.cache/acceptance';
    mkdirSync(dir, { recursive: true });
    const storage = new MemoryStorage(sqlite3);
    const latest = readdirSync(dir).filter((f) => f.startsWith(`${accept}-`) && f.endsWith('.sqlite3')).sort().pop();
    let u: Universe, rows: YearRow[];
    if (latest) {
      await storage.importFile('/universes/acceptance.sqlite3', new Uint8Array(readFileSync(`${dir}/${latest}`)));
      u = await Universe.open(storage, '/universes/acceptance.sqlite3', names);
      rows = JSON.parse(readFileSync(`${dir}/${accept}-rows.json`, 'utf8')) as YearRow[];
      console.log(`resumed from ${latest}`);
    } else {
      const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(REAL + f))]));
      u = await Universe.create(storage, { name: 'Acceptance', seed: accept }, files, names);
      await u.advance({ kind: 'until', time: zonedToUtc(2016, 1, 2, 0, 0, ET) });
      rows = [yearRow(u, 2016, 0)];
    }
    const from = daysToCivil(easternDay(u.world.time)).y, to = Number(process.env.ENA_ACCEPT_TO ?? 2041);
    const stopAfter = Number(process.env.ENA_ACCEPT_YEARS ?? 99);
    await run(u, from, Math.min(to, from + stopAfter), rows, (v, y) => {
      writeFileSync(`${dir}/${accept}-${y}.sqlite3`, v.exportBytes());
      writeFileSync(`${dir}/${accept}-rows.json`, JSON.stringify(rows));
      // Keep only the latest checkpoint (a real-geography universe is large).
      for (const f of readdirSync(dir)) if (f.startsWith(`${accept}-`) && f.endsWith('.sqlite3') && f !== `${accept}-${y}.sqlite3`) unlinkSync(`${dir}/${f}`);
    });
    if (daysToCivil(easternDay(u.world.time)).y < to) { console.log('checkpointed; run again to continue'); return; }
    const checks = longRunChecks(u, rows, { from: 2016, to, real: true });
    console.log(`${formatRows(rows)}\n\n${checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`).join('\n')}`);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  }, 6 * 3600_000);
});
