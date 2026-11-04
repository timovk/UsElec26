/**
 * Opt-in (ENA_CALIBRATE=<number of seeds>): forecast calibration of the full engine over many simulated 2016
 * cycles on the fixture geography. Each seed runs the whole campaign (campaigns, polls, averages, forecasts),
 * the general election and the canvass; the final pre-election forecast of every decided race is scored
 * against the result. Reported: Brier score, reliability by probability bin, coverage of the 80% intervals,
 * and the mean miss (a correlated polling miss shows up here as a non-zero mean in a single cycle, near zero
 * on average).
 */
import { describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { zonedToUtc } from '../../../src/core/time';
import { runSeasonQuery } from '../../../src/engine/seasonQueries';
import type { CalibrationDto } from '../../../src/engine/protocol';

const N = Number(process.env.ENA_CALIBRATE ?? 0);

describe.skipIf(!N)('full-engine forecast calibration', () => {
  it(`${N} simulated cycles`, async () => {
    const sqlite3 = await initSqlite();
    const files = await packToFiles(makeFixturePack());
    const races: CalibrationDto['races'] = [];
    const cycleMiss: number[] = [];
    const pres: { pD: number; dWon: boolean }[] = [];
    for (let s = 0; s < N; s++) {
      const u = await Universe.create(new MemoryStorage(sqlite3), { name: `C${s}`, seed: `CALIB-${s}` }, files, fixtureNames());
      await u.advance({ kind: 'until', time: zonedToUtc(2016, 12, 20, 12, 0, 'America/New_York') });
      const c = await runSeasonQuery(u, { kind: 'forecastCalibration', year: 2016 }) as CalibrationDto;
      races.push(...c.races);
      const presStates = c.races.filter((r) => r.kind === 'pres_state');
      if (presStates.length) cycleMiss.push(presStates.reduce((a, r) => a + r.actual - r.mean, 0) / presStates.length);
      if (c.president?.dWon !== null && c.president) pres.push({ pD: c.president.pD, dWon: c.president.dWon! });
      u.close();
    }
    const brier = races.reduce((a, r) => a + (r.pD - (r.dWon ? 1 : 0)) ** 2, 0) / races.length;
    const bins = Array.from({ length: 10 }, (_, i) => { const b = races.filter((r) => Math.min(9, Math.floor(r.pD * 10)) === i); return { bin: `${i * 10}–${i * 10 + 10}%`, n: b.length, predicted: b.length ? b.reduce((a, r) => a + r.pD, 0) / b.length : 0, observed: b.length ? b.filter((r) => r.dWon).length / b.length : 0 }; });
    // Interval statistics over contested races (an uncontested race's forecast is a point at ±100).
    const open = races.filter((r) => r.hi80 > r.lo80);
    const cover = open.filter((r) => r.actual >= r.lo80 && r.actual <= r.hi80).length / open.length;
    const contested = races.filter((r) => r.pD > 0.02 && r.pD < 0.98);
    const brierC = contested.reduce((a, r) => a + (r.pD - (r.dWon ? 1 : 0)) ** 2, 0) / Math.max(1, contested.length);
    const byKind = new Map<string, number[]>();
    for (const r of races) { const a = byKind.get(r.kind) ?? []; a.push(r.actual - r.mean); byKind.set(r.kind, a); }
    console.log(`${N} cycles, ${races.length} races: Brier ${brier.toFixed(4)} (competitive races, ${contested.length}: ${brierC.toFixed(4)}); 80% interval coverage ${(100 * cover).toFixed(1)}% (${open.length} contested races)`);
    for (const b of bins) if (b.n) console.log(`  forecast ${b.bin}: ${b.n} races, mean forecast ${(100 * b.predicted).toFixed(1)}%, Democratic wins ${(100 * b.observed).toFixed(1)}%`);
    for (const [k, e] of byKind) {
      const rk = open.filter((r) => r.kind === k), cov = rk.filter((r) => r.actual >= r.lo80 && r.actual <= r.hi80).length / rk.length;
      const z = rk.map((r) => (r.actual - r.mean) / Math.max(0.5, (r.hi80 - r.lo80) / 2.563)), zsd = Math.sqrt(z.reduce((a, b) => a + b * b, 0) / z.length);
      console.log(`  ${k}: ${e.length} races, mean miss (result − forecast, D+) ${(e.reduce((a, b) => a + b, 0) / e.length).toFixed(2)}, RMSE ${Math.sqrt(e.reduce((a, b) => a + b * b, 0) / e.length).toFixed(2)}, 80% coverage ${(100 * cov).toFixed(1)}%, RMS z ${zsd.toFixed(2)}`);
    }
    console.log(`  per-cycle presidential polling miss (mean over states, D+): ${cycleMiss.map((x) => x.toFixed(1)).join(', ')}`);
    console.log(`  presidency: ${pres.map((p) => `${Math.round(100 * p.pD)}%→${p.dWon ? 'D' : 'R'}`).join(', ')}`);
    expect(races.length).toBeGreaterThan(0);
    expect(cover).toBeGreaterThan(0.7); expect(cover).toBeLessThan(0.9);
  }, 7_200_000);
});
