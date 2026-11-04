/**
 * Population model (Phase 1: the January 2016 base; evolution arrives in Phase 6).
 * Derived deterministically from the geography pack and the 2016 institutional baseline.
 */
import type { GeoPack } from '../geo/pack';
import { STATES_2016 } from '../rules/states2016';
import { dlog } from '../core/math';
import { COLLEGE_AGE_FACTOR, N_COHORTS, cohortAge, cohortEdu, cohortRace, cohortSex, interactionSeed, rake, type Marginals } from './cohorts';

export interface Population {
  bu: number;
  counties: number;
  /** Voting-eligible population per BU, January 2016: 2010 18+ count × county growth × smoothed citizenship rate × (1 − felony disenfranchisement). */
  vep: Float32Array;
  /** Per BU: age shares (×4), male share, race shares (×4), college-by-age (×4) — 13 floats per BU. */
  marg: Float32Array;
  /** County joint cohort shares (counties × 64), IPF-fitted to county marginals. */
  countyJoint: Float32Array;
  countyVep: Float64Array;
  stateVep: Float64Array;
  /** log persons per km² (2016 scaled), per BU and per county. */
  buLogDensity: Float32Array;
  countyLogDensity: Float32Array;
  /** log median household income, BU (imputed values flagged in the pack) and county (VEP-weighted). */
  buLogIncome: Float32Array;
  countyLogIncome: Float32Array;
}

export const MARG_STRIDE = 13;

export function buildPopulation(pack: GeoPack): Population {
  const B = pack.bu.rows, C = pack.counties.length;
  const u = pack.bu;
  const vep = new Float32Array(B);
  const marg = new Float32Array(B * MARG_STRIDE);
  const buLogDensity = new Float32Array(B), buLogIncome = new Float32Array(B);
  const countyVep = new Float64Array(C), stateVep = new Float64Array(pack.states.length);
  const felony = pack.states.map((s) => STATES_2016[s.usps]?.felonyShare ?? 0.015);

  // Citizenship rate: block-group CVAP (ACS 2012–2016) is a noisy survey estimate, so the BU rate is
  // shrunk toward its county's rate and capped at 1. The decennial 18+ count supplies the exact base.
  const cCvap = new Float64Array(pack.counties.length), cVap = new Float64Array(pack.counties.length);
  for (let b = 0; b < B; b++) { cCvap[u.county[b]!]! += u.cvap[b]!; cVap[u.county[b]!]! += u.vap2010[b]!; }
  const KAPPA = 400;
  for (let b = 0; b < B; b++) {
    const c = u.county[b]!, county = pack.counties[c]!;
    const growth = county.pop2010 > 0 ? county.pop2016 / county.pop2010 : 1;
    const countyRate = cVap[c]! > 0 ? Math.min(1, cCvap[c]! / cVap[c]!) : 0.9;
    const rate = Math.min(1, Math.max(0.2, (u.cvap[b]! + KAPPA * countyRate) / (u.vap2010[b]! + KAPPA)));
    const v = Math.max(0, u.vap2010[b]! * growth * rate * (1 - felony[county.stateIdx]!));
    vep[b] = v; countyVep[c]! += v; stateVep[county.stateIdx]! += v;

    const o = b * MARG_STRIDE;
    const a0 = u.a18_29[b]!, a1 = u.a30_44[b]!, a2 = u.a45_64[b]!, a3 = u.a65p[b]!;
    const at = a0 + a1 + a2 + a3 || 1;
    marg[o] = a0 / at; marg[o + 1] = a1 / at; marg[o + 2] = a2 / at; marg[o + 3] = a3 / at;
    marg[o + 4] = u.male18[b]! / 65535;
    const vap = u.vap2010[b]!;
    if (vap > 0) {
      const w = u.vapWhiteNH[b]! / vap, bl = u.vapBlackNH[b]! / vap, h = u.vapHisp[b]! / vap;
      marg[o + 5] = w; marg[o + 6] = bl; marg[o + 7] = h; marg[o + 8] = Math.max(0, 1 - w - bl - h);
    } else { marg[o + 5] = 0.62; marg[o + 6] = 0.12; marg[o + 7] = 0.15; marg[o + 8] = 0.11; }
    const col = u.college25[b]! / 65535;
    let norm = 0; for (let a = 0; a < 4; a++) norm += marg[o + a]! * COLLEGE_AGE_FACTOR[a]!;
    for (let a = 0; a < 4; a++) marg[o + 9 + a] = Math.min(0.97, col * COLLEGE_AGE_FACTOR[a]! / (norm || 1));

    const km2 = Math.max(u.landM2[b]! / 1e6, 0.01);
    buLogDensity[b] = dlog(1 + u.pop2010[b]! * growth / km2);
    const inc = u.medInc[b]!;
    buLogIncome[b] = Number.isFinite(inc) && inc > 0 ? dlog(inc) : NaN;
  }

  // County aggregates (VEP-weighted marginals) and IPF joint tables.
  const countyJoint = new Float32Array(C * N_COHORTS);
  const countyLogDensity = new Float32Array(C), countyLogIncome = new Float32Array(C);
  const seed = interactionSeed();
  const cells = new Float64Array(N_COHORTS);
  for (const county of pack.counties) {
    const c = county.idx, start = county.buStart, end = start + county.buCount;
    const m: Marginals = { age: new Float64Array(4), male: 0, race: new Float64Array(4), collegeByAge: new Float64Array(4) };
    let w = 0, incW = 0, incS = 0;
    for (let b = start; b < end; b++) {
      const v = vep[b]!; if (v <= 0) continue;
      const o = b * MARG_STRIDE; w += v;
      for (let a = 0; a < 4; a++) { m.age[a]! += v * marg[o + a]!; m.race[a]! += v * marg[o + 5 + a]!; m.collegeByAge[a]! += v * marg[o + a]! * marg[o + 9 + a]!; }
      m.male += v * marg[o + 4]!;
      if (Number.isFinite(buLogIncome[b]!)) { incS += v * buLogIncome[b]!; incW += v; }
    }
    if (w > 0) {
      for (let a = 0; a < 4; a++) { m.collegeByAge[a] = m.age[a]! > 0 ? m.collegeByAge[a]! / m.age[a]! : 0.25; m.age[a]! /= w; m.race[a]! /= w; }
      m.male /= w;
    } else { m.age.set([0.21, 0.25, 0.34, 0.2]); m.race.set([0.62, 0.12, 0.15, 0.11]); m.male = 0.48; m.collegeByAge.set([0.25, 0.35, 0.3, 0.25]); }
    cells.set(seed); rake(cells, m, 12);
    countyJoint.set(cells, c * N_COHORTS);
    const km2 = Math.max(county.landM2 / 1e6, 0.01);
    countyLogDensity[c] = dlog(1 + county.pop2016 / km2);
    countyLogIncome[c] = incW > 0 ? incS / incW : 10.8;
  }
  // Fill missing BU incomes with the county value.
  for (let b = 0; b < B; b++) if (!Number.isFinite(buLogIncome[b]!)) buLogIncome[b] = countyLogIncome[u.county[b]!]!;

  return { bu: B, counties: C, vep, marg, countyJoint, countyVep, stateVep, buLogDensity, countyLogDensity, buLogIncome, countyLogIncome };
}

/** Cohort shares of a Base Unit's electorate: the county joint raked to the BU's marginals. */
export function buCohortShares(pop: Population, b: number, county: number, out: Float64Array): Float64Array {
  for (let k = 0; k < N_COHORTS; k++) out[k] = pop.countyJoint[county * N_COHORTS + k]!;
  const o = b * MARG_STRIDE, mg = pop.marg;
  const m: Marginals = {
    age: Float64Array.of(mg[o]!, mg[o + 1]!, mg[o + 2]!, mg[o + 3]!), male: mg[o + 4]!,
    race: Float64Array.of(mg[o + 5]!, mg[o + 6]!, mg[o + 7]!, mg[o + 8]!),
    collegeByAge: Float64Array.of(mg[o + 9]!, mg[o + 10]!, mg[o + 11]!, mg[o + 12]!),
  };
  rake(out, m, 3);
  return out;
}

/** National cohort composition of the electorate (for summaries and tests). */
export function nationalCohortShares(pop: Population): Float64Array {
  const out = new Float64Array(N_COHORTS); let t = 0;
  for (let c = 0; c < pop.counties; c++) {
    const v = pop.countyVep[c]!;
    for (let k = 0; k < N_COHORTS; k++) { out[k]! += v * pop.countyJoint[c * N_COHORTS + k]!; }
    t += v;
  }
  for (let k = 0; k < N_COHORTS; k++) out[k]! /= t || 1;
  return out;
}

export { cohortAge, cohortEdu, cohortRace, cohortSex };
