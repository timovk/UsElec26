/**
 * Short-term political environment of an election (docs/architecture/04 §4.6) and turnout calibration.
 * All shifts are in latent-partisanship (logit) units; positive favours Democrats.
 */
import { Rng } from '../core/rng';
import { dlogistic } from '../core/math';
import { civilToDays } from '../core/time';
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
  /**
   * Daily dynamics (§4.6): the components above are the *current* values = the cycle's level + a daily AR(1)
   * deviation, so campaigns move and polls can see it. `level` holds the cycle's levels; `dev` the deviations
   * as of `day` (an Eastern day number). Absent on environments saved before Phase 5 (they stay static).
   */
  level?: { national: number; classSwing: number[]; division: number[]; state: number[] };
  /** The economy and the President's standing as felt at the ballot box today (logit, D+; Phase 6). */
  econ?: number;
  dev?: { national: number; classSwing: number[]; division: number[]; state: number[] };
  day?: number;
}

/** Daily deviation process: persistence per day and stationary SDs (logit). The cycle levels' SDs are reduced so totals match §4.6. */
export const DAILY = { phi: 0.995, national: 0.05, classSwing: 0.035, division: 0.02, state: 0.025 } as const; // ~0.3 points of national margin a day, ~3 points over a campaign
const LEVEL_SD = { random: Math.sqrt(0.13 ** 2 - DAILY.national ** 2), classSwing: Math.sqrt(0.09 ** 2 - DAILY.classSwing ** 2), division: Math.sqrt(0.05 ** 2 - DAILY.division ** 2), state: Math.sqrt(0.06 ** 2 - DAILY.state ** 2) };

export interface EnvironmentHistory { last: Environment | null }

const ar = (prev: number | undefined, rho: number, sd: number, r: Rng) => (prev ?? 0) * rho + Math.sqrt(1 - rho * rho) * r.normal(0, sd);

/**
 * Draw the environment of the November cycle of `year`. Components persist from the previous cycle (AR(1)),
 * so trends carry over. `presParty` is the party holding the White House, `termsHeld` how many consecutive
 * terms it has held it, `midterm` whether this is a midterm year.
 */
export function drawEnvironment(seed: string, year: number, pack: GeoPack, prev: Environment | null, ctx: { presParty: number; termsHeld: number; midterm: boolean; economy?: boolean }): Environment {
  const r = Rng.stream(seed, 'environment', year);
  const sign = ctx.presParty === 1 ? 1 : -1; // shifts that hurt the President's party
  const timeForChange = ctx.termsHeld >= 2 ? -0.05 * sign : 0;
  const midterm = ctx.midterm ? -0.11 * sign : 0;
  // Before Phase 6 a random stub stood for the economy; with the economy model its effect enters daily (`econ`).
  const stub = r.normal(0, 0.05) * sign;
  const economyStub = ctx.economy ? 0 : stub;
  // Persistence across cycles works on the previous cycle's levels (its final daily deviation is not carried).
  const pl = prev?.level;
  const random = ar(prev?.fundamentals.random, 0.3, LEVEL_SD.random, r);
  const classSwing = Array.from({ length: N_CLASS }, (_, h) => ar(pl?.classSwing[h] ?? prev?.classSwing[h], 0.6, LEVEL_SD.classSwing, r));
  const division = Array.from({ length: 10 }, (_, d) => (d === 0 ? 0 : ar(pl?.division[d] ?? prev?.division[d], 0.5, LEVEL_SD.division, r)));
  const state = pack.states.map((_, s) => ar(pl?.state[s] ?? prev?.state[s], 0.5, LEVEL_SD.state, r));
  const county = pack.counties.map((_, c) => ar(prev?.county[c], 0.6, 0.07, r));
  const national = timeForChange + midterm + economyStub + random;
  // Initial daily deviations: stationary draws on January 1 of the election year.
  const rd = Rng.stream(seed, 'environment-daily-init', year);
  const dev = { national: rd.normal(0, DAILY.national), classSwing: classSwing.map(() => rd.normal(0, DAILY.classSwing)), division: division.map((_, i) => (i === 0 ? 0 : rd.normal(0, DAILY.division))), state: state.map(() => rd.normal(0, DAILY.state)) };
  const env: Environment = {
    year, national,
    fundamentals: { timeForChange, midterm, economyStub, random },
    classSwing, division, state, county,
    enthusiasm: r.normal(0, 0.18) + (ctx.midterm ? -0.15 * sign : 0),
    modeGap: [0, r.normal(0, 0.05), ar(prev?.modeGap[2], 0.7, 0.07, r), 0],
    stateTurnout: pack.states.map(() => r.normal(0, 0.09)),
    countyTurnout: pack.counties.map(() => r.normal(0, 0.07)),
    level: { national, classSwing: [...classSwing], division: [...division], state: [...state] },
    dev, day: civilDayOf(year),
  };
  applyDev(env);
  return env;
}

const civilDayOf = (year: number) => civilToDays(year, 1, 1);

function applyDev(env: Environment): void {
  const l = env.level!, d = env.dev!;
  env.national = l.national + d.national + (env.econ ?? 0);
  env.classSwing = l.classSwing.map((x, i) => x + d.classSwing[i]!);
  env.division = l.division.map((x, i) => x + d.division[i]!);
  env.state = l.state.map((x, i) => x + d.state[i]!);
}

/** Set today's economic term (logit, D+) and re-apply the current values. */
export function setEnvironmentEconomy(env: Environment, econ: number): void {
  env.econ = econ;
  if (env.level && env.dev) applyDev(env);
}

/**
 * Advance the daily deviations to `day` (one AR(1) step per day, each day's innovations from its own stream,
 * so the path does not depend on when it is computed). Environments without daily dynamics are left alone.
 */
export function stepEnvironment(seed: string, env: Environment, day: number): boolean {
  if (!env.level || !env.dev || env.day === undefined || day <= env.day) return false;
  const { phi } = DAILY, k = Math.sqrt(1 - phi * phi);
  const d = env.dev;
  for (let t = env.day + 1; t <= day; t++) {
    const r = Rng.stream(seed, 'environment-day', env.year, t);
    d.national = phi * d.national + k * r.normal(0, DAILY.national);
    for (let i = 0; i < d.classSwing.length; i++) d.classSwing[i] = phi * d.classSwing[i]! + k * r.normal(0, DAILY.classSwing);
    for (let i = 1; i < d.division.length; i++) d.division[i] = phi * d.division[i]! + k * r.normal(0, DAILY.division);
    for (let i = 0; i < d.state.length; i++) d.state[i] = phi * d.state[i]! + k * r.normal(0, DAILY.state);
  }
  env.day = day;
  applyDev(env);
  return true;
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
