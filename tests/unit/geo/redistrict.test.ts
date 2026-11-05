/**
 * Plan validity for the baseline redistricting algorithm: equal population within tolerance, contiguity on
 * the BU neighbour graph, compactness, few county splits, nesting, and determinism. Synthetic regions here;
 * real-state plans are checked in the opt-in suite (ENA_REDISTRICT=1) against the 2016 plans' figures.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { buGraph, drawPlan, planStats, type PlanRegion } from '../../../src/geo/redistrict';
import { loadGeoPack, SEMANTIC_FILES } from '../../../src/geo/pack';
import { unitsPerMeter } from '../../../src/engine/census';

/** An irregular synthetic state: a grid with a bay cut out of it, counties of 6×6 cells, uneven populations. */
function region(w = 60, h = 40): PlanRegion {
  const xs: number[] = [], ys: number[] = [], pop: number[] = [], county: number[] = [];
  const cw = Math.ceil(w / 6);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (i > 20 && i < 30 && j > 10 && j < 34) continue;                  // the bay
    xs.push(i); ys.push(j); pop.push(800 + ((i * 7919 + j * 104729) % 900)); county.push(Math.floor(j / 6) * cw + Math.floor(i / 6));
  }
  const nC = Math.ceil(h / 6) * cw;
  const countyAdj = Array.from({ length: nC }, (_, c) => { const ci = c % cw, cj = Math.floor(c / cw); return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => (cj + b!) * cw + ci + a!).filter((k) => k >= 0 && k < nC && Math.abs((k % cw) - ci) <= 1); });
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), pop: Float64Array.from(pop), county: Int32Array.from(county), countyAdj, area: new Float64Array(xs.length).fill(1), unitsPerMeter: 1 };
}

describe('baseline redistricting', () => {
  const r = region(); const g = buGraph(r);
  it('equal population, contiguous, compact, few county splits', () => {
    const res = drawPlan(r, { sizes: new Array(9).fill(1), tolerance: 0.005 }, g);
    expect(res.stats.maxDeviation).toBeLessThanOrEqual(0.006);
    expect(res.stats.contiguous).toBe(true);
    expect(Math.min(...res.stats.compactness)).toBeGreaterThan(0.45);
    expect(res.stats.countiesSplit).toBeLessThanOrEqual(30);
  });
  it('multi-member districts get population in proportion to their seats', () => {
    const res = drawPlan(r, { sizes: [1, 2, 1, 3], tolerance: 0.02 }, g);
    const per = res.stats.populations.map((p, d) => p / [1, 2, 1, 3][d]!);
    expect(Math.max(...per) / Math.min(...per)).toBeLessThan(1.05);
  });
  it('nests lower districts inside upper districts', () => {
    const upper = drawPlan(r, { sizes: new Array(4).fill(1), tolerance: 0.02 }, g);
    const lower = drawPlan(r, { sizes: new Array(8).fill(1), tolerance: 0.03, nest: { within: upper.district, parentOf: [0, 0, 1, 1, 2, 2, 3, 3] } }, g);
    for (let i = 0; i < r.x.length; i++) expect(Math.floor(lower.district[i]! / 2)).toBe(upper.district[i]);
    expect(lower.stats.maxDeviation).toBeLessThan(0.05);
  });
  it('is deterministic', () => {
    const a = drawPlan(r, { sizes: new Array(5).fill(1), tolerance: 0.005 }, g), b = drawPlan(r, { sizes: new Array(5).fill(1), tolerance: 0.005 }, g);
    expect(Array.from(a.district)).toEqual(Array.from(b.district));
    const st = planStats(r, g, a.district, a.stats.ideal);
    expect(st.maxDeviation).toBeCloseTo(a.stats.maxDeviation, 9);
  });
});

const DIR = 'public/geo-packs/2016.1/';
describe.skipIf(!process.env.ENA_REDISTRICT || !existsSync(`${DIR}manifest.json`))('real states (opt-in)', () => {
  it('congressional plans for every state from 2010 populations', async () => {
    const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const pack = await loadGeoPack(async (f) => files.get(f)!);
    let worst = 0, splitNew = 0, splitOld = 0, compNew = 0, compOld = 0, n = 0, total = 0;
    for (const st of pack.states) {
      const cs = pack.counties.filter((c) => c.stateIdx === st.idx); const b0 = cs[0]!.buStart, b1 = cs[cs.length - 1]!.buStart + cs[cs.length - 1]!.buCount;
      const seats = pack.cds.filter((c) => c.stateIdx === st.idx).length; if (seats < 2) continue;
      const r: PlanRegion = { x: pack.bu.x.slice(b0, b1), y: pack.bu.y.slice(b0, b1), pop: Float64Array.from(pack.bu.pop2010.slice(b0, b1)), county: pack.bu.county.slice(b0, b1), countyAdj: pack.countyAdjacency, area: pack.bu.landM2.slice(b0, b1), unitsPerMeter: unitsPerMeter(pack, b0, b1) };
      const t0 = performance.now(); const g = buGraph(r); const res = drawPlan(r, { sizes: new Array(seats).fill(1), tolerance: 0.005 }, g); total += performance.now() - t0;
      const ids = [...new Set(pack.bu.cd.slice(b0, b1))].sort((a, b) => a - b); const loc = new Map(ids.map((d, i) => [d, i]));
      const old = planStats(r, g, Int32Array.from(pack.bu.cd.slice(b0, b1), (d) => loc.get(d)!), res.stats.ideal);
      worst = Math.max(worst, res.stats.maxDeviation); splitNew += res.stats.countiesSplit; splitOld += old.countiesSplit;
      compNew += res.stats.compactness.reduce((a, b) => a + b, 0); compOld += old.compactness.reduce((a, b) => a + b, 0); n += seats;
      if (!res.stats.contiguous || res.stats.maxDeviation > 0.006) console.log(`${st.usps}: contiguous ${res.stats.contiguous}, deviation ${(100 * res.stats.maxDeviation).toFixed(2)}%`);
      expect(res.stats.contiguous).toBe(true);
    }
    console.log(`all multi-seat states: worst deviation ${(100 * worst).toFixed(2)}%, counties split ${splitNew} (2016 plans: ${splitOld}), mean compactness ${(compNew / n).toFixed(2)} (2016 plans: ${(compOld / n).toFixed(2)}), ${Math.round(total)} ms`);
    expect(worst).toBeLessThan(0.01);
  }, 900000);
});
