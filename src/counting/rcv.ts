/**
 * Ranked-choice (instant-runoff) tabulation (Phase 7.1; docs/architecture/04 §4.5 "Special methods").
 *
 * Rankings come from the same voter model as first choices: a voter of type t ranks candidates by a
 * Plackett–Luce (sequential multinomial logit) process over the contest's utilities, with a "stop ranking"
 * option that exhausts the ballot. Plackett–Luce has the independence property that matters here: a ballot's
 * next preference depends only on the voter's type and the candidates still in the race, not on the order of
 * the candidates already used. So each candidate's pile of ballots in an area can be summarized by the voter
 * types behind it, and piles merge freely.
 *
 * Tabulation is the usual single-winner instant runoff: each round, a candidate with more than half of the
 * continuing ballots wins; otherwise the last-placed candidate is eliminated (every candidate with no votes at
 * once) and each of their ballots moves to its next ranked continuing candidate or is exhausted. Transfers are
 * realized per reporting area as exact integer draws from a keyed stream, so every round's tallies plus the
 * exhausted ballots add up to the first-round ballots exactly.
 */
import { dexp } from '../core/math';
import type { Rng } from '../core/rng';

/**
 * How much more likely a voter is to stop ranking than to leave the first choice blank (logit units, added to
 * the contest's undervote utility). Calibrated so that, as in real instant runoffs, roughly a fifth to a third
 * of an eliminated minor candidate's ballots exhaust.
 */
export const RCV_STOP_SHIFT = 3;

export interface RcvBallots {
  /** Candidates and reporting areas. */
  J: number; areas: number;
  /** Voter types (the composition's last dimension). */
  T: number;
  /** First-choice ballots per area and candidate (areas × J), non-negative integers; blank first choices are not ballots here. */
  first: ArrayLike<number>;
  /** Expected voter-type mass behind each area's first choices (areas × J × T, any positive scale). */
  comp: ArrayLike<number>;
  /** Ranking utilities per area and type: the J candidates, then "stop ranking" (areas × T × (J + 1)). */
  util: ArrayLike<number>;
}

export interface RcvRound {
  /** Votes per candidate this round (0 for candidates already eliminated). */
  tallies: number[];
  /** Exhausted ballots so far. */
  exhausted: number;
  /** Candidates eliminated at the end of this round (empty in the final round). */
  eliminated: number[];
  /** The winner, in the final round. */
  elected: number | null;
}

export interface RcvResult {
  rounds: RcvRound[];
  winner: number;
  /** The other finalist (the strongest losing candidate of the final round), if any. */
  runnerUp: number | null;
  /** Final-round tallies per area (areas × J). */
  byArea: Int32Array;
}

/** Tabulate an instant runoff. `rng` breaks exact ties and realizes the transfers (one keyed stream per contest). */
export function tabulateRcv(b: RcvBallots, rng: Rng): RcvResult {
  const { J, areas, T } = b;
  const counts = Int32Array.from({ length: areas * J }, (_, i) => b.first[i]!);
  // Each pile's composition, scaled to its ballots (uniform over types if the model gave it no mass).
  const comp = Float64Array.from({ length: areas * J * T }, (_, i) => b.comp[i]!);
  for (let a = 0; a < areas; a++) for (let j = 0; j < J; j++) {
    const o = (a * J + j) * T, n = counts[a * J + j]!;
    let s = 0; for (let t = 0; t < T; t++) s += comp[o + t]!;
    for (let t = 0; t < T; t++) comp[o + t] = n <= 0 ? 0 : s > 0 ? comp[o + t]! * n / s : n / T;
  }
  const active = new Uint8Array(J).fill(1);
  const rounds: RcvRound[] = [];
  const history: number[][] = [];
  let exhausted = 0;
  const pick = (cands: number[], score: (j: number) => number, low: boolean): number => {
    // Extreme by `score`; ties broken by earlier rounds (most recent first), then by lot.
    let best = cands.filter((j) => score(j) === (low ? Math.min : Math.max)(...cands.map(score)));
    for (let r = history.length - 2; r >= 0 && best.length > 1; r--) {
      const h = history[r]!, ext = (low ? Math.min : Math.max)(...best.map((j) => h[j]!));
      best = best.filter((j) => h[j] === ext);
    }
    return best.length === 1 ? best[0]! : best[rng.int(best.length)]!;
  };
  const probs = new Float64Array(J + 1), draw = new Int32Array(J + 1);
  // Per type: the probability of each remaining candidate (and of stopping) as the next preference.
  const next = new Float64Array(T * (J + 1));
  for (;;) {
    const tallies = new Array<number>(J).fill(0);
    for (let a = 0; a < areas; a++) for (let j = 0; j < J; j++) if (active[j]) tallies[j]! += counts[a * J + j]!;
    history.push(tallies);
    const live = [...Array(J).keys()].filter((j) => active[j]);
    const continuing = live.reduce((s, j) => s + tallies[j]!, 0);
    const leader = pick(live, (j) => tallies[j]!, false);
    if (live.length <= 2 || 2 * tallies[leader]! > continuing || continuing === 0) {
      rounds.push({ tallies, exhausted, eliminated: [], elected: leader });
      const others = live.filter((j) => j !== leader);
      const runnerUp = others.length ? pick(others, (j) => tallies[j]!, false) : null;
      const byArea = new Int32Array(areas * J);
      for (let i = 0; i < byArea.length; i++) byArea[i] = active[i % J] ? counts[i]! : 0;
      return { rounds, winner: leader, runnerUp, byArea };
    }
    // Eliminate every candidate without votes at once (if at least two would remain), else the last-placed one.
    const zero = live.filter((j) => tallies[j] === 0);
    const out = zero.length && live.length - zero.length >= 2 ? zero : [pick(live, (j) => tallies[j]!, true)];
    rounds.push({ tallies, exhausted, eliminated: out, elected: null });
    for (const e of out) active[e] = 0;
    const remaining = live.filter((j) => active[j]);
    for (let a = 0; a < areas; a++) {
      // This area's next-preference probabilities by type, among the remaining candidates.
      let need = false;
      for (const e of out) if (counts[a * J + e]! > 0) need = true;
      if (!need) continue;
      for (let t = 0; t < T; t++) {
        const uo = (a * T + t) * (J + 1), no = t * (J + 1);
        let mx = b.util[uo + J]!;
        for (const k of remaining) mx = Math.max(mx, b.util[uo + k]!);
        let s = (next[no + J] = dexp(b.util[uo + J]! - mx));
        for (const k of remaining) { next[no + k] = dexp(b.util[uo + k]! - mx); s += next[no + k]!; }
        next[no + J]! /= s;
        for (const k of remaining) next[no + k]! /= s;
      }
      for (const e of out) {
        const n = counts[a * J + e]!; if (n <= 0) continue;
        const ce = (a * J + e) * T;
        probs.fill(0);
        for (let t = 0; t < T; t++) {
          const w = comp[ce + t]!; if (w <= 0) continue;
          const no = t * (J + 1);
          for (const k of remaining) probs[k]! += w * next[no + k]!;
          probs[J]! += w * next[no + J]!;
        }
        rng.multinomial(n, probs, draw);
        exhausted += draw[J]!;
        for (const k of remaining) {
          const x = draw[k]!; if (x <= 0) continue;
          counts[a * J + k]! += x;
          // The moved ballots' types: the expected mix of those who rank k next, scaled to the ballots moved.
          const ck = (a * J + k) * T;
          let ek = 0;
          for (let t = 0; t < T; t++) ek += comp[ce + t]! * next[t * (J + 1) + k]!;
          if (ek > 0) for (let t = 0; t < T; t++) comp[ck + t]! += comp[ce + t]! * next[t * (J + 1) + k]! * x / ek;
          else for (let t = 0; t < T; t++) comp[ck + t]! += x / T;
        }
        counts[a * J + e] = 0;
        for (let t = 0; t < T; t++) comp[ce + t] = 0;
      }
    }
  }
}
