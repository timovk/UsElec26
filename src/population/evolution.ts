/**
 * Demographic evolution (docs/architecture/04-statistical-methodology.md §4.2; Phase 6).
 *
 * The universe's population changes each January 1: adults age from one band to the next, some die, new
 * eligible voters enter (18-year-olds and naturalized citizens), and people move between counties (domestic
 * and international migration). The state is kept per county, as flows in counts, so the accounting
 * identities hold exactly:
 *
 *     adults(t+1) = adults(t) − deaths + entrants + net migration       (per county, per age band)
 *
 * Race and college attainment are carried by the same flows. Base Units follow their county: each BU keeps
 * its 2016 composition relative to the county and a small persistent growth deviation of its own, so the
 * county totals hold and neighbourhoods keep their character while they change.
 */
import { Rng } from '../core/rng';
import { dlog } from '../core/math';
import type { GeoPack } from '../geo/pack';
import { N_COHORTS, interactionSeed, rake, type Marginals } from './cohorts';
import { MARG_STRIDE, type Population } from './population';

export const BASE_YEAR = 2016;

/** Per county: eligible adults and their composition (counts by age band, race, and college by age band). */
export interface DemographyState {
  year: number;
  /** Adults (voting-eligible) by age band: C × 4. */
  age: Float64Array;
  /** Adults by race (White, Black, Hispanic, Asian/other): C × 4. */
  race: Float64Array;
  /** College graduates by age band: C × 4. */
  college: Float64Array;
  /** Total resident population (all ages, all residents): C. Used for the census. */
  total: Float64Array;
  /** Persistent growth deviation of each county (per year) and of each Census division. */
  trend: Float64Array;
  divTrend: Float64Array;
}

/** What one year's step did, nationally (for tests and summaries), and the per-county shares the electorate needs. */
export interface DemographyFlows {
  deaths: number; entrants: number; migration: number; adultsBefore: number; adultsAfter: number;
  /** Per county: share of the 18–29 band that is newly eligible this year. */
  entrantShare: Float64Array;
  /** Per county and band: share of the band's new stock that aged in from the band below. */
  agingInShare: Float64Array;
  /** Per county: in-migrants as a share of the new adult population (0 where the county lost people). */
  inMigrantShare: Float64Array;
}

const AGE_SPAN = [12, 15, 20, 0];                       // years in each band (65+ has no exit but death)
const MORTALITY = [0.0012, 0.0022, 0.0075, 0.042];      // annual deaths per adult by band
const MIGRANT_AGE = [0.4, 0.35, 0.18, 0.07];
const NATURALIZED_RACE = [0.08, 0.12, 0.45, 0.35];
const DEATH_RACE_TILT = [1.25, 0.9, 0.55, 0.7];          // deaths skew older, and older adults are whiter
const ENTRANT_RACE_TILT = [0.86, 1.08, 1.35, 1.2];        // the young are more diverse

/** County composition of the base (2016) population, from its BU marginals. */
export function initialDemography(pack: GeoPack, pop: Population): DemographyState {
  const C = pack.counties.length;
  const age = new Float64Array(C * 4), race = new Float64Array(C * 4), college = new Float64Array(C * 4), total = new Float64Array(C), trend = new Float64Array(C);
  for (const county of pack.counties) {
    const c = county.idx;
    for (let b = county.buStart; b < county.buStart + county.buCount; b++) {
      const v = pop.vep[b]!; if (v <= 0) continue;
      const o = b * MARG_STRIDE;
      for (let a = 0; a < 4; a++) { const n = v * pop.marg[o + a]!; age[c * 4 + a]! += n; college[c * 4 + a]! += n * pop.marg[o + 9 + a]!; race[c * 4 + a]! += v * pop.marg[o + 5 + a]!; }
    }
    total[c] = county.pop2016;
    // The county's 2010–2016 growth relative to the nation, as a persistent trend that fades (half-life ~15 years).
    trend[c] = county.pop2010 > 0 && county.pop2016 > 0 ? Math.log(county.pop2016 / county.pop2010) / 6 : 0;
  }
  // Centre the trend (population-weighted) so it is a relative deviation.
  let s = 0, w = 0; for (let c = 0; c < C; c++) { s += trend[c]! * total[c]!; w += total[c]!; }
  const m = w > 0 ? s / w : 0;
  for (let c = 0; c < C; c++) trend[c] = Math.max(-0.03, Math.min(0.04, trend[c]! - m));
  return { year: BASE_YEAR, age, race, college, total, trend, divTrend: new Float64Array(10) };
}

const sum4 = (a: Float64Array, i: number) => a[i * 4]! + a[i * 4 + 1]! + a[i * 4 + 2]! + a[i * 4 + 3]!;

/** National parameters of the year: natural entry, naturalization and international migration (fractions of adults). */
export function nationalRates(year: number): { entry: number; naturalize: number; international: number } {
  const t = Math.max(0, year - BASE_YEAR);
  // International migrants become eligible voters through naturalization; net migration of citizens abroad is small.
  return { entry: 0.0172 - 0.00004 * t, naturalize: 0.0028, international: 0.0002 };
}

/** One year of demographic change, from `s.year` to `s.year + 1`. Deterministic in the seed and the year. */
export function stepDemography(seed: string, pack: GeoPack, s: DemographyState): { next: DemographyState; flows: DemographyFlows } {
  const C = pack.counties.length, year = s.year + 1;
  const r = Rng.stream(seed, 'demography', year);
  const rates = nationalRates(year);
  const age = Float64Array.from(s.age), race = Float64Array.from(s.race), college = Float64Array.from(s.college), total = Float64Array.from(s.total);
  const trend = new Float64Array(C), divTrend = new Float64Array(10);
  for (let d = 0; d < 10; d++) divTrend[d] = 0.9 * s.divTrend[d]! + r.normal(0, 0.0008);
  // National composition (for migrants and entrants' mix).
  const nRace = [0, 0, 0, 0]; let nAdults = 0, nYoung = 0;
  for (let c = 0; c < C; c++) { for (let k = 0; k < 4; k++) nRace[k]! += s.race[c * 4 + k]!; nAdults += sum4(s.age, c); nYoung += s.age[c * 4]!; }
  const nRaceShare = nRace.map((x) => x / (nAdults || 1));
  const youngN = nYoung / (nAdults || 1);
  // County growth from migration: persistent trend + division drift + noise, centred so the nation nets international migration.
  const mig = new Float64Array(C);
  let ms = 0, mw = 0;
  for (let c = 0; c < C; c++) {
    trend[c] = 0.93 * s.trend[c]! + r.normal(0, 0.0015);
    const div = pack.states[pack.counties[c]!.stateIdx]!.division;
    mig[c] = trend[c]! + divTrend[div]! + r.normal(0, 0.002);
    const n = sum4(s.age, c); ms += mig[c]! * n; mw += n;
  }
  const centre = mw > 0 ? ms / mw : 0;
  let deathsT = 0, entrantsT = 0, migT = 0, before = 0, after = 0;
  const entrantShare = new Float64Array(C), agingInShare = new Float64Array(C * 4), inMigrantShare = new Float64Array(C);
  const na = [0, 0, 0, 0], nc = [0, 0, 0, 0];
  for (let c = 0; c < C; c++) {
    const N = sum4(s.age, c); before += N;
    if (N <= 0) continue;
    for (let a = 0; a < 4; a++) { na[a] = s.age[c * 4 + a]!; nc[a] = s.college[c * 4 + a]!; }
    const colRate = na.map((x, a) => (x > 0 ? nc[a]! / x : 0));
    const raceShare = [0, 1, 2, 3].map((k) => s.race[c * 4 + k]! / N);
    // Aging between bands and deaths.
    const out = na.map((x, a) => (AGE_SPAN[a] ? x / AGE_SPAN[a]! : 0));
    const dead = na.map((x, a) => x * MORTALITY[a]!);
    const deaths = dead.reduce((p, q) => p + q, 0);
    // Entrants: 18-year-olds (more where the county is young) and naturalized citizens.
    const entr18 = N * rates.entry * (0.6 + 0.4 * (na[0]! / N) / (youngN || 0.2));
    const natur = N * rates.naturalize * (0.3 + 0.7 * (raceShare[2]! + raceShare[3]!) / Math.max(0.05, nRaceShare[2]! + nRaceShare[3]!));
    // Net migration: the county's migration rate on top of the nation's international migration.
    const M = N * (rates.international + mig[c]! - centre);
    const NAT_AGE = [0.25, 0.4, 0.3, 0.05];
    const preAge = [0, 1, 2, 3].map((a) => na[a]! - out[a]! - dead[a]! + (a > 0 ? out[a - 1]! : 0) + natur * NAT_AGE[a]! + (a === 0 ? entr18 : 0));
    // Out-migration cannot remove more than 80% of a band.
    const newAge = preAge.map((x, a) => Math.max(0.2 * x, x + M * MIGRANT_AGE[a]!));
    const Mreal = newAge.reduce((p, q) => p + q, 0) - preAge.reduce((p, q) => p + q, 0);
    // College attainment carried by the flows. Within 18–29 attainment is still being completed: the band's
    // rate follows a slowly rising trend, and those ageing out at 30 carry about 1.6 times the band's rate.
    // Older bands change by replacement (more educated cohorts ageing in, less educated ones dying).
    const NAT_COL = [0.3, 0.4, 0.3, 0.2];
    const outCol = [Math.min(0.92, 1.6 * colRate[0]!), colRate[1]!, colRate[2]!, colRate[3]!];
    const newCol = [0, 1, 2, 3].map((a) => {
      if (a === 0) return Math.min(0.9, colRate[0]! * 1.004 + 0.0004) * newAge[0]!;
      let x = nc[a]! - out[a]! * outCol[a]! - dead[a]! * colRate[a]! + out[a - 1]! * outCol[a - 1]! + natur * NAT_AGE[a]! * NAT_COL[a]!;
      const moved = newAge[a]! - preAge[a]!;
      x += moved * Math.min(0.95, colRate[a]! * (moved > 0 ? 1.1 : 1));
      return Math.max(0, Math.min(x, 0.97 * newAge[a]!));
    });
    // Race carried by the flows.
    const tilt = (share: number[], t: number[]) => { const v = share.map((x, k) => x * t[k]!); const z = v.reduce((p, q) => p + q, 0) || 1; return v.map((x) => x / z); };
    const deathMix = tilt(raceShare, DEATH_RACE_TILT), entrMix = tilt(raceShare, ENTRANT_RACE_TILT).map((x, k) => 0.7 * x + 0.3 * tilt(nRaceShare, ENTRANT_RACE_TILT)[k]!);
    const migMix = Mreal > 0 ? raceShare.map((x, k) => 0.5 * x + 0.5 * nRaceShare[k]!) : raceShare;
    for (let k = 0; k < 4; k++) race[c * 4 + k] = Math.max(0, s.race[c * 4 + k]! - deaths * deathMix[k]! + entr18 * entrMix[k]! + natur * NATURALIZED_RACE[k]! + Mreal * migMix[k]!);
    // Rescale race to the new adult total (rounding of the clamps above).
    const nNew = newAge.reduce((p, q) => p + q, 0);
    const rs = race[c * 4]! + race[c * 4 + 1]! + race[c * 4 + 2]! + race[c * 4 + 3]!;
    for (let k = 0; k < 4; k++) race[c * 4 + k] = rs > 0 ? race[c * 4 + k]! * nNew / rs : nNew / 4;
    for (let a = 0; a < 4; a++) { age[c * 4 + a] = newAge[a]!; college[c * 4 + a] = newCol[a]!; }
    // Total residents follow adults, a little slower while the population ages, plus immigrants who are not yet
    // citizens (more in gateway counties).
    total[c] = s.total[c]! * (1 + (nNew - N) / N - 0.0025 + 0.0022 * (0.4 + 0.6 * (raceShare[2]! + raceShare[3]!) / Math.max(0.05, nRaceShare[2]! + nRaceShare[3]!)));
    deathsT += deaths; entrantsT += entr18 + natur; migT += Mreal; after += nNew;
    entrantShare[c] = newAge[0]! > 0 ? (entr18 + natur * NAT_AGE[0]!) / newAge[0]! : 0;
    for (let a = 1; a < 4; a++) agingInShare[c * 4 + a] = newAge[a]! > 0 ? out[a - 1]! / newAge[a]! : 0;
    inMigrantShare[c] = Mreal > 0 && nNew > 0 ? Mreal / nNew : 0;
  }
  return { next: { year, age, race, college, total, trend, divTrend }, flows: { deaths: deathsT, entrants: entrantsT, migration: migT, adultsBefore: before, adultsAfter: after, entrantShare, agingInShare, inMigrantShare } };
}

/** A BU's persistent growth deviation (per year): a little noise and suburban spread (lower density grows faster). */
function buDeviation(seed: string, b: number, logDensRel: number): number {
  const r = Rng.stream(seed, 'bu-growth', b);
  return r.normal(0, 0.003) - 0.0015 * Math.max(-3, Math.min(3, logDensRel));
}

/**
 * The population of a year: the base (2016) population with each county scaled to its new totals and
 * composition, and each BU keeping its relative character and its own growth deviation.
 */
export function applyDemography(seed: string, pack: GeoPack, base: Population, baseState: DemographyState, s: DemographyState): Population {
  if (s.year === BASE_YEAR) return base;
  const B = base.bu, C = base.counties, years = s.year - BASE_YEAR;
  const vep = new Float32Array(B), marg = new Float32Array(base.marg.length);
  const buLogDensity = new Float32Array(B), countyVep = new Float64Array(C), stateVep = new Float64Array(pack.states.length);
  const countyLogDensity = new Float32Array(C);
  const countyJoint = new Float32Array(C * N_COHORTS);
  const seedCells = interactionSeed(), cells = new Float64Array(N_COHORTS);
  for (const county of pack.counties) {
    const c = county.idx, b0 = county.buStart, b1 = b0 + county.buCount;
    const N0 = sum4(baseState.age, c), N = sum4(s.age, c);
    const ratio = (arr0: Float64Array, arr: Float64Array, k: number, n0: number, n: number) => { const x0 = n0 > 0 ? arr0[c * 4 + k]! / n0 : 0; const x = n > 0 ? arr[c * 4 + k]! / n : 0; return x0 > 0 ? x / x0 : 1; };
    const ageR = [0, 1, 2, 3].map((a) => ratio(baseState.age, s.age, a, N0, N));
    const raceR = [0, 1, 2, 3].map((k) => ratio(baseState.race, s.race, k, N0, N));
    const colR = [0, 1, 2, 3].map((a) => { const r0 = baseState.age[c * 4 + a]! > 0 ? baseState.college[c * 4 + a]! / baseState.age[c * 4 + a]! : 0; const r1 = s.age[c * 4 + a]! > 0 ? s.college[c * 4 + a]! / s.age[c * 4 + a]! : 0; return r0 > 0 ? r1 / r0 : 1; });
    // BU growth deviations, normalized so the county total is exact.
    let raw = 0;
    for (let b = b0; b < b1; b++) {
      const v0 = base.vep[b]!; if (v0 <= 0) continue;
      const g = Math.exp(buDeviation(seed, b, base.buLogDensity[b]! - base.countyLogDensity[c]!) * years);
      vep[b] = v0 * g; raw += vep[b]!;
    }
    const k = raw > 0 ? N / raw : 0;
    const m: Marginals = { age: new Float64Array(4), male: 0, race: new Float64Array(4), collegeByAge: new Float64Array(4) };
    let w = 0;
    for (let b = b0; b < b1; b++) {
      vep[b] = vep[b]! * k;
      const o = b * MARG_STRIDE, v = vep[b]!;
      let az = 0, rz = 0;
      for (let a = 0; a < 4; a++) { az += base.marg[o + a]! * ageR[a]!; rz += base.marg[o + 5 + a]! * raceR[a]!; }
      for (let a = 0; a < 4; a++) {
        marg[o + a] = az > 0 ? base.marg[o + a]! * ageR[a]! / az : base.marg[o + a]!;
        marg[o + 5 + a] = rz > 0 ? base.marg[o + 5 + a]! * raceR[a]! / rz : base.marg[o + 5 + a]!;
        marg[o + 9 + a] = Math.min(0.97, base.marg[o + 9 + a]! * colR[a]!);
      }
      marg[o + 4] = base.marg[o + 4]!;
      const g = base.vep[b]! > 0 ? v / base.vep[b]! : 1;
      buLogDensity[b] = dlog(Math.exp(base.buLogDensity[b]!) * g);
      if (v > 0) {
        w += v;
        for (let a = 0; a < 4; a++) { m.age[a]! += v * marg[o + a]!; m.race[a]! += v * marg[o + 5 + a]!; m.collegeByAge[a]! += v * marg[o + a]! * marg[o + 9 + a]!; }
        m.male += v * marg[o + 4]!;
      }
    }
    countyVep[c] = N; stateVep[county.stateIdx]! += N;
    countyLogDensity[c] = dlog(Math.exp(base.countyLogDensity[c]!) * (N0 > 0 ? N / N0 : 1));
    if (w > 0) {
      for (let a = 0; a < 4; a++) { m.collegeByAge[a] = m.age[a]! > 0 ? m.collegeByAge[a]! / m.age[a]! : 0.25; m.age[a]! /= w; m.race[a]! /= w; }
      m.male /= w;
      cells.set(seedCells); rake(cells, m, 12);
      countyJoint.set(cells, c * N_COHORTS);
    } else countyJoint.set(base.countyJoint.subarray(c * N_COHORTS, (c + 1) * N_COHORTS), c * N_COHORTS);
  }
  return { ...base, vep, marg, countyJoint, countyVep, stateVep, buLogDensity, countyLogDensity };
}

/** National and state summaries of a year (for the record and the UI). */
export function demographySummary(pack: GeoPack, s: DemographyState): { year: number; adults: number; total: number; age: number[]; race: number[]; college: number; state: { adults: number; total: number }[] } {
  const S = pack.states.length;
  const state = Array.from({ length: S }, () => ({ adults: 0, total: 0 }));
  const age = [0, 0, 0, 0], race = [0, 0, 0, 0]; let adults = 0, total = 0, col = 0;
  for (const county of pack.counties) {
    const c = county.idx, n = sum4(s.age, c);
    state[county.stateIdx]!.adults += n; state[county.stateIdx]!.total += s.total[c]!;
    adults += n; total += s.total[c]!;
    for (let k = 0; k < 4; k++) { age[k]! += s.age[c * 4 + k]!; race[k]! += s.race[c * 4 + k]!; col += s.college[c * 4 + k]!; }
  }
  return { year: s.year, adults, total, age: age.map((x) => x / adults), race: race.map((x) => x / adults), college: col / adults, state };
}
