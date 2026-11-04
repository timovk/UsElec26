import { describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { buildPopulation } from '../../../src/population/population';
import { generateElectorate } from '../../../src/electorate/model';
import { runShard, N_MODES, type KernelContest, type KernelOption } from '../../../src/electorate/kernel';
import { buildShard, stateRanges } from '../../../src/electorate/shards';
import { drawEnvironment, calibrateTurnout } from '../../../src/electorate/environment';

const pack = makeFixturePack();
const pop = buildPopulation(pack);
const e = generateElectorate('kern', pack, pop, 3);
const ranges = stateRanges(pack);
const env = drawEnvironment('kern', 2016, pack, null, { presParty: 1, termsHeld: 2, midterm: false });
const { tauE } = calibrateTurnout('kern', e, pop);
const opt = (partySign: number, base = 0): KernelOption => ({ partySign, base, classFit: [0, 0, 0, 0], minorAppeal: partySign === 0 ? 0.55 : 0, homeCounty: -1, homeState: false });
const s = pack.states.findIndex((x) => x.usps === 'PA');
const cds = pack.cds.filter((c) => c.stateIdx === s);
const contests: KernelContest[] = [
  { id: 1, cd: -1, weight: 1, abstain: -4.6, options: [opt(0.5), opt(-0.5), opt(0, -2.0)] },
  { id: 2, cd: -1, weight: 0.95, abstain: -3.4, options: [opt(0.5, 0.15), opt(-0.5)] },
  ...cds.map((cd, i) => ({ id: 10 + i, cd: cd.idx, weight: 0.9, abstain: -3.0, options: [opt(0.5), opt(-0.5, 0.2)] })),
];
const ctx = { seed: 'kern', electionKey: 'g2016', pack, pop, electorate: e, env, tauE, ranges };

describe('ballot kernel', () => {
  const inp = buildShard(ctx, s, 'general', 0, contests, 0.5);
  const out = runShard(inp);

  it('ballots ≤ eligible and modes partition ballots exactly', () => {
    for (let i = 0; i < out.ballots.length; i++) {
      expect(out.ballots[i]!).toBeLessThanOrEqual(out.eligible[i]!);
      let m = 0; for (let k = 0; k < N_MODES; k++) m += out.ballotsByMode[i * N_MODES + k]!;
      expect(m).toBe(out.ballots[i]!);
    }
  });

  it('every contest partitions exactly the ballots of every unit that votes in it', () => {
    const byBu = new Map<number, number>();
    for (let i = 0; i < out.ballots.length; i++) byBu.set(inp.bus.start + i, out.ballots[i]!);
    for (const c of out.contests) {
      const K = contests.find((x) => x.id === c.id)!.options.length + 1;
      for (let u = 0; u < c.units.length; u++) {
        let sum = 0; for (let j = 0; j < K; j++) { expect(c.votes[u * K + j]!).toBeGreaterThanOrEqual(0); sum += c.votes[u * K + j]!; }
        expect(sum).toBe(byBu.get(c.units[u]!)!);
      }
      // RJ × mode totals equal unit totals
      let a = 0, b = 0; for (const v of c.rjMode) a += v; for (const v of c.votes) b += v;
      expect(a).toBe(b);
    }
    // District contests cover each unit exactly once
    const covered = out.contests.filter((c) => c.id >= 10).reduce((n, c) => n + c.units.length, 0);
    expect(covered).toBe(out.contests[0]!.units.length);
  });

  it('realized totals track analytic expectations; turnout is plausible', () => {
    const c = out.contests[0]!; const K = 4;
    const tot = new Float64Array(K); for (let u = 0; u < c.units.length; u++) for (let j = 0; j < K; j++) tot[j]! += c.votes[u * K + j]!;
    const n = tot.reduce((x, y) => x + y, 0), en = c.expected.reduce((x, y) => x + y, 0);
    for (let j = 0; j < K; j++) expect(Math.abs(tot[j]! / n - c.expected[j]! / en)).toBeLessThan(0.01);
    const turnout = out.ballots.reduce((x, y) => x + y, 0) / out.eligible.reduce((x, y) => x + y, 0);
    expect(turnout).toBeGreaterThan(0.4); expect(turnout).toBeLessThan(0.8);
    expect(tot[3]! / n).toBeLessThan(0.03); // presidential undervote small
  });

  it('is deterministic and independent of shard evaluation order', () => {
    const other = runShard(buildShard(ctx, (s + 1) % pack.states.length, 'general', 0, [], 0));
    void other;
    const again = runShard(buildShard(ctx, s, 'general', 0, contests, 0.5));
    expect(Array.from(again.ballots)).toEqual(Array.from(out.ballots));
    expect(Array.from(again.contests[0]!.votes)).toEqual(Array.from(out.contests[0]!.votes));
  });

  it('primaries draw a smaller, partisan electorate', () => {
    const p = runShard(buildShard({ ...ctx, tauE: tauE - 0.9 }, s, 'primary', 1, [{ id: 99, cd: -1, weight: 0, abstain: -2.5, options: [opt(0, 0.2), opt(0, 0)] }], 0));
    const t = p.ballots.reduce((x, y) => x + y, 0) / p.eligible.reduce((x, y) => x + y, 0);
    expect(t).toBeGreaterThan(0.05); expect(t).toBeLessThan(0.35);
  });
});
