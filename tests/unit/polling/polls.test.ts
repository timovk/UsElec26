/**
 * Polls and averages against their design: sampling error matches the effective sample size, house effects
 * and shared nonresponse shift results as designed, and the average's 80% band covers the truth about 80% of the time.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng';
import { fieldPoll, type PieceTypes, type PollDesign } from '../../../src/electorate/measure';
import { N_CLASS, N_TYPES, ZG, type KernelContest } from '../../../src/electorate/kernel';
import { kalman, raceAverage, houseEffects, type PollObs } from '../../../src/polling/average';
import { cycleBias, makePollsters } from '../../../src/polling/pollsters';

/** A synthetic electorate: three counties of voter types spread over partisanship and classes. */
function electorate(seed: string): PieceTypes[] {
  const r = Rng.stream(seed, 'types');
  return [0, 1, 2].map((county) => {
    const lv = new Float32Array(N_TYPES), rv = new Float32Array(N_TYPES);
    for (let h = 0; h < N_CLASS; h++) for (let g = 0; g < ZG; g++) { const z = g - ZG / 2 + 0.5; const w = 1000 * Math.exp(-((z - (county - 1) * 0.8) ** 2) / 6) * (0.5 + r.float()); rv[h * ZG + g] = w; lv[h * ZG + g] = w * (0.45 + 0.1 * Math.abs(z) / 3); }
    return { county, cd: 0, lv, rv };
  });
}
const contest: KernelContest = { id: 1, cd: -1, weight: 1, abstain: -4, options: [0.5, -0.5].map((partySign) => ({ partySign, base: 0, classFit: [0, 0, 0, 0], minorAppeal: 0, homeCounty: -1, homeState: false })) };
const plain: PollDesign = { n: 800, deff: 1.5, population: 'LV', lvScreen: 0, house: 0, classBias: [0, 0, 0, 0], partisanNonresponse: 0, undecided: 0 };
const area = (pieces: PieceTypes[], zShift = 0) => [{ contest, pieces, zShift: [zShift, zShift, zShift, zShift], bonuses: { homeStateBonus: 0, homeCountyBonus: 0 } }];

function margins(design: PollDesign, k: number, seed: string, zShift = 0): number[] {
  const pieces = electorate('E1');
  return Array.from({ length: k }, (_, i) => { const p = fieldPoll(area(pieces, zShift), design, [0.9, 0.9], Rng.stream(seed, i)); return (100 * (p.counts[0]! - p.counts[1]!)) / p.n; });
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

describe('poll fieldwork (measurement port)', () => {
  it('sampling error matches the effective sample size; the mean is unbiased', () => {
    const big = margins({ ...plain, n: 200000, deff: 1 }, 5, 'truth');
    const truth = mean(big);
    const m = margins(plain, 3000, 'samp');
    const expected = 100 * Math.sqrt((4 * 0.25 * plain.deff) / plain.n); // SD of a margin with shares near 50%
    expect(Math.abs(mean(m) - truth)).toBeLessThan(0.25);
    expect(sd(m)).toBeGreaterThan(expected * 0.85); expect(sd(m)).toBeLessThan(expected * 1.15);
  });
  it('house effects, partisan nonresponse and swings move results in the designed direction', () => {
    const base = mean(margins(plain, 400, 'a'));
    expect(mean(margins({ ...plain, house: 0.04 }, 400, 'b'))).toBeGreaterThan(base + 1);
    expect(mean(margins({ ...plain, partisanNonresponse: 0.05 }, 400, 'c'))).toBeGreaterThan(base + 1);
    expect(mean(margins(plain, 400, 'd', -0.1))).toBeLessThan(base - 2);
  });
  it('undecided voters reduce reported shares, more for little-known candidates', () => {
    const pieces = electorate('E1');
    const p = fieldPoll(area(pieces), { ...plain, n: 100000, deff: 1, undecided: 0.12 }, [0.9, 0.3], Rng.stream('u'));
    expect(p.undecided / p.n).toBeGreaterThan(0.04);
    expect(p.counts[0]! / p.n).toBeGreaterThan(p.counts[1]! / p.n);
  });
  it('systematic errors across the pollster population have a realistic spread (house effects ~1.5 points, cycle misses ~1 point here)', () => {
    // A more realistic electorate for this check: classes differ in partisanship and in candidate fit.
    const r = Rng.stream('E2', 'types');
    const pieces: PieceTypes[] = [0, 1, 2].map((county) => {
      const lv = new Float32Array(N_TYPES), rv = new Float32Array(N_TYPES);
      for (let h = 0; h < N_CLASS; h++) for (let g = 0; g < ZG; g++) { const z = g - ZG / 2 + 0.5; const w = 1000 * Math.exp(-((z - (county - 1) * 0.8 - (h - 1.5) * 0.6) ** 2) / 8) * (0.5 + r.float()); rv[h * ZG + g] = w; lv[h * ZG + g] = w * (0.45 + 0.1 * Math.abs(z) / 3); }
      return { county, cd: 0, lv, rv };
    });
    const fit = [0.3, 0.1, -0.1, -0.3];
    const c2: KernelContest = { ...contest, options: [1, -1].map((s) => ({ partySign: s * 0.5, base: 0, classFit: fit.map((f) => s * f), minorAppeal: 0, homeCounty: -1, homeState: false })) };
    const ar = [{ contest: c2, pieces, zShift: [0, 0, 0, 0], bonuses: { homeStateBonus: 0, homeCountyBonus: 0 } }];
    const m = (d: Partial<PollDesign>) => { const p = fieldPoll(ar, { ...plain, ...d, n: 2_000_000, deff: 1 }, [0.95, 0.95], Rng.stream('x')); return (100 * (p.counts[0]! - p.counts[1]!)) / (p.counts[0]! + p.counts[1]!); };
    const t = m({});
    const house: number[] = [];
    for (let s = 0; s < 6; s++) for (const p of makePollsters(`S${s}`, [{ idx: 0, vep: 1e6 }], 2016)) house.push(m({ house: p.params.house, classBias: p.params.classBias, partisanNonresponse: p.params.partisanNonresponse, lvScreen: (1 - p.params.lvQuality) * p.params.lvTilt }) - t);
    const cyc = Array.from({ length: 200 }, (_, y) => { const c = cycleBias('S', 2000 + y); return m({ classBias: c.classBias, partisanNonresponse: c.partisanNonresponse }) - t; });
    const rms = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    console.log(`pollster systematic error: rms ${rms(house).toFixed(2)}, max ${Math.max(...house.map(Math.abs)).toFixed(2)} points; cycle miss rms ${rms(cyc).toFixed(2)}`);
    expect(rms(house)).toBeGreaterThan(0.7); expect(rms(house)).toBeLessThan(2.5);
    expect(Math.max(...house.map(Math.abs))).toBeLessThan(6);
    expect(rms(cyc)).toBeGreaterThan(0.4); expect(rms(cyc)).toBeLessThan(2.2);
  });
  it('fictional pollsters only', () => {
    const ps = makePollsters('S', [{ idx: 0, vep: 1e6 }, { idx: 1, vep: 4e6 }], 2016);
    expect(ps.length).toBeGreaterThan(25);
    for (const p of ps) expect(/gallup|marist|quinnipiac|monmouth|siena|emerson|rasmussen|yougov|ipsos/i.test(p.name)).toBe(false);
    expect(new Set(ps.map((p) => p.name)).size).toBe(ps.length);
  });
});

describe('polling averages', () => {
  it('the 80% band covers the truth about 80% of the time (random-walk truth, noisy polls with house effects)', () => {
    let covered = 0, total = 0;
    for (let rep = 0; rep < 40; rep++) {
      const r = Rng.stream('cov', rep);
      const days = 150; const truth: number[] = []; let x = r.normal(0, 4);
      for (let d = 0; d < days; d++) { x += r.normal(0, 0.22); truth.push(x); }
      const house = new Map<number, number>([1, 2, 3, 4, 5, 6].map((p) => [p, r.normal(0, 1.2)]));
      const polls: PollObs[] = [];
      for (let d = 5; d < days; d++) for (let p = 1; p <= 6; p++) if (r.bernoulli(0.06)) {
        const n = 600 + r.int(600); const m = truth[d]! + house.get(p)! + r.normal(0, 100 * Math.sqrt(1.6 / n));
        polls.push({ day: d, pollster: p, n, shares: { a: 50 + m / 2, b: 50 - m / 2 } });
      }
      const est = houseEffects(polls.map((p) => ({ pollster: p.pollster, resid: (p.shares.a! - p.shares.b!) - truth[p.day]! })));
      for (const d of [60, 90, 120, 149]) {
        const a = raceAverage(polls, d, est, ['a', 'b']); if (!a?.margin) continue;
        total++; if (truth[d]! >= a.margin.lo && truth[d]! <= a.margin.hi) covered++;
      }
    }
    const rate = covered / total;
    console.log(`80% band coverage: ${(100 * rate).toFixed(1)}% of ${total}`);
    expect(rate).toBeGreaterThan(0.68); expect(rate).toBeLessThan(0.93);
  });
  it('the Kalman filter tracks a level and widens with time since the last poll', () => {
    const obs = [{ day: 0, y: 4, v: 9 }, { day: 1, y: 6, v: 9 }, { day: 2, y: 5, v: 9 }];
    const a = kalman(obs, 2), b = kalman(obs, 40);
    expect(a.mean).toBeGreaterThan(4); expect(a.mean).toBeLessThan(6);
    expect(b.sd).toBeGreaterThan(a.sd);
  });
});
