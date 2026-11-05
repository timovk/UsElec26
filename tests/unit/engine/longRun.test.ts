/**
 * Long headless runs with stylized-fact checks (opt-in; they take a long time).
 *
 * - ENA_LONGRUN=<years>[,seed] — the fixture geography from 2016 for that many years (the roadmap's 50-year run).
 * - ENA_ACCEPT=<seed> — the Phase 6 acceptance run: real Census geography from January 1, 2016 to January 1, 2041.
 *
 * Both checkpoint the universe every simulated year to ENA_CHECKPOINT_DIR (default .cache/; not test-results/,
 * which Playwright clears) and resume from the latest checkpoint, so a run can be done in pieces
 * (ENA_YEARS_PER_RUN limits one piece). At the end they print a year-by-year table and every check, also
 * written to `<dir>/<name>-report.txt` (a passing test's console output may be suppressed), then assert the checks.
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
const DIR = process.env.ENA_CHECKPOINT_DIR ?? '.cache';

/** Run (or resume) a checkpointed universe from 2016 to January 2 of `to`; returns the checks' failures. */
async function longRun(name: string, to: number, real: boolean, create: (storage: MemoryStorage) => Promise<Universe>, names: Parameters<typeof Universe.open>[2]): Promise<string[] | null> {
  const sqlite3 = await initSqlite();
  mkdirSync(DIR, { recursive: true });
  const storage = new MemoryStorage(sqlite3);
  const latest = readdirSync(DIR).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.sqlite3')).sort().pop();
  let u: Universe, rows: YearRow[];
  if (latest) {
    await storage.importFile('/universes/run.sqlite3', new Uint8Array(readFileSync(`${DIR}/${latest}`)));
    u = await Universe.open(storage, '/universes/run.sqlite3', names);
    rows = JSON.parse(readFileSync(`${DIR}/${name}-rows.json`, 'utf8')) as YearRow[];
    console.log(`resumed from ${latest}`);
  } else {
    u = await create(storage);
    // January 2: each year's evolution (demography, electorate) runs on January 1.
    await u.advance({ kind: 'until', time: zonedToUtc(2016, 1, 2, 0, 0, ET) });
    rows = [yearRow(u, 2016, 0)];
  }
  const from = daysToCivil(easternDay(u.world.time)).y, until = Math.min(to, from + Number(process.env.ENA_YEARS_PER_RUN ?? 999));
  for (let y = from + 1; y <= until; y++) {
    const t0 = performance.now();
    await u.advance({ kind: 'until', time: zonedToUtc(y, 1, 2, 0, 0, ET) });
    const r = yearRow(u, y, (performance.now() - t0) / 1000);
    rows.push(r);
    console.log(`${y}: ${Math.round(r.seconds)} s · House ${r.houseD}–${r.houseR} · Senate ${r.senateD}–${r.senateR} · persons ${r.persons}`);
    writeFileSync(`${DIR}/${name}-${y}.sqlite3`, u.exportBytes());
    writeFileSync(`${DIR}/${name}-rows.json`, JSON.stringify(rows));
    // Keep only the latest checkpoint (a real-geography universe is large).
    for (const f of readdirSync(DIR)) if (f.startsWith(`${name}-`) && f.endsWith('.sqlite3') && f !== `${name}-${y}.sqlite3`) unlinkSync(`${DIR}/${f}`);
  }
  if (daysToCivil(easternDay(u.world.time)).y < to) { console.log('checkpointed; run again to continue'); return null; }
  const checks = longRunChecks(u, rows, { from: 2016, to, real });
  const report = `${formatRows(rows)}\n\n${checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`).join('\n')}`;
  writeFileSync(`${DIR}/${name}-report.txt`, report);
  console.log(report);
  return checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
}

describe.skipIf(!yearsArg)('long fixture run', () => {
  it(`${yearsArg} years with stylized facts`, async () => {
    const seed = seedArg ?? 'long-1';
    const failures = await longRun(`longrun-${seed}`, 2016 + Number(yearsArg), false,
      async (storage) => Universe.create(storage, { name: 'Long', seed }, await packToFiles(makeFixturePack()), fixtureNames()), fixtureNames());
    if (failures) expect(failures).toEqual([]);
  }, 6 * 3600_000);
});

describe.skipIf(!accept || !existsSync(`${REAL}manifest.json`))('Phase 6 acceptance on real geography', () => {
  it(`2016 → 2040, seed ${accept}`, async () => {
    const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
    const failures = await longRun(`accept-${accept}`, Number(process.env.ENA_ACCEPT_TO ?? 2041), true, (storage) => {
      const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(REAL + f))]));
      return Universe.create(storage, { name: 'Acceptance', seed: accept }, files, names);
    }, names);
    if (failures) expect(failures).toEqual([]);
  }, 6 * 3600_000);
});
