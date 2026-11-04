/** Runs against the real Census geography pack when present (public/geo-packs/2016.1). */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadGeoPack, SEMANTIC_FILES } from '../../../src/geo/pack';
import { buildPopulation } from '../../../src/population/population';
import { generateElectorate, inTargets, TARGET_RANGES } from '../../../src/electorate/model';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { parseNameFile } from '../../../src/politicians/nameData';
import { integrityReport } from '../../../src/persistence/audit';

const DIR = 'public/geo-packs/2016.1/';
const have = existsSync(`${DIR}manifest.json`) && existsSync('public/data/names-v1.json');
const files = () => new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));

describe.skipIf(!have)('real Census geography pack', () => {
  it('loads and reconciles', async () => {
    const t0 = performance.now();
    const fs = files();
    const pack = await loadGeoPack(async (f) => fs.get(f)!);
    console.log(`pack load ${Math.round(performance.now() - t0)} ms, ${pack.bu.rows} BUs`);
    expect(pack.counties.length).toBe(3142);
    expect(pack.cds.length).toBe(435);
    let pop = 0; for (let b = 0; b < pack.bu.rows; b++) pop += pack.bu.pop2010[b]!;
    expect(pop).toBe(308745538); // 2010 Census resident population of the 50 states + DC
  });

  it('calibrates electorates across seeds within stylized-fact ranges', async () => {
    const fs = files();
    const pack = await loadGeoPack(async (f) => fs.get(f)!);
    const pop = buildPopulation(pack);
    const seeds = (process.env.ENA_SEEDS ?? 'A,B,C,D,E,F').split(',');
    let ok = 0;
    for (const s of seeds) {
      const t0 = performance.now();
      const e = generateElectorate(s, pack, pop);
      const st = e.params.achieved;
      console.log(`seed ${s}: ${Math.round(performance.now() - t0)} ms attempt=${e.params.attempt} ` + Object.entries(st).map(([k, v]) => `${k}=${(v as number).toFixed(2)}`).join(' '));
      if (inTargets(st)) ok++;
      expect(st.national).toBeGreaterThanOrEqual(TARGET_RANGES.national[0]); expect(st.national).toBeLessThanOrEqual(TARGET_RANGES.national[1]);
    }
    console.log(`${ok}/${seeds.length} seeds inside every target range`);
    expect(ok / seeds.length).toBeGreaterThanOrEqual(0.8);
  }, 900_000);

  it('creates a full universe within budget', async () => {
    const sqlite3 = await initSqlite();
    const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
    const t0 = performance.now();
    const steps: string[] = [];
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Real', seed: 'REAL-1' }, files(), names, (s) => steps.push(`${s}@${Math.round(performance.now() - t0)}`));
    const ms = performance.now() - t0;
    console.log(`create ${Math.round(ms)} ms; ${steps.join(' | ')}; db ${(u.db.exportBytes().length / 1e6).toFixed(1)} MB; persons ${u.world.persons.size}`);
    const t1 = performance.now(); await u.advance({ kind: 'days', days: 31 }); console.log(`advance month ${Math.round(performance.now() - t1)} ms`);
    expect(integrityReport(u.db).ok).toBe(true);
  }, 900_000);
});
