/**
 * Ranked-choice tabulation (Phase 7.1): known-answer cases with certain transfers (utility gaps so large the
 * Plackett–Luce choice is exact), and properties on random ballots: every ballot is accounted for in every round,
 * the winner has a majority of the continuing ballots (or is the last one standing), and the same stream gives the
 * same result.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng';
import { tabulateRcv, type RcvBallots } from '../../../src/counting/rcv';

/** One area; `prefs[t]` lists utilities per candidate then "stop" for voter type t; `comp[j][t]` who is behind each first choice. */
function oneArea(first: number[], comp: number[][], prefs: number[][]): RcvBallots {
  const J = first.length, T = prefs.length;
  return { J, areas: 1, T, first, comp: comp.flat(), util: prefs.flat() };
}
const rng = () => Rng.stream('rcv-test', 'stream');
const tallies = (r: ReturnType<typeof tabulateRcv>) => r.rounds.map((x) => x.tallies);

describe('instant runoff: known answers', () => {
  it('a first-round majority ends the count in one round', () => {
    const r = tabulateRcv(oneArea([60, 30, 10], [[1], [1], [1]], [[0, 0, 0, 0]]), rng());
    expect(r.rounds).toHaveLength(1);
    expect(r.winner).toBe(0);
    expect(r.rounds[0]!.elected).toBe(0);
    expect(r.runnerUp).toBe(1);
  });

  it('the last-placed candidate is eliminated and their ballots decide it', () => {
    // C's voters rank B next: A 40, B 35 + 25 = 60.
    const r = tabulateRcv(oneArea([40, 35, 25], [[1], [1], [1]], [[-100, 100, 0, -100]]), rng());
    expect(tallies(r)).toEqual([[40, 35, 25], [40, 60, 0]]);
    expect(r.rounds[0]!.eliminated).toEqual([2]);
    expect(r.winner).toBe(1);
    expect(r.runnerUp).toBe(0);
  });

  it('ballots with no further choice are exhausted', () => {
    // C's voters rank nobody else: A 40 of 75 continuing is a majority.
    const r = tabulateRcv(oneArea([40, 35, 25], [[1], [1], [1]], [[-100, -100, 0, 100]]), rng());
    expect(tallies(r)).toEqual([[40, 35, 25], [40, 35, 0]]);
    expect(r.rounds[1]!.exhausted).toBe(25);
    expect(r.winner).toBe(0);
  });

  it('transferred ballots keep their voters: they follow their own next preference', () => {
    // A 40, B 39, C 12, D 9, all of type 0 but B's (type 1). Type 0 ranks C then A.
    // Round 1: D out, its 9 go to C (21). Round 2: C out; all 21 are type 0 and go to A.
    const prefs = [[0, -100, 100, -100, -100], [-100, 100, 0, -100, -100]];
    const r = tabulateRcv(oneArea([40, 39, 12, 9], [[1, 1], [0, 1], [1, 0], [1, 0]], prefs), rng());
    expect(tallies(r)).toEqual([[40, 39, 12, 9], [40, 39, 21, 0], [61, 39, 0, 0]]);
    expect(r.winner).toBe(0);
  });

  it('a pile of mixed voters transfers in proportion to who is in it', () => {
    // C's own 12 voters (type 1) rank B next; the 9 it received from D (type 0) rank A. Piles are summarized by
    // their voters' types, so the 21 split at random with A's expected share 9/21.
    const prefs = [[0, -100, 100, -100, -100], [-100, 100, 0, -100, -100]];
    let toA = 0; const n = 400;
    for (let i = 0; i < n; i++) {
      const r = tabulateRcv(oneArea([40, 39, 12, 9], [[1, 1], [1, 1], [0, 1], [1, 0]], prefs), Rng.stream('rcv-test', 'mixed', i));
      expect(r.rounds[1]!.tallies).toEqual([40, 39, 21, 0]);
      toA += r.rounds[2]!.tallies[0]! - 40;
    }
    expect(toA / n).toBeGreaterThan(9 - 0.5);
    expect(toA / n).toBeLessThan(9 + 0.5);
  });

  it('candidates without votes are eliminated together', () => {
    const r = tabulateRcv(oneArea([45, 35, 20, 0, 0], [[1], [1], [1], [1], [1]], [[-100, 100, -100, -100, -100, -100]]), rng());
    expect(r.rounds[0]!.eliminated).toEqual([3, 4]);
    expect(tallies(r)).toEqual([[45, 35, 20, 0, 0], [45, 35, 20, 0, 0], [45, 55, 0, 0, 0]]);
  });

  it('each area transfers by its own voters', () => {
    // Area 0's C voters go to A, area 1's to B.
    const b: RcvBallots = {
      J: 3, areas: 2, T: 1, first: [20, 18, 6, 20, 24, 12], comp: [1, 1, 1, 1, 1, 1],
      util: [100, -100, 0, -100, /* area 1 */ -100, 100, 0, -100],
    };
    const r = tabulateRcv(b, rng());
    expect(tallies(r)).toEqual([[40, 42, 18], [46, 54, 0]]);
    expect(Array.from(r.byArea)).toEqual([26, 18, 0, 20, 36, 0]);
  });
});

describe('instant runoff: properties on random ballots', () => {
  it('conserves ballots, elects a majority of continuing ballots, and is reproducible', () => {
    const gen = Rng.stream('rcv-test', 'gen');
    for (let trial = 0; trial < 60; trial++) {
      const J = 2 + gen.int(5), areas = 1 + gen.int(6), T = 1 + gen.int(6);
      const first = Array.from({ length: areas * J }, () => gen.int(400));
      const comp = Array.from({ length: areas * J * T }, () => gen.float());
      const util = Array.from({ length: areas * T * (J + 1) }, () => gen.normal(0, 1.5));
      const b: RcvBallots = { J, areas, T, first, comp, util };
      const total = first.reduce((a, x) => a + x, 0);
      const r1 = tabulateRcv(b, Rng.stream('rcv-test', 'trial', trial));
      const r2 = tabulateRcv(b, Rng.stream('rcv-test', 'trial', trial));
      expect(r2).toEqual(r1);
      for (const round of r1.rounds) {
        expect(round.tallies.reduce((a, x) => a + x, 0) + round.exhausted).toBe(total);
        for (const v of round.tallies) expect(v).toBeGreaterThanOrEqual(0);
      }
      const fin = r1.rounds[r1.rounds.length - 1]!;
      const continuing = fin.tallies.reduce((a, x) => a + x, 0);
      const live = fin.tallies.filter((_, j) => !r1.rounds.slice(0, -1).some((x) => x.eliminated.includes(j))).length;
      expect(fin.elected).toBe(r1.winner);
      if (live > 2 && continuing > 0) expect(2 * fin.tallies[r1.winner]!).toBeGreaterThan(continuing);
      expect(Array.from(r1.byArea).reduce((a, x) => a + x, 0)).toBe(continuing);
      // Exhausted ballots only grow; eliminated candidates never come back.
      for (let i = 1; i < r1.rounds.length; i++) {
        expect(r1.rounds[i]!.exhausted).toBeGreaterThanOrEqual(r1.rounds[i - 1]!.exhausted);
        for (const e of r1.rounds[i - 1]!.eliminated) expect(r1.rounds[i]!.tallies[e]).toBe(0);
      }
    }
  });
});
