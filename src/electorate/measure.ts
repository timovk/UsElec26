/**
 * Measurement of the electorate by observers (the information firewall's one sanctioned door,
 * docs/architecture/02 §2.2): every quantity leaves here with realistic error, and observers
 * (wire, survey, decision desks) never see the cast results or the model's expectations directly.
 */
import { Rng } from '../core/rng';
import { dexp, dlogistic, dtanh } from '../core/math';
import { gaussHermite } from './model';
import { N_CLASS, N_TYPES, ZG, typeScratch, typeUtilities, unitTypes, type KernelContest, type ShardInput } from './kernel';
import { AGE_BANDS, EDUS, N_COHORTS, RACES, SEXES, cohortAge, cohortEdu, cohortRace, cohortSex } from '../population/cohorts';

const N_MODES = 4;

/**
 * The desks' pre-election baseline for each (part, mode) cell of a race: the vote shares one would expect
 * from public information (past results and polling, until Phase 5 provides real forecasts). Built from the
 * model expectation plus error along the race's main axis: a state component, a component per voting mode,
 * a race component and local noise.
 */
export function publishedBaseline(expPartMode: Float64Array, parts: readonly number[], K: number, axis: readonly number[],
  err: { state: number; mode: readonly number[]; race: number }, rng: Rng): { shares: Float64Array; has: Uint8Array } {
  const shares = new Float64Array(parts.length * N_MODES * K), has = new Uint8Array(parts.length * N_MODES);
  const a = axis.indexOf(1), b = axis.indexOf(-1);
  parts.forEach((p, i) => {
    const loc = rng.normal(0, 0.035);
    for (let m = 0; m < N_MODES; m++) {
      const o = (p * N_MODES + m) * K;
      let tot = 0; for (let k = 0; k < K; k++) tot += expPartMode[o + k]!;
      if (tot <= 0) continue;
      has[i * N_MODES + m] = 1;
      const so = (i * N_MODES + m) * K;
      for (let k = 0; k < K; k++) shares[so + k] = expPartMode[o + k]! / tot;
      if (a >= 0 && b >= 0) {
        const e = err.state + err.mode[m]! + err.race + loc, pair = shares[so + a]! + shares[so + b]!;
        const sa = Math.min(pair - 0.001, Math.max(0.001, shares[so + a]! + 0.5 * e * pair));
        shares[so + a] = sa; shares[so + b] = pair - sa;
      }
    }
  });
  return { shares, has };
}

/**
 * Centre a baseline on a public forecast: shift every cell along the race axis so the race's expected-vote
 * weighted margin (axis + minus axis −, as a share of the vote) equals `target`.
 */
export function centreBaseline(base: { shares: Float64Array; has: Uint8Array }, expPartMode: Float64Array, parts: readonly number[], K: number, axis: readonly number[], target: number): void {
  const a = axis.indexOf(1), b = axis.indexOf(-1);
  if (a < 0 || b < 0) return;
  let m = 0, wsum = 0;
  parts.forEach((p, i) => {
    for (let mo = 0; mo < N_MODES; mo++) {
      if (!base.has[i * N_MODES + mo]) continue;
      const o = (p * N_MODES + mo) * K; let tot = 0; for (let k = 0; k < K; k++) tot += expPartMode[o + k]!;
      const so = (i * N_MODES + mo) * K;
      m += tot * (base.shares[so + a]! - base.shares[so + b]!); wsum += tot;
    }
  });
  if (wsum <= 0) return;
  const delta = target - m / wsum;
  parts.forEach((_, i) => {
    for (let mo = 0; mo < N_MODES; mo++) {
      if (!base.has[i * N_MODES + mo]) continue;
      const so = (i * N_MODES + mo) * K, pair = base.shares[so + a]! + base.shares[so + b]!;
      const sa = Math.min(pair - 0.001, Math.max(0.001, base.shares[so + a]! + 0.5 * delta));
      base.shares[so + a] = sa; base.shares[so + b] = pair - sa;
    }
  });
}

/** The voter survey (exit poll): a sample of the realized electorate with nonresponse bias along the race axis. */
export function voterSurvey(castValid: readonly number[], axis: readonly number[], bias: number, n: number, rng: Rng): { shares: number[]; nEff: number } | null {
  const tot = castValid.reduce((x, y) => x + y, 0);
  if (tot <= 0 || castValid.length < 2) return null;
  const sh = castValid.map((v) => v / tot);
  const a = axis.indexOf(1), b = axis.indexOf(-1);
  if (a >= 0 && b >= 0) { const pair = sh[a]! + sh[b]!; sh[a] = Math.min(pair, Math.max(0, sh[a]! + 0.5 * bias * pair)); sh[b] = pair - sh[a]!; }
  const nEff = Math.max(1, Math.round(n / 1.6)); // design effect of a clustered sample
  const draw = rng.multinomial(nEff, sh, new Int32Array(sh.length));
  return { shares: Array.from(draw, (x) => x / nEff), nEff };
}

/** The wire's turnout priors per part: Election Day and accepted provisional ballots, with modelling error. */
export function wirePriors(expBallots: Float64Array, parts: number, provReject: number, rng: Rng): { ed: Float64Array; prov: Float64Array } {
  const ed = new Float64Array(parts), prov = new Float64Array(parts);
  const stateT = Math.exp(rng.normal(0, 0.05));
  for (let p = 0; p < parts; p++) {
    ed[p] = expBallots[p * N_MODES]! * stateT * Math.exp(rng.normal(0, 0.07));
    prov[p] = expBallots[p * N_MODES + 3]! * (1 - provReject) * Math.exp(rng.normal(0, 0.3));
  }
  return { ed, prov };
}

// ---- Voter survey with crosstabs ------------------------------------------------------------------------

export interface SurveyCrosstab { dim: 'age' | 'sex' | 'race' | 'edu'; groups: { label: string; pct: number; n: number; shares: number[] }[] }
export interface SurveyResult { shares: number[]; nEff: number; crosstabs: SurveyCrosstab[] }

const GH8 = gaussHermite(8);
const DIM_LABELS = { age: AGE_BANDS, sex: SEXES, race: RACES, edu: EDUS } as const;
const DIM_OF = { age: cohortAge, sex: cohortSex, race: cohortRace, edu: cohortEdu } as const;

/**
 * The voter survey with crosstabs: the electorate's expected composition by cohort and choice (analytic,
 * from each county's cohort partisanship, turnout and the candidates' appeal), matched to the realized vote
 * shares, biased by nonresponse along the race axis, then sampled. Toplines and crosstabs are the sample's
 * estimates; the true composition stays simulation truth.
 */
export function voterSurveyCrosstabs(inp: ShardInput, contestIdx: number, cd: number, castValid: readonly number[], axis: readonly number[], bias: number, n: number, rng: Rng): SurveyResult | null {
  const c = inp.contests[contestIdx]!; const J = c.options.length;
  const tot = castValid.reduce((x, y) => x + y, 0);
  if (tot <= 0 || J < 2) return null;
  // County electorates (eligible voters in units that vote in the race).
  const nC = inp.counties.turnout.length;
  const vep = new Float64Array(nC);
  for (let i = 0; i < inp.bus.count; i++) { if (cd >= 0 && inp.bus.cd[i] !== cd) continue; if (c.cd >= 0 && inp.bus.cd[i] !== c.cd) continue; vep[inp.bus.county[i]! - inp.counties.first]! += inp.bus.vep[i]!; }
  const joint = new Float64Array(N_COHORTS * J), u = new Float64Array(J + 1);
  for (let ci = 0; ci < nC; ci++) {
    if (vep[ci]! <= 0) continue;
    const county = inp.counties.first + ci;
    for (let k = 0; k < N_COHORTS; k++) {
      const share = inp.counties.joint[ci * N_COHORTS + k]!; if (share <= 0) continue;
      const mu = inp.counties.mu[ci * N_COHORTS + k]!, sg = inp.sigma[k]!, h = inp.classOf[k]!, tk = inp.tau[k]! + inp.counties.turnout[ci]!;
      for (let q = 0; q < GH8.x.length; q++) {
        const z = mu + sg * GH8.x[q]!;
        const pt = dlogistic(tk + inp.betaInt * Math.abs(z) + inp.enth * dtanh(z / 2));
        let mx = c.abstain; u[J] = c.abstain;
        for (let j = 0; j < J; j++) {
          const o = c.options[j]!;
          u[j] = c.weight * o.partySign * z + o.base + o.classFit[h]! - o.minorAppeal * Math.abs(z) + (o.homeState ? inp.homeStateBonus : 0) + (o.homeCounty === county ? inp.homeCountyBonus : 0);
          if (u[j]! > mx) mx = u[j]!;
        }
        let s = 0; for (let j = 0; j <= J; j++) { u[j] = dexp(u[j]! - mx); s += u[j]!; }
        const wgt = vep[ci]! * share * GH8.w[q]! * pt / s;
        for (let j = 0; j < J; j++) joint[k * J + j]! += wgt * u[j]!;
      }
    }
  }
  // Match the realized toplines, then apply nonresponse bias along the race axis.
  const target = castValid.map((v) => v / tot);
  const a = axis.indexOf(1), b = axis.indexOf(-1);
  if (a >= 0 && b >= 0) { const pair = target[a]! + target[b]!; target[a] = Math.min(pair, Math.max(0, target[a]! + 0.5 * bias * pair)); target[b] = pair - target[a]!; }
  for (let j = 0; j < J; j++) {
    let col = 0; for (let k = 0; k < N_COHORTS; k++) col += joint[k * J + j]!;
    const f = col > 0 ? target[j]! / col : 0;
    for (let k = 0; k < N_COHORTS; k++) joint[k * J + j]! *= f;
  }
  const nEff = Math.max(1, Math.round(n / 1.6)); // design effect of a clustered sample
  const draw = rng.multinomial(nEff, joint, new Int32Array(joint.length));
  const shares = new Array<number>(J).fill(0);
  for (let k = 0; k < N_COHORTS; k++) for (let j = 0; j < J; j++) shares[j]! += draw[k * J + j]! / nEff;
  const crosstabs: SurveyCrosstab[] = (['age', 'sex', 'race', 'edu'] as const).map((dim) => {
    const labels = DIM_LABELS[dim], of = DIM_OF[dim];
    return {
      dim, groups: labels.map((label, gi) => {
        const v = new Array<number>(J).fill(0); let m = 0;
        for (let k = 0; k < N_COHORTS; k++) if (of(k) === gi) for (let j = 0; j < J; j++) { v[j]! += draw[k * J + j]!; m += draw[k * J + j]!; }
        return { label, pct: m / nEff, n: Math.round((m * n) / nEff), shares: v.map((x) => (m > 0 ? x / m : 0)) };
      }),
    };
  });
  return { shares, nEff, crosstabs };
}

// ---- Polls: the measurement port (docs/architecture/04 §4.8) -------------------------------------------

/** Voters of one county (or county × district) by type: expected voters (LV) and the electorate before turnout (RV). */
export interface PieceTypes { county: number; cd: number; lv: Float32Array; rv: Float32Array }

/**
 * The electorate of a state by voter type, county and district: the ballot kernel's own step 1 (§4.5), run
 * without drawing ballots. Built once per cycle and electorate (general, each party's primary); polls are then
 * cheap. Only aggregated, noise-free weights; a poll turns them into a sampled, biased measurement.
 */
export function measureTypes(inp: ShardInput): PieceTypes[] {
  const sc = typeScratch(inp, true);
  const pieces = new Map<number, PieceTypes>();
  for (let i = 0; i < inp.bus.count; i++) {
    const E = Math.round(inp.bus.vep[i]!); if (E <= 0) continue;
    unitTypes(inp, i, E, sc);
    const county = inp.bus.county[i]!, cd = inp.bus.cd[i]!, key = county * 65536 + cd;
    let p = pieces.get(key); if (!p) { p = { county, cd, lv: new Float32Array(N_TYPES), rv: new Float32Array(N_TYPES) }; pieces.set(key, p); }
    for (let a = 0; a < 4; a++) for (let ty = 0; ty < N_TYPES; ty++) { p.lv[ty]! += sc.WA[a * N_TYPES + ty]!; p.rv[ty]! += sc.WR![a * N_TYPES + ty]!; }
  }
  return [...pieces.values()].sort((x, y) => x.county - y.county || x.cd - y.cd);
}

/** How a pollster fields a survey (its design and its biases, in the vote model's units). */
export interface PollDesign {
  n: number; deff: number; population: 'LV' | 'RV' | 'A';
  /** Share of the likely-voter screen that works (0–1); the rest of the sample looks like registered voters. */
  lvQuality: number;
  /** House effect: utility added to the Democratic option and removed from the Republican one. */
  house: number;
  /** Coverage and nonresponse by cohort class (log weights), the pollster's plus the cycle's shared bias. */
  classBias: readonly number[];
  /** Partisan nonresponse: log weight per unit of latent partisanship (positive: Democratic-leaning respondents answer more). */
  partisanNonresponse: number;
  /** Undecided share before leaners are pushed (0–1), scaled by how little the candidates are known. */
  undecided: number;
}

/** One jurisdiction of a poll: its contest as the ballot would show it there, its electorate pieces, and the current swing since the cache was built. */
export interface PollArea { contest: KernelContest; pieces: readonly PieceTypes[]; zShift: readonly number[]; bonuses: { homeStateBonus: number; homeCountyBonus: number } }

/**
 * Field a poll: the sampled responses (one count per option, then the undecided). The true intentions never
 * leave this function; observers receive only what a pollster would publish.
 */
export function fieldPoll(areas: readonly PollArea[], design: PollDesign, recognition: readonly number[], rng: Rng): { counts: number[]; undecided: number; n: number } {
  const J = areas[0]!.contest.options.length;
  const S = new Float64Array(J); let A = 0;
  const u = new Float64Array(J + 1);
  for (const ar of areas) {
    const c = ar.contest;
    // Choice probabilities differ by county only through home-county bonuses: evaluate the rest of the area as one piece.
    const homes = new Set(c.options.map((o) => o.homeCounty).filter((x) => x >= 0));
    const rest: PieceTypes = { county: -1, cd: -1, lv: new Float32Array(N_TYPES), rv: new Float32Array(N_TYPES) };
    const own: PieceTypes[] = [];
    for (const p of ar.pieces) {
      if (homes.has(p.county)) { own.push(p); continue; }
      for (let ty = 0; ty < N_TYPES; ty++) { rest.lv[ty]! += p.lv[ty]!; rest.rv[ty]! += p.rv[ty]!; }
    }
    for (const p of [rest, ...own]) for (let h = 0; h < N_CLASS; h++) for (let g = 0; g < ZG; g++) {
      const ty = h * ZG + g;
      const lv = p.lv[ty]!, rv = p.rv[ty]!;
      let w = design.population === 'LV' ? design.lvQuality * lv + (1 - design.lvQuality) * rv * LV_RATIO : rv;
      if (w <= 0) continue;
      w *= dexp(design.classBias[h]! + design.partisanNonresponse * (g - ZG / 2 + 0.5));
      typeUtilities(ar.bonuses, c, h, g, p.county, ar.zShift[h]!, u);
      for (let j = 0; j < J; j++) { const s = c.options[j]!.partySign; if (s > 0) u[j]! += design.house; else if (s < 0) u[j]! -= design.house; }
      let mx = u[J]!; for (let j = 0; j < J; j++) if (u[j]! > mx) mx = u[j]!;
      let tot = 0; for (let j = 0; j <= J; j++) { u[j] = dexp(u[j]! - mx); tot += u[j]!; }
      for (let j = 0; j < J; j++) S[j]! += (w * u[j]!) / tot;
      A += (w * u[J]!) / tot;
    }
  }
  const decided = S.reduce((a, b) => a + b, 0);
  if (decided <= 0) return { counts: new Array<number>(J).fill(0), undecided: design.n, n: design.n };
  // Undecided: people who would skip the race, plus soft supporters of little-known candidates.
  const soft = Array.from(S, (x, j) => (x / decided) * Math.min(0.9, design.undecided * (1.25 - recognition[j]!)));
  const probs = Array.from(S, (x, j) => (x / decided) - soft[j]!);
  const und = Math.min(0.6, A / (decided + A) + soft.reduce((a, b) => a + b, 0));
  const scale = (1 - und) / Math.max(1e-9, probs.reduce((a, b) => a + b, 0));
  const q = [...probs.map((x) => x * scale), und];
  const nEff = Math.max(30, Math.round(design.n / design.deff));
  const draw = rng.multinomial(nEff, q, new Int32Array(J + 1));
  const counts = Array.from(draw, (x) => Math.round((x * design.n) / nEff));
  return { counts: counts.slice(0, J), undecided: counts[J]!, n: design.n };
}

/** Registered voters scaled to the likely electorate's size (so mixing LV and RV keeps the sample's shape, not its size). */
const LV_RATIO = 0.6;

/**
 * The public partisan-lean index of the first simulated cycle, before the archive holds past results: what an
 * analyst would infer from earlier elections — the true expected lean with regional, state and district error.
 * Points of two-party margin (D+), relative to the nation.
 */
export function publishedLean(seed: string, year: number, state: readonly number[], stateDivision: readonly number[], cd: readonly number[], cdState: readonly number[], national: number): { state: number[]; cd: number[] } {
  const r = Rng.stream(seed, 'published-lean', year);
  const div = Array.from({ length: 10 }, () => r.normal(0, 1.5));
  const st = state.map((m, s) => m - national + div[stateDivision[s]!]! + r.normal(0, 2.5));
  const cds = cd.map((m, i) => m - national + (st[cdState[i]!]! - (state[cdState[i]!]! - national)) + r.normal(0, 3.5));
  return { state: st, cd: cds };
}
