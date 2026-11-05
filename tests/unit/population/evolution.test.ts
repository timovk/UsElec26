/**
 * Demographic evolution: accounting identities (adults before − deaths + entrants + migration = adults after,
 * per county and nationally; BU totals equal county totals; shares sum to one), determinism, and plausible
 * national trends over 24 years. Opt-in real-geography trajectory: ENA_DEMO=1.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { buildPopulation, MARG_STRIDE } from '../../../src/population/population';
import { applyDemography, demographySummary, initialDemography, stepDemography } from '../../../src/population/evolution';
import { loadGeoPack, SEMANTIC_FILES } from '../../../src/geo/pack';

describe('demographic evolution', () => {
  const pack = makeFixturePack();
  const base = buildPopulation(pack);
  const s0 = initialDemography(pack, base);
  it('flows balance nationally and the BU population adds up to its counties', () => {
    let s = s0;
    for (let y = 0; y < 10; y++) {
      const { next, flows } = stepDemography('D1', pack, s);
      expect(flows.adultsBefore - flows.deaths + flows.entrants + flows.migration).toBeCloseTo(flows.adultsAfter, 3);
      for (let c = 0; c < pack.counties.length; c++) {
        const n = next.age[c * 4]! + next.age[c * 4 + 1]! + next.age[c * 4 + 2]! + next.age[c * 4 + 3]!;
        const r = next.race[c * 4]! + next.race[c * 4 + 1]! + next.race[c * 4 + 2]! + next.race[c * 4 + 3]!;
        expect(r).toBeCloseTo(n, 6);
        for (let a = 0; a < 4; a++) { expect(next.age[c * 4 + a]!).toBeGreaterThanOrEqual(0); expect(next.college[c * 4 + a]!).toBeLessThanOrEqual(next.age[c * 4 + a]! + 1e-9); }
      }
      s = next;
    }
    const pop = applyDemography('D1', pack, base, s0, s);
    for (const county of pack.counties) {
      let v = 0; for (let b = county.buStart; b < county.buStart + county.buCount; b++) v += pop.vep[b]!;
      expect(v / pop.countyVep[county.idx]!).toBeCloseTo(1, 4);
      for (let b = county.buStart; b < county.buStart + county.buCount; b++) {
        const o = b * MARG_STRIDE; let a = 0, r = 0;
        for (let k = 0; k < 4; k++) { a += pop.marg[o + k]!; r += pop.marg[o + 5 + k]!; }
        if (pop.vep[b]! > 0) { expect(a).toBeCloseTo(1, 4); expect(r).toBeCloseTo(1, 4); }
      }
    }
  });
  it('is deterministic in the seed and the year', () => {
    const a = stepDemography('D2', pack, s0).next, b = stepDemography('D2', pack, s0).next, c = stepDemography('D3', pack, s0).next;
    expect(Array.from(a.age)).toEqual(Array.from(b.age));
    expect(Array.from(a.age)).not.toEqual(Array.from(c.age));
  });
  it('the nation grows, ages, diversifies and becomes more educated, at plausible rates', () => {
    let s = s0; const first = demographySummary(pack, s0);
    for (let y = 0; y < 24; y++) s = stepDemography('D4', pack, s).next;
    const last = demographySummary(pack, s);
    const growth = Math.log(last.adults / first.adults) / 24;
    expect(growth).toBeGreaterThan(0.002); expect(growth).toBeLessThan(0.012);
    expect(last.age[3]!).toBeGreaterThan(first.age[3]!);                 // more 65+
    expect(last.race[0]!).toBeLessThan(first.race[0]!);                  // a smaller white share
    expect(last.race[2]!).toBeGreaterThan(first.race[2]!);               // a larger Hispanic share
    expect(last.college).toBeGreaterThan(first.college);
  });
});

const DIR = 'public/geo-packs/2016.1/';
describe.skipIf(!process.env.ENA_DEMO || !existsSync(`${DIR}manifest.json`))('demographic evolution on the real geography', () => {
  it('2016 → 2040 trajectory', async () => {
    const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const pack = await loadGeoPack(async (f) => files.get(f)!);
    const base = buildPopulation(pack);
    let s = initialDemography(pack, base);
    const fmt = (x: ReturnType<typeof demographySummary>) => `${x.year}: adults ${(x.adults / 1e6).toFixed(1)}M, residents ${(x.total / 1e6).toFixed(1)}M · age ${x.age.map((v) => (100 * v).toFixed(1)).join('/')} · race W/B/H/A ${x.race.map((v) => (100 * v).toFixed(1)).join('/')} · college ${(100 * x.college).toFixed(1)}%`;
    console.log(fmt(demographySummary(pack, s)));
    const t0 = performance.now();
    for (let y = 0; y < 24; y++) { s = stepDemography('REAL', pack, s).next; if ((s.year % 4) === 0) console.log(fmt(demographySummary(pack, s))); }
    const t1 = performance.now();
    const pop = applyDemography('REAL', pack, base, initialDemography(pack, base), s);
    console.log(`24 steps ${Math.round(t1 - t0)} ms; apply ${Math.round(performance.now() - t1)} ms`);
    const sum = demographySummary(pack, s), first = demographySummary(pack, initialDemography(pack, base));
    const st = pack.states.map((x, i) => ({ usps: x.usps, g: 100 * (sum.state[i]!.total / first.state[i]!.total - 1) })).sort((a, b) => b.g - a.g);
    console.log('fastest', st.slice(0, 6).map((x) => `${x.usps} ${x.g.toFixed(0)}%`).join(', '), '· slowest', st.slice(-6).map((x) => `${x.usps} ${x.g.toFixed(0)}%`).join(', '));
    expect(pop.vep.length).toBe(base.vep.length);
  }, 120000);
});
