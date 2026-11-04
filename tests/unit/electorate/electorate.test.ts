import { describe, expect, it } from 'vitest';
import { makeFixturePack, STATE_TABLE } from '../../fixtures/fixturePack';
import { buildPopulation, buCohortShares } from '../../../src/population/population';
import { buLean, countyLean, generateElectorate, leanStats, rebuildElectorate, TARGET_RANGES } from '../../../src/electorate/model';
import { N_COHORTS } from '../../../src/population/cohorts';

const pack = makeFixturePack();
const pop = buildPopulation(pack);

describe('population', () => {
  it('fixture apportionment totals 435', () => { expect(STATE_TABLE.reduce((a, s) => a + s[6], 0)).toBe(435); });
  it('VEP is positive and ≤ VAP-scale; cohort shares sum to 1', () => {
    let v = 0; for (const x of pop.vep) { expect(x).toBeGreaterThanOrEqual(0); v += x; }
    expect(v).toBeGreaterThan(1e8);
    const s = buCohortShares(pop, 10, pack.bu.county[10]!, new Float64Array(N_COHORTS));
    expect(s.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 9);
  });
});

describe('electorate generation', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = generateElectorate('alpha', pack, pop), b = generateElectorate('alpha', pack, pop), c = generateElectorate('beta', pack, pop);
    expect(Array.from(a.mu.slice(0, 200))).toEqual(Array.from(b.mu.slice(0, 200)));
    expect(Array.from(a.mu.slice(0, 200))).not.toEqual(Array.from(c.mu.slice(0, 200)));
  });
  it('rebuild from stored params/fields reproduces μ exactly', () => {
    const a = generateElectorate('gamma', pack, pop);
    const r = rebuildElectorate(JSON.parse(JSON.stringify(a.params)), a.fields, pack, pop);
    expect(Array.from(r.mu)).toEqual(Array.from(a.mu));
    expect(Array.from(r.buShift)).toEqual(Array.from(a.buShift));
  });
  it('calibrates national share near its target and spreads within plausible ranges', () => {
    const e = generateElectorate('delta', pack, pop);
    const st = e.params.achieved;
    expect(Math.abs(st.national - e.params.targets.national)).toBeLessThan(0.5);
    expect(st.national).toBeGreaterThanOrEqual(TARGET_RANGES.national[0]);
    expect(st.national).toBeLessThanOrEqual(TARGET_RANGES.national[1]);
    expect(st.countySd).toBeGreaterThan(15);
    const bl = buLean(e, pack, pop);
    // BU aggregation reproduces county lean closely (BU shifts are centred within counties)
    const cl = countyLean(e.mu, e.tables, pop);
    const agg = new Float64Array(pack.counties.length), aggT = new Float64Array(pack.counties.length);
    for (let b = 0; b < pack.bu.rows; b++) { agg[pack.bu.county[b]!]! += bl.dVotes[b]!; aggT[pack.bu.county[b]!]! += bl.votes[b]!; }
    let maxDiff = 0;
    for (let c = 0; c < pack.counties.length; c++) maxDiff = Math.max(maxDiff, Math.abs(agg[c]! / aggT[c]! - cl.dVotes[c]! / cl.votes[c]!));
    expect(maxDiff).toBeLessThan(0.04);
    expect(leanStats(cl, pack).national).toBeCloseTo(st.national, 6);
  });
});
