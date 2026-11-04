/**
 * Short-term political environment of an election (docs/architecture/04 §4.6) and turnout calibration.
 * All shifts are in latent-partisanship (logit) units; positive favours Democrats.
 */
import { Rng } from '../core/rng';
import { dlogistic } from '../core/math';
import type { GeoPack } from '../geo/pack';
import type { Population } from '../population/population';
import { N_COHORTS } from '../population/cohorts';
import type { Electorate } from './model';
import { gaussHermite } from './model';

const GH6 = gaussHermite(6);
import { N_CLASS } from './kernel';

export interface Environment {
  year: number;
  national: number;
  fundamentals: { timeForChange: number; midterm: number; economyStub: number; random: number };
  classSwing: number[];      // N_CLASS
  division: number[];        // 10
  state: number[];           // states
  county: number[];          // counties
  enthusiasm: number;        // partisan enthusiasm gap ε_N
  modeGap: number[];         // 4 modes
  stateTurnout: number[];    // states
  countyTurnout: number[];   // counties
}

export interface EnvironmentHistory { last: Environment | null }

const ar = (prev: number | undefined, rho: number, sd: number, r: Rng) => (prev ?? 0) * rho + Math.sqrt(1 - rho * rho) * r.normal(0, sd);

/**
 * Draw the environment of the November cycle of `year`. Components persist from the previous cycle (AR(1)),
 * so trends carry over. `presParty` is the party holding the White House, `termsHeld` how many consecutive
 * terms it has held it, `midterm` whether this is a midterm year.
 */
export function drawEnvironment(seed: string, year: number, pack: GeoPack, prev: Environment | null, ctx: { presParty: number; termsHeld: number; midterm: boolean }): Environment {
  const r = Rng.stream(seed, 'environment', year);
  const sign = ctx.presParty === 1 ? 1 : -1; // shifts that hurt the President's party
  const timeForChange = ctx.termsHeld >= 2 ? -0.05 * sign : 0;
  const midterm = ctx.midterm ? -0.11 * sign : 0;
  const economyStub = r.normal(0, 0.05) * sign; // labelled stub until the economy model (Phase 6)
  const random = ar(prev?.fundamentals.random, 0.3, 0.13, r);
  const classSwing = Array.from({ length: N_CLASS }, (_, h) => ar(prev?.classSwing[h], 0.6, 0.09, r));
  const division = Array.from({ length: 10 }, (_, d) => (d === 0 ? 0 : ar(prev?.division[d], 0.5, 0.05, r)));
  const state = pack.states.map((_, s) => ar(prev?.state[s], 0.5, 0.06, r));
  const county = pack.counties.map((_, c) => ar(prev?.county[c], 0.6, 0.07, r));
  return {
    year, national: timeForChange + midterm + economyStub + random,
    fundamentals: { timeForChange, midterm, economyStub, random },
    classSwing, division, state, county,
    enthusiasm: r.normal(0, 0.18) + (ctx.midterm ? -0.15 * sign : 0),
    modeGap: [0, r.normal(0, 0.05), ar(prev?.modeGap[2], 0.7, 0.07, r), 0],
    stateTurnout: pack.states.map(() => r.normal(0, 0.09)),
    countyTurnout: pack.counties.map(() => r.normal(0, 0.07)),
  };
}

/** Expected VEP turnout of a presidential general for intercept tauE (county-level quadrature). */
function expectedTurnout(e: Electorate, pop: Population, tauE: number): number {
  let num = 0, den = 0;
  const p = e.params;
  for (let c = 0; c < pop.counties; c++) {
    const v = pop.countyVep[c]!; if (v <= 0) continue;
    let t = 0;
    for (let k = 0; k < N_COHORTS; k++) {
      const sh = pop.countyJoint[c * N_COHORTS + k]!; if (sh <= 0) continue;
      let ex = 0;
      for (let q = 0; q < GH6.x.length; q++) { const z = e.mu[c * N_COHORTS + k]! + p.sigma[k]! * GH6.x[q]!; ex += GH6.w[q]! * dlogistic(tauE + p.turnoutBase[k]! + p.betaIntensity * Math.abs(z)); }
      t += sh * ex;
    }
    num += v * t; den += v;
  }
  return num / den;
}

/** Find the presidential-general turnout intercept that hits the universe's target turnout. */
export function calibrateTurnout(seed: string, e: Electorate, pop: Population): { tauE: number; target: number; achieved: number } {
  const target = Rng.stream(seed, 'turnout', 'target').range(0.55, 0.64);
  // Secant iterations on a monotone function (a handful of national evaluations).
  let x0 = -1, x1 = 0.5, f0 = expectedTurnout(e, pop, x0) - target, f1 = expectedTurnout(e, pop, x1) - target;
  for (let i = 0; i < 8 && Math.abs(f1) > 1e-5; i++) { const x2 = x1 - f1 * (x1 - x0) / (f1 - f0 || 1e-9); x0 = x1; f0 = f1; x1 = Math.max(-5, Math.min(4, x2)); f1 = expectedTurnout(e, pop, x1) - target; }
  const tauE = x1;
  return { tauE, target, achieved: expectedTurnout(e, pop, tauE) };
}

/** Election-type turnout offsets relative to a presidential general (logit). */
export const TURNOUT_OFFSET = { presidential: 0, midterm: -0.75, offyear: -1.05, special: -1.25, primary: -0.9, runoff: -1.4 } as const;
