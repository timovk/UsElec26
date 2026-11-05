/**
 * The latent electorate (docs/architecture/04-statistical-methodology.md §4.1–4.3, §4.7).
 *
 * Partisanship of a voter in Base Unit b and cohort k: z ~ N(μ_{c(b),k} + γ_b, σ_k²), z > 0 leans Democratic.
 *   μ_{c,k} = intercept
 *           + sGroup  · ( 2λ (P_D − P_R) · (x_k + r_div(c)) + a_k )       coalition structure (fictional, per universe)
 *           + sRegion · ( g_div + g_state ) + sCounty · g_county            multiscale, spatially smoothed political culture
 *           + sIid    · ε_county                                           unsmoothed county idiosyncrasy
 *           + sCov    · ( β_urb · zDensity_c + β_inc · zIncome_c )         place covariates with random-sign slopes
 *   γ_b    = sLocal · g_bu + sCov · ( β_urbLocal · ΔlogDensity_b + β_incLocal · ΔlogIncome_b ), centred within county
 * The coalition structure (B, platforms, attachments, slopes) is drawn per universe; nothing is copied from real elections.
 */
import { Rng } from '../core/rng';
import { dexp, dlogistic, dpow } from '../core/math';
import type { GeoPack } from '../geo/pack';
import { N_COHORTS, cohortAge, cohortEdu, cohortRace, cohortSex } from '../population/cohorts';
import { buCohortShares, type Population } from '../population/population';

export const DIMS = 3;
export const ISSUE_AXES = ['Economic', 'Social', 'Orientation'] as const;

export interface ElectorateParams {
  version: 1;
  attempt: number;
  platforms: { D: number[]; R: number[] };
  lambda: number;
  loadings: number[];        // DIMS × F feature loadings (B)
  cohortPos: number[];       // 64 × DIMS cohort issue positions x_k
  attach: number[];          // 64 group–party identity attachments a_k
  sigma: number[];           // 64 within-cell spread σ_k
  divisionShift: number[];   // 10 × DIMS regional issue modifiers (division index 1..9)
  betaUrban: number; betaIncome: number; betaUrbanLocal: number; betaIncomeLocal: number;
  turnoutBase: number[];     // 64 cohort turnout propensities τ_k (logit)
  betaIntensity: number;
  weights: { group: number; geo: number; cov: number };
  sGroup: number; sCov: number; sRegion: number; sCounty: number; sIid: number; sLocal: number;
  intercept: number;
  targets: CalibrationTargets;
  achieved: CalibrationStats;
}

export interface ElectorateFields {
  division: Float32Array;  // 10
  state: Float32Array;     // states
  county: Float32Array;    // counties (spatially smoothed)
  countyIid: Float32Array; // counties (unsmoothed)
  bu: Float32Array;        // BUs (centred within county)
}

export interface Electorate { params: ElectorateParams; fields: ElectorateFields; mu: Float32Array; buShift: Float32Array; tables: CellTables }

// ---- Gauss–Hermite quadrature (Numerical Recipes `gauher`), computed once ---------------------
export function gaussHermite(n: number): { x: Float64Array; w: Float64Array } {
  const x = new Float64Array(n), w = new Float64Array(n);
  const PIM4 = 0.7511255444649425; const m = (n + 1) >> 1;
  let z = 0, pp = 0;
  for (let i = 0; i < m; i++) {
    if (i === 0) z = Math.sqrt(2 * n + 1) - 1.85575 * dpow(2 * n + 1, -0.16667);
    else if (i === 1) z -= 1.14 * dpow(n, 0.426) / z;
    else if (i === 2) z = 1.86 * z - 0.86 * x[0]!;
    else if (i === 3) z = 1.91 * z - 0.91 * x[1]!;
    else z = 2 * z - x[i - 2]!;
    for (let it = 0; it < 20; it++) {
      let p1 = PIM4, p2 = 0;
      for (let j = 0; j < n; j++) { const p3 = p2; p2 = p1; p1 = z * Math.sqrt(2 / (j + 1)) * p2 - Math.sqrt(j / (j + 1)) * p3; }
      pp = Math.sqrt(2 * n) * p2;
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) <= 3e-14) break;
    }
    x[i] = z; x[n - 1 - i] = -z; w[i] = 2 / (pp * pp); w[n - 1 - i] = w[i]!;
  }
  // convert to expectations under N(0,1): E[f] = Σ w_i/√π f(√2 x_i)
  for (let i = 0; i < n; i++) { x[i]! *= Math.SQRT2; w[i]! /= Math.sqrt(Math.PI); }
  return { x, w };
}
export const GH = gaussHermite(10);

/**
 * Neutral-environment expectations for a cell z ~ N(μ, σ²) with turnout propensity τ:
 * returns [E(turnout · P(D)), E(turnout)] for a generic two-candidate presidential contest.
 */
export function cellExpectation(mu: number, sigma: number, tau: number, betaInt: number, out: Float64Array): void {
  let d = 0, t = 0;
  for (let i = 0; i < GH.x.length; i++) {
    const z = mu + sigma * GH.x[i]!;
    const pt = dlogistic(tau + betaInt * Math.abs(z));
    d += GH.w[i]! * pt * dlogistic(z); t += GH.w[i]! * pt;
  }
  out[0] = d; out[1] = t;
}

/**
 * Tabulated cell expectations over a grid of cell means μ for each cohort (σ_k, τ_k fixed per universe).
 * Replaces quadrature in hot loops by linear interpolation (grid step 0.04 logit ≈ 1 point).
 */
export const MU_LO = -9, MU_STEP = 0.04, MU_N = 451;
export interface CellTables { d: Float64Array; t: Float64Array }

export function buildCellTables(p: Pick<ElectorateParams, 'sigma' | 'turnoutBase' | 'betaIntensity'>): CellTables {
  const d = new Float64Array(N_COHORTS * MU_N), t = new Float64Array(N_COHORTS * MU_N);
  const cell = new Float64Array(2);
  for (let k = 0; k < N_COHORTS; k++) for (let g = 0; g < MU_N; g++) {
    cellExpectation(MU_LO + g * MU_STEP, p.sigma[k]!, p.turnoutBase[k]!, p.betaIntensity, cell);
    d[k * MU_N + g] = cell[0]!; t[k * MU_N + g] = cell[1]!;
  }
  return { d, t };
}

/** Interpolated [E(turnout·P(D)), E(turnout)] for cohort k at mean mu, written to out[0], out[1]. */
export function cellLookup(tab: CellTables, k: number, mu: number, out: Float64Array): void {
  let x = (mu - MU_LO) / MU_STEP;
  if (x < 0) x = 0; else if (x > MU_N - 1.000001) x = MU_N - 1.000001;
  const g = Math.floor(x), f = x - g, i = k * MU_N + g;
  out[0] = tab.d[i]! + (tab.d[i + 1]! - tab.d[i]!) * f;
  out[1] = tab.t[i]! + (tab.t[i + 1]! - tab.t[i]!) * f;
}

// ---- Parameter generation -----------------------------------------------------------------------
function features(k: number): number[] {
  const a = cohortAge(k), s = cohortSex(k), e = cohortEdu(k), r = cohortRace(k);
  return [a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 3 ? 1 : 0, s, e, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0,
    e * (r === 0 ? 1 : 0), s * (a === 3 ? 1 : 0), e * (a === 0 ? 1 : 0)];
}
const F = features(0).length;

export function drawParams(seed: string, attempt: number): Omit<ElectorateParams, 'sGroup' | 'sCov' | 'sRegion' | 'sCounty' | 'sIid' | 'sLocal' | 'intercept' | 'targets' | 'achieved'> {
  const r = Rng.stream(seed, 'electorate', 'params', attempt);
  // Party platforms: distinct positions in the issue space.
  const mid = Array.from({ length: DIMS }, () => r.normal(0, 0.3));
  let dir = Array.from({ length: DIMS }, () => r.normal());
  const norm = Math.hypot(...dir); dir = dir.map((v) => v / norm);
  const sep = r.range(1.0, 1.6);
  const D = mid.map((m, i) => m + dir[i]! * sep / 2), R = mid.map((m, i) => m - dir[i]! * sep / 2);
  // Loadings: how demographic features map to issue positions. Random magnitude and sign: fictional coalitions.
  const loadings = Array.from({ length: DIMS * F }, (_, i) => r.normal(0, i % F < 8 ? 0.55 : 0.3));
  const cohortPos: number[] = [];
  for (let k = 0; k < N_COHORTS; k++) {
    const f = features(k);
    for (let d = 0; d < DIMS; d++) {
      let s = 0; for (let j = 0; j < F; j++) s += loadings[d * F + j]! * f[j]!;
      cohortPos.push(s + r.normal(0, 0.12));
    }
  }
  // Group identity attachment: partly feature-driven (lasting group–party bonds), partly idiosyncratic.
  const attachCoef = Array.from({ length: F }, () => r.normal(0, 0.35));
  const attach = Array.from({ length: N_COHORTS }, (_, k) => features(k).reduce((a, x, j) => a + x * attachCoef[j]!, 0) + r.normal(0, 0.1));
  const sigma = Array.from({ length: N_COHORTS }, () => r.range(1.15, 1.7));
  const divisionShift = Array.from({ length: 10 * DIMS }, (_, i) => (i < DIMS ? 0 : r.normal(0, 0.3)));
  const sign = () => (r.bernoulli(0.5) ? 1 : -1);
  const betaUrban = sign() * r.range(0.35, 1.0), betaIncome = r.normal(0, 0.45);
  const turnoutBase = Array.from({ length: N_COHORTS }, (_, k) => {
    const a = cohortAge(k), e = cohortEdu(k);
    return [-0.55, 0.05, 0.55, 0.85][a]! + 0.55 * e + r.normal(0, 0.08) - (cohortRace(k) === 2 || cohortRace(k) === 3 ? 0.2 : 0);
  });
  const wg = r.range(0.35, 0.6), wgeo = r.range(0.25, 0.5), wc = r.range(0.2, 0.45);
  return {
    version: 1, attempt, platforms: { D, R }, lambda: 0.5, loadings, cohortPos, attach, sigma, divisionShift,
    betaUrban, betaIncome, betaUrbanLocal: betaUrban * r.range(0.4, 0.9), betaIncomeLocal: betaIncome * r.range(0.3, 0.8),
    turnoutBase, betaIntensity: r.range(0.15, 0.3), weights: { group: wg, geo: wgeo, cov: wc },
  };
}

function smoothOnGraph(values: Float64Array, adj: readonly (readonly number[])[], iterations: number, alpha: number): void {
  const tmp = new Float64Array(values.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < values.length; i++) {
      const n = adj[i]!;
      if (n.length === 0) { tmp[i] = values[i]!; continue; }
      let s = 0; for (const j of n) s += values[j]!;
      tmp[i] = (1 - alpha) * values[i]! + alpha * s / n.length;
    }
    values.set(tmp);
  }
}

function centreWithinStates(v: Float64Array, pack: GeoPack, pop: Population): void {
  const S = pack.states.length, sum = new Float64Array(S), w = new Float64Array(S);
  for (const c of pack.counties) { const x = pop.countyVep[c.idx]! || 1; sum[c.stateIdx]! += x * v[c.idx]!; w[c.stateIdx]! += x; }
  for (const c of pack.counties) v[c.idx] = v[c.idx]! - (w[c.stateIdx]! > 0 ? sum[c.stateIdx]! / w[c.stateIdx]! : 0);
}

function standardize(v: Float64Array): void {
  let m = 0; for (const x of v) m += x; m /= v.length || 1;
  let s = 0; for (const x of v) s += (x - m) ** 2; s = Math.sqrt(s / (v.length || 1)) || 1;
  for (let i = 0; i < v.length; i++) v[i] = (v[i]! - m) / s;
}

export function drawFields(seed: string, attempt: number, pack: GeoPack, pop: Population): ElectorateFields {
  const r = Rng.stream(seed, 'electorate', 'fields', attempt);
  const division = new Float32Array(10);
  for (let d = 1; d < 10; d++) division[d] = r.normal(0, 0.8);
  // State field on the state adjacency graph (derived from county adjacency).
  const S = pack.states.length;
  const stateAdj: Set<number>[] = Array.from({ length: S }, () => new Set());
  pack.countyAdjacency.forEach((nbrs, c) => {
    const s = pack.counties[c]!.stateIdx;
    for (const n of nbrs) { const t = pack.counties[n]!.stateIdx; if (t !== s) stateAdj[s]!.add(t); }
  });
  const st = Float64Array.from({ length: S }, () => r.normal());
  smoothOnGraph(st, stateAdj.map((s) => [...s].sort((a, b) => a - b)), 2, r.range(0.3, 0.6));
  standardize(st);
  // County field: smoothed white noise, multi-pass for regional coherence.
  const C = pack.counties.length;
  const co = Float64Array.from({ length: C }, () => r.normal());
  smoothOnGraph(co, pack.countyAdjacency, r.intRange(3, 7), r.range(0.55, 0.8));
  const iid = Float64Array.from({ length: C }, () => r.normal());
  // County fields describe variation *within* states: centred on each state's (VEP-weighted) mean, so states
  // differ through the regional fields, place covariates and group composition, not through county noise.
  centreWithinStates(co, pack, pop); standardize(co);
  centreWithinStates(iid, pack, pop); standardize(iid);
  // Base Unit field: neighbourhood (tract) + block-group components, centred within county by VEP.
  const bu = new Float32Array(pop.bu);
  for (const county of pack.counties) {
    const cr = Rng.stream(seed, 'electorate', 'bu-field', attempt, county.geoid);
    const tractNoise = new Map<number, number>();
    let sw = 0, s = 0;
    for (let b = county.buStart; b < county.buStart + county.buCount; b++) {
      const t = pack.bu.tract[b]!;
      let tn = tractNoise.get(t);
      if (tn === undefined) { tn = cr.normal(0, 0.8); tractNoise.set(t, tn); }
      const v = tn + cr.normal(0, 0.55);
      bu[b] = v; sw += pop.vep[b]!; s += pop.vep[b]! * v;
    }
    const mean = sw > 0 ? s / sw : 0;
    for (let b = county.buStart; b < county.buStart + county.buCount; b++) bu[b]! -= mean;
  }
  return { division, state: Float32Array.from(st), county: Float32Array.from(co), countyIid: Float32Array.from(iid), bu };
}

// ---- Composition of μ --------------------------------------------------------------------------
interface Components { group: Float64Array; geoDiv: Float64Array; geoState: Float64Array; geoCounty: Float64Array; geoIid: Float64Array; cov: Float64Array; zDens: Float64Array; zInc: Float64Array }

function countyStandardized(values: Float32Array, weights: Float64Array): Float64Array {
  let w = 0, m = 0; for (let i = 0; i < values.length; i++) { w += weights[i]!; m += weights[i]! * values[i]!; }
  m /= w || 1;
  let v = 0; for (let i = 0; i < values.length; i++) v += weights[i]! * (values[i]! - m) ** 2;
  const sd = Math.sqrt(v / (w || 1)) || 1;
  return Float64Array.from(values, (x) => (x - m) / sd);
}

function components(p: ReturnType<typeof drawParams>, f: ElectorateFields, pack: GeoPack, pop: Population, centrePop: Population = pop): Components {
  const C = pack.counties.length;
  const dvec = p.platforms.D.map((d, i) => d - p.platforms.R[i]!);
  const group = new Float64Array(C * N_COHORTS);
  // Group term per (division, cohort), then mapped to counties.
  const byDiv = new Float64Array(10 * N_COHORTS);
  for (let div = 0; div < 10; div++) for (let k = 0; k < N_COHORTS; k++) {
    let s = 0; for (let d = 0; d < DIMS; d++) s += dvec[d]! * (p.cohortPos[k * DIMS + d]! + p.divisionShift[div * DIMS + d]!);
    byDiv[div * N_COHORTS + k] = 2 * p.lambda * s + p.attach[k]!;
  }
  // Centre the group term nationally (VEP-weighted) so it carries structure, not level.
  let gm = 0, gw = 0;
  for (let c = 0; c < C; c++) {
    const div = pack.states[pack.counties[c]!.stateIdx]!.division;
    for (let k = 0; k < N_COHORTS; k++) {
      const v = byDiv[div * N_COHORTS + k]!; group[c * N_COHORTS + k] = v;
      const w = centrePop.countyVep[c]! * centrePop.countyJoint[c * N_COHORTS + k]!; gm += w * v; gw += w;
    }
  }
  gm /= gw || 1;
  for (let i = 0; i < group.length; i++) group[i]! -= gm;
  const geoDiv = new Float64Array(C), geoState = new Float64Array(C), geoCounty = new Float64Array(C), geoIid = new Float64Array(C);
  for (let c = 0; c < C; c++) {
    const s = pack.counties[c]!.stateIdx;
    geoDiv[c] = f.division[pack.states[s]!.division]!; geoState[c] = f.state[s]!; geoCounty[c] = f.county[c]!; geoIid[c] = f.countyIid[c]!;
  }
  const zDens = countyStandardized(pop.countyLogDensity, pop.countyVep);
  const zInc = countyStandardized(pop.countyLogIncome, pop.countyVep);
  const cov = new Float64Array(C);
  for (let c = 0; c < C; c++) cov[c] = p.betaUrban * zDens[c]! + p.betaIncome * zInc[c]!;
  return { group, geoDiv, geoState, geoCounty, geoIid, cov, zDens, zInc };
}

function weightedSd(v: Float64Array, w: Float64Array, stride = 1): number {
  let sw = 0, m = 0; const n = w.length;
  const val = (i: number) => (stride === 1 ? v[i]! : avgRow(v, i, stride));
  for (let i = 0; i < n; i++) { sw += w[i]!; m += w[i]! * val(i); }
  m /= sw || 1;
  let s = 0; for (let i = 0; i < n; i++) s += w[i]! * (val(i) - m) ** 2;
  return Math.sqrt(s / (sw || 1));
}
function avgRow(v: Float64Array, i: number, stride: number): number { let s = 0; for (let k = 0; k < stride; k++) s += v[i * stride + k]!; return s / stride; }

type Scales = Pick<ElectorateParams, 'sGroup' | 'sCov' | 'sRegion' | 'sCounty' | 'sIid' | 'intercept'>;

function composeMu(comp: Components, sc: Scales, C: number, out: Float32Array): void {
  for (let c = 0; c < C; c++) {
    const base = sc.intercept + sc.sRegion * (comp.geoDiv[c]! + comp.geoState[c]!) + sc.sCounty * comp.geoCounty[c]! + sc.sIid * comp.geoIid[c]! + sc.sCov * comp.cov[c]!;
    for (let k = 0; k < N_COHORTS; k++) out[c * N_COHORTS + k] = base + sc.sGroup * comp.group[c * N_COHORTS + k]!;
  }
}

/**
 * The long-run partisanship the electorate is moving toward (μ*, §4.2) for given platforms and attachments and
 * the current population. The group term is centred with the base population's weights, so changes in who
 * lives where (and in each group's size) move the national balance, while the parties' positions reshape
 * which groups lean which way.
 */
export function targetMu(params: ElectorateParams, platforms: { D: number[]; R: number[] }, attach: number[], fields: ElectorateFields, pack: GeoPack, pop: Population, basePop: Population): Float32Array {
  const comp = components({ ...params, platforms, attach }, fields, pack, pop, basePop);
  const out = new Float32Array(pack.counties.length * N_COHORTS);
  composeMu(comp, params, pack.counties.length, out);
  return out;
}

// ---- Lean ---------------------------------------------------------------------------------------
export interface Lean { dVotes: Float64Array; votes: Float64Array }

/** Expected neutral-environment two-party vote at county level (BU effects are centred within counties). */
export function countyLean(mu: Float32Array, tab: CellTables, pop: Population): Lean {
  const C = pop.counties; const dVotes = new Float64Array(C), votes = new Float64Array(C);
  const cell = new Float64Array(2);
  for (let c = 0; c < C; c++) {
    let d = 0, t = 0;
    for (let k = 0; k < N_COHORTS; k++) {
      const share = pop.countyJoint[c * N_COHORTS + k]!; if (share <= 0) continue;
      cellLookup(tab, k, mu[c * N_COHORTS + k]!, cell);
      d += share * cell[0]!; t += share * cell[1]!;
    }
    dVotes[c] = pop.countyVep[c]! * d; votes[c] = pop.countyVep[c]! * t;
  }
  return { dVotes, votes };
}

/** BU-level shift γ_b (centred within county). */
export function buShift(params: ElectorateParams, fields: ElectorateFields, pack: GeoPack, pop: Population): Float32Array {
  const out = new Float32Array(pop.bu);
  for (const county of pack.counties) {
    const c = county.idx; const s0 = county.buStart, s1 = s0 + county.buCount;
    let sw = 0, s = 0;
    for (let b = s0; b < s1; b++) {
      const v = params.sLocal * fields.bu[b]!
        + params.sCov * (params.betaUrbanLocal * 0.35 * (pop.buLogDensity[b]! - pop.countyLogDensity[c]!)
        + params.betaIncomeLocal * 0.8 * (pop.buLogIncome[b]! - pop.countyLogIncome[c]!));
      out[b] = v; sw += pop.vep[b]!; s += pop.vep[b]! * v;
    }
    const m = sw > 0 ? s / sw : 0;
    for (let b = s0; b < s1; b++) out[b]! -= m;
  }
  return out;
}

/** Expected neutral-environment lean per BU (cohort shares raked to BU marginals; μ shifted by γ_b). */
export function buLean(e: Electorate, pack: GeoPack, pop: Population): Lean {
  const B = pop.bu; const dVotes = new Float64Array(B), votes = new Float64Array(B);
  const cell = new Float64Array(2), shares = new Float64Array(N_COHORTS);
  const tab = e.tables;
  for (const county of pack.counties) {
    const c = county.idx;
    for (let b = county.buStart; b < county.buStart + county.buCount; b++) {
      const v = pop.vep[b]!; if (v <= 0) continue;
      buCohortShares(pop, b, c, shares);
      const g = e.buShift[b]!;
      let d = 0, t = 0;
      for (let k = 0; k < N_COHORTS; k++) {
        const s = shares[k]!; if (s <= 0) continue;
        cellLookup(tab, k, e.mu[c * N_COHORTS + k]! + g, cell);
        d += s * cell[0]!; t += s * cell[1]!;
      }
      dVotes[b] = v * d; votes[b] = v * t;
    }
  }
  return { dVotes, votes };
}

// ---- Calibration ----------------------------------------------------------------------------------
export interface CalibrationTargets { national: number; stateSd: number; countySd: number; /** SD of the group (coalition) term across voters, logits; absent in universes created before Phase 6. */ groupSd?: number }
export interface CalibrationStats {
  national: number; stateSd: number; countySd: number; lopsidedCounties: number; closeStates: number; moransI: number;
}

export const TARGET_RANGES = {
  national: [45, 55], stateSd: [10, 20], countySd: [22, 32], lopsidedCounties: [0.45, 0.85], closeStates: [3, 14], moransI: [0.5, 0.8],
} as const;

export function leanStats(lean: Lean, pack: GeoPack): CalibrationStats {
  const C = pack.counties.length, S = pack.states.length;
  let D = 0, T = 0; const sD = new Float64Array(S), sT = new Float64Array(S);
  const m = new Float64Array(C);
  let lopsided = 0, nc = 0;
  for (let c = 0; c < C; c++) {
    const d = lean.dVotes[c]!, t = lean.votes[c]!; D += d; T += t;
    const s = pack.counties[c]!.stateIdx; sD[s]! += d; sT[s]! += t;
    m[c] = t > 0 ? 100 * (2 * d / t - 1) : 0;
    if (t > 0) { nc++; if (Math.abs(m[c]!) > 20) lopsided++; }
  }
  // State statistics use the 50 states (DC, a single extreme county-equivalent, is conventionally excluded).
  const sm: number[] = []; for (let s = 0; s < S; s++) if (sT[s]! > 0 && pack.states[s]!.usps !== 'DC') sm.push(100 * (2 * sD[s]! / sT[s]! - 1));
  const sd = (xs: ArrayLike<number>) => { let mu = 0; for (let i = 0; i < xs.length; i++) mu += xs[i]!; mu /= xs.length || 1; let v = 0; for (let i = 0; i < xs.length; i++) v += (xs[i]! - mu) ** 2; return Math.sqrt(v / (xs.length || 1)); };
  // Moran's I with binary rook weights.
  let mean = 0; for (const x of m) mean += x; mean /= C || 1;
  let num = 0, den = 0, W = 0;
  for (let i = 0; i < C; i++) {
    const di = m[i]! - mean; den += di * di;
    for (const j of pack.countyAdjacency[i]!) { num += di * (m[j]! - mean); W++; }
  }
  return {
    national: T > 0 ? 100 * D / T : 50, stateSd: sd(sm), countySd: sd(m), lopsidedCounties: nc ? lopsided / nc : 0,
    closeStates: sm.filter((x) => Math.abs(x) < 5).length, moransI: W > 0 && den > 0 ? (C / W) * num / den : 0,
  };
}

function penalty(st: CalibrationStats): number {
  let p = 0;
  for (const [k, [lo, hi]] of Object.entries(TARGET_RANGES) as [keyof CalibrationStats, readonly [number, number]][]) {
    const v = st[k]; const w = hi - lo;
    if (v < lo) p += ((lo - v) / w) ** 2; else if (v > hi) p += ((v - hi) / w) ** 2;
  }
  return p;
}

export function inTargets(st: CalibrationStats): boolean { return penalty(st) === 0; }

/** Generate and calibrate a universe electorate. Deterministic in (seed, pack, population). */
export function generateElectorate(seed: string, pack: GeoPack, pop: Population, maxAttempts = 12): Electorate {
  let best: Electorate | null = null, bestPenalty = Infinity;
  const tr = Rng.stream(seed, 'electorate', 'targets');
  const targets: CalibrationTargets = {
    // The founding national balance: within about ±5 points of margin (the 2016 baseline was close to even).
    national: Math.min(52.5, Math.max(47.5, tr.normal(50, 1.5))), stateSd: tr.range(11.5, 17.5), countySd: tr.range(24, 31),
    // Coalitions: how far groups' partisanship differs (typical groups split between 55/45 and 80/20, §4.1).
    groupSd: tr.range(0.5, 0.8),
  };
  const C = pack.counties.length;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const base = drawParams(seed, attempt);
    const fields = drawFields(seed, attempt, pack, pop);
    const comp = components(base, fields, pack, pop);
    const ar = Rng.stream(seed, 'electorate', 'calibration', attempt);
    // Initial absolute scales from the universe's component weights (SD terms across counties).
    const sdGroup = weightedSd(comp.group, pop.countyVep, N_COHORTS) || 1;
    const sdRegion = weightedSd(Float64Array.from({ length: C }, (_, c) => comp.geoDiv[c]! + comp.geoState[c]!), pop.countyVep) || 1;
    const sdCov = weightedSd(comp.cov, pop.countyVep) || 1;
    // The group term's spread across voters (all county × cohort cells): its scale is set by its own target.
    let gw = 0, gm = 0; for (let c = 0; c < C; c++) for (let k = 0; k < N_COHORTS; k++) { const w = pop.countyVep[c]! * pop.countyJoint[c * N_COHORTS + k]!; gw += w; gm += w * comp.group[c * N_COHORTS + k]!; }
    gm /= gw || 1;
    let gv = 0; for (let c = 0; c < C; c++) for (let k = 0; k < N_COHORTS; k++) { const w = pop.countyVep[c]! * pop.countyJoint[c * N_COHORTS + k]!; gv += w * (comp.group[c * N_COHORTS + k]! - gm) ** 2; }
    const sdGroupVoter = Math.sqrt(gv / (gw || 1)) || 1;
    void sdGroup;
    const sc: Scales = {
      sGroup: targets.groupSd! / sdGroupVoter, sCov: 1.4 * base.weights.cov / sdCov,
      sRegion: 1.4 * base.weights.geo * 0.55 / sdRegion, sCounty: 1.4 * base.weights.geo * 0.8, sIid: 1.4 * base.weights.geo * ar.range(0.2, 0.45), intercept: 0,
    };
    const mu = new Float32Array(C * N_COHORTS);
    const tables = buildCellTables(base);
    const evalNow = (): CalibrationStats => { composeMu(comp, sc, C, mu); return leanStats(countyLean(mu, tables, pop), pack); };
    // Two damped controls: "between" scales structure that differs between states (coalition
    // composition, place covariates, regional fields) toward the state-spread target; "within" scales
    // within-state geography (county fields) toward the county-spread target.
    // "Between" scales the state-level geography (regional fields, place covariates). Group structure keeps its
    // own target unless the state spread cannot be reached otherwise.
    const sRegion0 = sc.sRegion;
    const between = (f: number) => {
      if (f < 1 && sc.sRegion < 0.15 * sRegion0) { sc.sGroup *= Math.max(f, 0.9); return; }
      sc.sCov *= f; sc.sRegion *= f;
    };
    const within = (f: number) => { sc.sCounty *= f; sc.sIid *= f; };
    const clampF = (f: number) => Math.min(2, Math.max(0.5, f));
    const fitIntercept = (st: CalibrationStats): CalibrationStats => {
      for (let j = 0; j < 6; j++) { const err = st.national - targets.national; if (Math.abs(err) < 0.04) break; sc.intercept -= err * 0.055; st = evalNow(); }
      return st;
    };
    let stats = fitIntercept(evalNow());
    for (let iter = 0; iter < 24; iter++) {
      const done = Math.abs(stats.stateSd / targets.stateSd - 1) < 0.025 && Math.abs(stats.countySd / targets.countySd - 1) < 0.02
        && Math.abs(stats.national - targets.national) < 0.1 && stats.moransI >= TARGET_RANGES.moransI[0] + 0.02 && stats.moransI <= TARGET_RANGES.moransI[1] - 0.02;
      if (done) break;
      between(clampF(dpow(targets.stateSd / Math.max(1e-6, stats.stateSd), 0.85)));
      stats = evalNow();
      within(clampF(dpow(targets.countySd / Math.max(1e-6, stats.countySd), 1.3)));
      if (stats.moransI > TARGET_RANGES.moransI[1] - 0.04) sc.sIid *= 1.25;
      else if (stats.moransI < TARGET_RANGES.moransI[0] + 0.04) sc.sIid *= 0.8;
      stats = fitIntercept(evalNow());
    }
    const params: ElectorateParams = { ...base, ...sc, sLocal: Math.max(0.15, sc.sCounty * 0.7), targets, achieved: stats };
    const e: Electorate = { params, fields, mu: Float32Array.from(mu), buShift: new Float32Array(0), tables };
    e.buShift = buShift(params, fields, pack, pop);
    const pen = penalty(stats);
    if (pen < bestPenalty) { best = e; bestPenalty = pen; }
    if (pen === 0) break;
  }
  return best!;
}

/** Rebuild μ from stored parameters and fields (used when loading a universe). */
export function rebuildElectorate(params: ElectorateParams, fields: ElectorateFields, pack: GeoPack, pop: Population): Electorate {
  const base = params;
  const comp = components(base, fields, pack, pop);
  const mu = new Float32Array(pack.counties.length * N_COHORTS);
  composeMu(comp, params, pack.counties.length, mu);
  const e: Electorate = { params, fields, mu, buShift: new Float32Array(0), tables: buildCellTables(params) };
  e.buShift = buShift(params, fields, pack, pop);
  return e;
}

/** Two-party Democratic share from lean totals. */
export const dShare = (d: number, t: number): number => (t > 0 ? d / t : 0.5);
export const marginPts = (d: number, t: number): number => 100 * (2 * dShare(d, t) - 1);
export { dexp };
