/**
 * The electorate's long-run evolution (docs/architecture/04-statistical-methodology.md §4.2; §3.8), one step a year.
 *
 * - **Platforms** move under three forces: vote seeking (the party out of the White House moves toward the
 *   swing electorate, harder the longer it has been out), activist pull (toward its own coalition), and
 *   leader imprint (toward its presidential nominee). The two parties never merge.
 * - **Attachments** (group–party identity) drift slowly and revert toward their founding values.
 * - **Partisanship** μ (per county × cohort) moves toward the target μ* the platforms imply, slowly and
 *   faster for the young. Cohorts carry their partisanship as they age into the next band, newly eligible
 *   voters start at the current target with no legacy, and in-migrants bring their group's national
 *   partisanship and half-adapt to their new county.
 *
 * - **Party competition** (the long-run guardrail): the trailing party recruits and rebrands, and a dominant
 *   coalition frays. The partisanship target shifts against the national leader in proportion to its lead
 *   (COMPETITION per point of margin), and voters follow at their usual, generational pace. Proportional, not
 *   cumulative, so it damps a lopsided electorate without swinging it to the other side.
 *
 * Realignment is therefore emergent: groups better represented by the other party drift, and generational
 * replacement accelerates it.
 */

/** μ shift per point of national two-party margin (against the leader). */
export const COMPETITION = 0.028;

/** National two-party margin (points, D+) of an electorate state under neutral conditions (county level). */
export function nationalMargin(mu: Float32Array, e: Electorate, pop: Population): number {
  const L = countyLean(mu, e.tables, pop);
  let d = 0, t = 0; for (let c = 0; c < pop.counties; c++) { d += L.dVotes[c]!; t += L.votes[c]!; }
  return t > 0 ? 100 * (2 * d / t - 1) : 0;
}
import { Rng } from '../core/rng';
import type { GeoPack } from '../geo/pack';
import { N_COHORTS, cohortAge } from '../population/cohorts';
import type { Population } from '../population/population';
import type { DemographyFlows } from '../population/evolution';
import { DIMS, buShift, countyLean, targetMu, type Electorate, type ElectorateParams } from './model';

export interface ElectorateDynamics {
  year: number;
  platforms: { D: number[]; R: number[] };
  attach: number[];
  /** Long-run partisanship per county × cohort (the electorate's μ). */
  mu: Float32Array;
}

export interface DynamicsContext {
  /** The party out of the White House and for how many consecutive terms. */
  outParty: number | null; outTerms: number;
  /** Presidential nominees' issue positions, when nominated this year (−1…1 per axis). */
  nominees: { D: number[] | null; R: number[] | null };
  flows: DemographyFlows | null;
}

export function initialDynamics(e: Electorate, year: number): ElectorateDynamics {
  return { year, platforms: { D: [...e.params.platforms.D], R: [...e.params.platforms.R] }, attach: [...e.params.attach], mu: Float32Array.from(e.mu) };
}

const RESPONSIVE = [0.12, 0.07, 0.045, 0.03];      // yearly relaxation toward μ* by age band

/** Average issue positions of the electorate: everyone, and each party's identifiers. */
function positions(params: ElectorateParams, pack: GeoPack, pop: Population, mu: Float32Array): { all: number[]; D: number[]; R: number[] } {
  const all = new Array<number>(DIMS).fill(0), D = new Array<number>(DIMS).fill(0), R = new Array<number>(DIMS).fill(0);
  let wa = 0, wd = 0, wr = 0;
  const kW = new Float64Array(N_COHORTS), kD = new Float64Array(N_COHORTS);
  for (const county of pack.counties) {
    const c = county.idx, v = pop.countyVep[c]!;
    for (let k = 0; k < N_COHORTS; k++) {
      const w = v * pop.countyJoint[c * N_COHORTS + k]!; if (w <= 0) continue;
      const pD = 1 / (1 + Math.exp(-1.6 * mu[c * N_COHORTS + k]! / Math.sqrt(1 + params.sigma[k]! ** 2)));
      kW[k]! += w; kD[k]! += w * pD;
    }
  }
  for (let k = 0; k < N_COHORTS; k++) {
    const w = kW[k]!; if (w <= 0) continue;
    const pD = kD[k]! / w;
    for (let d = 0; d < DIMS; d++) { const x = params.cohortPos[k * DIMS + d]!; all[d]! += w * x; D[d]! += w * pD * x; R[d]! += w * (1 - pD) * x; }
    wa += w; wd += w * pD; wr += w * (1 - pD);
  }
  return { all: all.map((x) => x / (wa || 1)), D: D.map((x) => x / (wd || 1)), R: R.map((x) => x / (wr || 1)) };
}

/** One year of electorate evolution. Returns the new dynamic state (the caller rebuilds the electorate from it). */
export function stepElectorate(seed: string, year: number, e: Electorate, dyn: ElectorateDynamics, pack: GeoPack, pop: Population, basePop: Population, ctx: DynamicsContext): ElectorateDynamics {
  const r = Rng.stream(seed, 'electorate-dynamics', year);
  const params = e.params;
  const pos = positions(params, pack, pop, dyn.mu);
  // Platforms.
  const next = { D: [...dyn.platforms.D], R: [...dyn.platforms.R] };
  for (const party of ['D', 'R'] as const) {
    const id = party === 'D' ? 1 : 2;
    const out = ctx.outParty === id;
    const voteSeeking = out ? 0.015 + 0.012 * Math.min(3, ctx.outTerms) : 0.004;
    const activist = 0.016;
    const nominee = ctx.nominees[party];
    const P = next[party];
    for (let d = 0; d < DIMS; d++) {
      let step = voteSeeking * (pos.all[d]! - P[d]!) + activist * (pos[party][d]! + (pos[party][d]! - pos.all[d]!) - P[d]!);
      if (nominee) step += 0.03 * (nominee[d]! - P[d]!);
      P[d] = P[d]! + step + r.normal(0, 0.02);
    }
  }
  // The parties stay distinct: at least 0.7 apart in the issue space.
  const gap = next.D.map((x, d) => x - next.R[d]!), dist = Math.hypot(...gap);
  if (dist < 0.7) { const f = (0.7 - dist) / 2 / (dist || 1); for (let d = 0; d < DIMS; d++) { next.D[d] = next.D[d]! + gap[d]! * f; next.R[d] = next.R[d]! - gap[d]! * f; } }
  // Attachments.
  const attach = dyn.attach.map((a, k) => a + 0.06 * (params.attach[k]! - a) + r.normal(0, 0.025));
  // Partisanship, with the competition shift against the national leader.
  const target = targetMu(params, next, attach, e.fields, pack, pop, basePop);
  const balance = -COMPETITION * nationalMargin(dyn.mu, e, pop);
  for (let i = 0; i < target.length; i++) target[i] = target[i]! + balance;
  const C = pack.counties.length;
  const old = dyn.mu, mu = new Float32Array(old.length);
  // National cohort partisanship (in-migrants' origin), VEP-weighted.
  const natMu = new Float64Array(N_COHORTS), natW = new Float64Array(N_COHORTS);
  for (let c = 0; c < C; c++) { const v = pop.countyVep[c]!; for (let k = 0; k < N_COHORTS; k++) { const w = v * pop.countyJoint[c * N_COHORTS + k]!; natMu[k]! += w * old[c * N_COHORTS + k]!; natW[k]! += w; } }
  for (let k = 0; k < N_COHORTS; k++) natMu[k] = natW[k]! > 0 ? natMu[k]! / natW[k]! : 0;
  const fl = ctx.flows;
  for (let c = 0; c < C; c++) {
    const drift = r.normal(0, 0.015);             // slow drift of the county's political culture
    const mig = fl ? fl.inMigrantShare[c]! : 0;
    for (let k = 0; k < N_COHORTS; k++) {
      const i = c * N_COHORTS + k, a = cohortAge(k);
      let x = old[i]!;
      if (fl) {
        if (a === 0) { const ent = fl.entrantShare[c]!; x = (1 - ent) * x + ent * target[i]!; }
        else { const g = fl.agingInShare[c * 4 + a]!; x = (1 - g) * x + g * old[i - 16]!; }  // same sex, education and race, one band younger
      }
      x += RESPONSIVE[a]! * (target[i]! - x);
      if (mig > 0) x = (1 - mig) * x + mig * (0.5 * natMu[k]! + 0.5 * target[i]!);
      mu[i] = x + drift;
    }
  }
  return { year, platforms: next, attach, mu };
}

/** The electorate for a dynamic state and population: μ from the state, BU shifts from the population. */
export function electorateAt(e: Electorate, dyn: ElectorateDynamics, pack: GeoPack, pop: Population): Electorate {
  const params = { ...e.params, platforms: dyn.platforms, attach: dyn.attach };
  return { params, fields: e.fields, mu: dyn.mu, buShift: buShift(params, e.fields, pack, pop), tables: e.tables };
}
