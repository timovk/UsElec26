/**
 * The electorate's evolution: deterministic, bounded, the parties stay distinct, newly eligible voters start
 * at the current target, cohorts carry their partisanship as they age, coalitions exist and move over time
 * while the national balance stays competitive (the two-party guardrail).
 */
import { describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { buildPopulation } from '../../../src/population/population';
import { applyDemography, initialDemography, stepDemography } from '../../../src/population/evolution';
import { generateElectorate, countyLean, dShare } from '../../../src/electorate/model';
import { electorateAt, initialDynamics, nationalMargin, stepElectorate } from '../../../src/electorate/dynamics';
import { N_COHORTS } from '../../../src/population/cohorts';

describe('electorate dynamics', () => {
  const pack = makeFixturePack();
  const base = buildPopulation(pack);
  const e0 = generateElectorate('DYN', pack, base);
  const cohortShares = (mu: Float32Array, pop = base) => Array.from({ length: N_COHORTS }, (_, k) => {
    let d = 0, t = 0;
    for (let c = 0; c < pack.counties.length; c++) { const w = pop.countyVep[c]! * pop.countyJoint[c * N_COHORTS + k]!; d += w / (1 + Math.exp(-1.6 * mu[c * N_COHORTS + k]! / Math.sqrt(1 + e0.params.sigma[k]! ** 2))); t += w; }
    return d / t;
  });
  const run = (years: number, seed = 'S') => {
    let demo = initialDemography(pack, base); const d0 = demo; let dyn = initialDynamics(e0, 2016); let pop = base; let inParty = 1;
    const nat: number[] = [];
    for (let y = 2017; y < 2017 + years; y++) {
      const s = stepDemography(seed, pack, demo); demo = s.next; pop = applyDemography(seed, pack, base, d0, demo);
      if (y % 8 === 1) inParty = 3 - inParty;
      dyn = stepElectorate(seed, y, e0, dyn, pack, pop, base, { outParty: 3 - inParty, outTerms: 1 + ((y - 2017) % 8 >= 4 ? 1 : 0), nominees: { D: null, R: null }, flows: s.flows });
      const L = countyLean(dyn.mu, e0.tables, pop); let d = 0, t = 0; for (let c = 0; c < pack.counties.length; c++) { d += L.dVotes[c]!; t += L.votes[c]!; }
      nat.push(100 * dShare(d, t));
    }
    return { dyn, pop, nat };
  };
  it('coalitions exist: groups differ in partisanship (calibrated group spread)', () => {
    const sh = cohortShares(e0.mu);
    const m = sh.reduce((a, b) => a + b, 0) / sh.length, sd = Math.sqrt(sh.reduce((a, b) => a + (b - m) ** 2, 0) / sh.length);
    expect(sd).toBeGreaterThan(0.04);
    expect(e0.params.targets.groupSd).toBeGreaterThan(0.45);
  });
  it('is deterministic and stays competitive over 50 years while groups realign', () => {
    const a = run(50), b = run(50);
    expect(Array.from(a.dyn.mu)).toEqual(Array.from(b.dyn.mu));
    expect(Math.min(...a.nat)).toBeGreaterThan(38); expect(Math.max(...a.nat)).toBeLessThan(62);
    const s0 = cohortShares(e0.mu), s1 = cohortShares(a.dyn.mu, a.pop);
    const shift = s0.reduce((acc, x, k) => acc + Math.abs(s1[k]! - x), 0) / N_COHORTS;
    expect(shift).toBeGreaterThan(0.01);                      // the coalitions move
    const gap = Math.hypot(...a.dyn.platforms.D.map((x, i) => x - a.dyn.platforms.R[i]!));
    expect(gap).toBeGreaterThanOrEqual(0.69);                 // the parties never merge
    for (const x of a.dyn.mu) expect(Number.isFinite(x)).toBe(true);
  });
  it('party competition: a lopsided electorate drifts back toward balance without swinging past it', () => {
    // Start about ten points more Democratic than the generated electorate, with Democrats holding the White House throughout.
    let dyn = initialDynamics(e0, 2016); const m0 = nationalMargin(dyn.mu, e0, base);
    dyn = { ...dyn, mu: Float32Array.from(dyn.mu, (x) => x + 0.3) };
    let demo = initialDemography(pack, base); const d0 = demo;
    const L0 = nationalMargin(dyn.mu, e0, base), path: number[] = [L0];
    for (let y = 2017; y <= 2040; y++) {
      const s = stepDemography('C', pack, demo); demo = s.next; const pop = applyDemography('C', pack, base, d0, demo);
      dyn = stepElectorate('C', y, e0, dyn, pack, pop, base, { outParty: 2, outTerms: 1 + Math.floor((y - 2017) / 4), nominees: { D: null, R: null }, flows: s.flows });
      path.push(nationalMargin(dyn.mu, e0, pop));
    }
    expect(L0 - m0).toBeGreaterThan(8);                        // the shift made it lopsided (about D+20 on the fixture)
    const L24 = path[path.length - 1]!;
    expect(L24).toBeLessThan(0.5 * L0);                        // most of the lead erodes in 24 years (D+19.6 → D+6.1)…
    expect(Math.min(...path)).toBeGreaterThan(0);              // …without swinging to the other side
  });
  it('newly eligible voters start at the target and cohorts carry partisanship as they age', () => {
    let demo = initialDemography(pack, base); const s = stepDemography('T', pack, demo); demo = s.next;
    const pop = applyDemography('T', pack, base, initialDemography(pack, base), demo);
    const dyn0 = initialDynamics(e0, 2016);
    // Make the 30–44 band of one county far more Democratic than its target; a year later the 45–64 band inherits part of it.
    const mu = Float32Array.from(dyn0.mu); const c = 0, k30 = 16 + 3, k45 = 32 + 3;
    mu[c * N_COHORTS + k30] = mu[c * N_COHORTS + k30]! + 3;
    const next = stepElectorate('T', 2017, e0, { ...dyn0, mu }, pack, pop, base, { outParty: 2, outTerms: 1, nominees: { D: null, R: null }, flows: s.flows });
    const plain = stepElectorate('T', 2017, e0, dyn0, pack, pop, base, { outParty: 2, outTerms: 1, nominees: { D: null, R: null }, flows: s.flows });
    expect(next.mu[c * N_COHORTS + k45]! - plain.mu[c * N_COHORTS + k45]!).toBeGreaterThan(0.05);
    const e1 = electorateAt(e0, next, pack, pop);
    expect(e1.params.platforms).toEqual(next.platforms);
  });
});
