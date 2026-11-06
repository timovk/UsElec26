/**
 * The shared-electorate ballot kernel (docs/architecture/04-statistical-methodology.md §4.4–4.5).
 *
 * For every Base Unit the eligible electorate is spread over 48 voter types (4 cohort classes × 12
 * latent-partisanship bins). Turnout and ballot mode are computed per type, then every contest's
 * choice probabilities are computed from per-(contest, county) utility tables over the same types.
 * Ballots are drawn ONCE per (unit, mode); every contest on the ballot partitions exactly those ballots
 * into candidate votes and undervotes. Pure function of its input: shards (states) can run anywhere,
 * in any order, on any number of workers, with identical results.
 */
import { Rng } from '../core/rng';
import { dexp, dlogistic, dtanh, normCdf } from '../core/math';
import { N_COHORTS, cohortAge, rake, type Marginals } from '../population/cohorts';
import type { ElectorateParams } from './model';
import { DIMS } from './model';

export const ZG = 12, Z_LO = -6, Z_W = 1;
export const N_CLASS = 4, N_TYPES = N_CLASS * ZG, N_MODES = 4;
export const MODE_NAMES = ['Election Day', 'Early in person', 'Mail/absentee', 'Provisional'] as const;
export const zCenter = (g: number): number => Z_LO + (g + 0.5) * Z_W;

// ---- Deterministic lookup tables (built once from the deterministic math library) -------------
const PHI_LO = -9, PHI_STEP = 0.004, PHI_N = Math.round(18 / PHI_STEP) + 1;
const PHI = new Float64Array(PHI_N);
for (let i = 0; i < PHI_N; i++) PHI[i] = normCdf(PHI_LO + i * PHI_STEP);
function phi(x: number): number {
  let t = (x - PHI_LO) / PHI_STEP;
  if (t <= 0) return 0; if (t >= PHI_N - 1) return 1;
  const i = t | 0; t -= i; return PHI[i]! + (PHI[i + 1]! - PHI[i]!) * t;
}
const LG_LO = -20, LG_STEP = 0.004, LG_N = Math.round(40 / LG_STEP) + 1;
const LOGI = new Float64Array(LG_N);
for (let i = 0; i < LG_N; i++) LOGI[i] = dlogistic(LG_LO + i * LG_STEP);
function logi(x: number): number {
  let t = (x - LG_LO) / LG_STEP;
  if (t <= 0) return LOGI[0]!; if (t >= LG_N - 1) return LOGI[LG_N - 1]!;
  const i = t | 0; t -= i; return LOGI[i]! + (LOGI[i + 1]! - LOGI[i]!) * t;
}
const ZC = Float64Array.from({ length: ZG }, (_, g) => zCenter(g));
const ABSZ = ZC.map(Math.abs);
const TANHZ = ZC.map((z) => dtanh(z / 2));
const EDGES = Float64Array.from({ length: ZG + 1 }, (_, g) => Z_LO + g * Z_W);

/** Four cohort classes: deterministic k-means on cohort issue positions (initialised by partisan-axis quantiles). */
export function cohortClasses(p: Pick<ElectorateParams, 'cohortPos' | 'platforms'>): { classOf: Uint8Array; centroids: number[][] } {
  const axis = p.platforms.D.map((d, i) => d - p.platforms.R[i]!);
  const pos = (k: number) => p.cohortPos.slice(k * DIMS, k * DIMS + DIMS);
  const order = Array.from({ length: N_COHORTS }, (_, k) => k).sort((a, b) => {
    const pa = pos(a).reduce((s, x, i) => s + x * axis[i]!, 0), pb = pos(b).reduce((s, x, i) => s + x * axis[i]!, 0);
    return pa - pb || a - b;
  });
  let centroids = [0, 1, 2, 3].map((q) => pos(order[Math.floor((q + 0.5) * N_COHORTS / N_CLASS)]!));
  const classOf = new Uint8Array(N_COHORTS);
  for (let it = 0; it < 20; it++) {
    for (let k = 0; k < N_COHORTS; k++) {
      let best = 0, bd = Infinity;
      centroids.forEach((c, h) => { const dd = c.reduce((s, x, i) => s + (x - pos(k)[i]!) ** 2, 0); if (dd < bd) { bd = dd; best = h; } });
      classOf[k] = best;
    }
    centroids = centroids.map((c, h) => {
      const members = Array.from(classOf).map((x, k) => (x === h ? k : -1)).filter((k) => k >= 0);
      if (!members.length) return c;
      return c.map((_, i) => members.reduce((s, k) => s + pos(k)[i]!, 0) / members.length);
    });
  }
  return { classOf, centroids };
}

// ---- Inputs and outputs ----------------------------------------------------------------------------
export interface KernelOption {
  partySign: number;     // +0.5 Democratic, −0.5 Republican, 0 otherwise
  base: number;          // contest-wide valence (quality, incumbency, campaign, scandal), logit units
  classFit: number[];    // N_CLASS ideology-fit terms
  minorAppeal: number;   // weight on −|z| (non-partisan appeal of minor/independent candidates)
  homeCounty: number;    // county index with a home bonus, −1 if none
  homeState: boolean;    // candidate's home state is this shard's state
}

export interface KernelContest {
  id: number;
  cd: number;            // −1 statewide; otherwise only Base Units in this district vote (congressional unless `geo` says otherwise)
  /** Which district `cd` refers to: 0 congressional (default), 1 state senate, 2 state house, 3 + k the k-th of `bus.extra` (Phase 7.2 board and court districts). */
  geo?: number;
  weight: number;        // partisan salience w_e
  abstain: number;       // undervote utility
  options: KernelOption[];
  /** Ranked-choice contest (Phase 7.1): the kernel also returns the voter types behind each first choice, per reporting jurisdiction. */
  rcv?: boolean;
}

export interface ShardInput {
  seedKey: string;
  kind: 'general' | 'primary' | 'allparty';
  primaryParty: number;              // 1 or 2 for party primaries, 0 otherwise
  crossover: number;                 // primary: participation of non-members (by primary type)
  homeStateBonus: number; homeCountyBonus: number;
  /** Per BU: marginals (13 floats: age×4, male, race×4, college-by-age×4) are raked to the county joint inside the kernel. */
  bus: { start: number; count: number; county: Uint16Array; cd: Uint16Array; rj: Uint16Array; vep: Float32Array; shift: Float32Array; turnout: Float32Array; marg: Float32Array;
    /** State senate and state house districts (only needed when a contest uses them). */
    sldu?: Uint16Array; sldl?: Uint16Array;
    /** Districts of elected boards and district-elected courts (Phase 7.2), indexed like the shard's units. */
    extra?: Uint16Array[] };
  counties: { first: number; mu: Float32Array; turnout: Float32Array; joint: Float32Array }; // local county index = county − first
  classOf: Uint8Array; sigma: Float64Array; tau: Float64Array;          // per cohort; tau includes the election-type intercept
  betaInt: number; enth: number;
  modeLogits: Float64Array;          // 4 age bands × 4 modes
  modeGap: Float64Array;             // 4 modes: partisan slope per unit z
  rjFirst: number; rjCount: number;  // reporting jurisdictions of the shard (contiguous)
  contests: KernelContest[];
  /**
   * Election-night detail (counted generals only): each Base Unit's part (reporting jurisdiction × district)
   * so the kernel can also return votes by mode per unit and analytic expectations per (part, mode).
   */
  parts?: { of: Int32Array; count: number };
}

export interface ContestOutput {
  id: number;
  units: Int32Array;                 // global BU indices that voted in the contest
  votes: Int32Array;                 // units × (options + 1): candidate votes then undervotes (all modes)
  rjMode: Int32Array;                // rjCount × N_MODES × (options + 1)
  expected: Float64Array;            // expected votes per option (analytic), options + 1
  /** With `parts`: units × N_MODES × (options + 1) realized votes. */
  votesByMode?: Int32Array;
  /** With `parts`: parts × N_MODES × (options + 1) analytic expected votes. */
  expPartMode?: Float64Array;
  /** Ranked-choice contests: expected first-choice mass by voter type, rjCount × options × N_TYPES, and each RJ's county (−1: no voters). */
  rcvComp?: Float64Array; rcvCounty?: Int32Array;
}

export interface ShardOutput {
  ballots: Int32Array; ballotsByMode: Int32Array; eligible: Int32Array; contests: ContestOutput[]; expectedBallots: number;
  /** With `parts`: parts × N_MODES analytic expected ballots. */
  expBallotsPartMode?: Float64Array;
}

// ---- Step 1: voter types of a Base Unit (shared by the kernel and the measurement port) -------------
export interface TypeScratch {
  groupOf: Uint8Array; gS: Float64Array; gM: Float64Array; gV: Float64Array; gT: Float64Array; cells: Float64Array; mar: Marginals;
  zt: Float64Array; part: Float64Array;
  /** Expected voters by (age band × class) group and partisanship bin (4 × N_TYPES). */
  WA: Float64Array;
  /** With `rv`: the electorate before turnout (eligible residents who would take part in this kind of election), same layout. */
  WR: Float64Array | null;
}

export function typeScratch(inp: ShardInput, rv: boolean): TypeScratch {
  const part = new Float64Array(ZG).fill(1);
  // Primary participation by z bin.
  if (inp.kind === 'primary') for (let g = 0; g < ZG; g++) {
    const z = inp.primaryParty === 1 ? ZC[g]! : -ZC[g]!;
    part[g] = dlogistic(2.2 * (z - 0.4)) + inp.crossover * (1 - dlogistic(2.2 * (z - 0.4)));
  }
  return {
    groupOf: Uint8Array.from({ length: N_COHORTS }, (_, k) => cohortAge(k) * N_CLASS + inp.classOf[k]!),
    gS: new Float64Array(16), gM: new Float64Array(16), gV: new Float64Array(16), gT: new Float64Array(16), cells: new Float64Array(N_COHORTS),
    mar: { age: new Float64Array(4), male: 0, race: new Float64Array(4), collegeByAge: new Float64Array(4) },
    zt: Float64Array.from({ length: ZG }, (_, g) => inp.betaInt * ABSZ[g]! + inp.enth * TANHZ[g]!), part,
    WA: new Float64Array(4 * N_TYPES), WR: rv ? new Float64Array(4 * N_TYPES) : null,
  };
}

/**
 * Voter types of Base Unit `i` (local index) with `E` eligible residents. Cohorts are first collapsed into 16
 * (age band × class) groups by moment matching (mean, variance and turnout propensity); cohorts in a group
 * share issue positions by construction. Each group is then spread over the 12 partisanship bins.
 */
export function unitTypes(inp: ShardInput, i: number, E: number, sc: TypeScratch): void {
  const { groupOf, gS, gM, gV, gT, cells, mar, zt, part, WA, WR } = sc;
  const cl = inp.bus.county[i]! - inp.counties.first;
  WA.fill(0); gS.fill(0); gM.fill(0); gV.fill(0); gT.fill(0); if (WR) WR.fill(0);
  const shift = inp.bus.shift[i]!, tb = inp.bus.turnout[i]! + inp.counties.turnout[cl]!;
  // Cohort shares of this unit: the county joint table raked to the unit's marginals.
  for (let k = 0; k < N_COHORTS; k++) cells[k] = inp.counties.joint[cl * N_COHORTS + k]!;
  const mo13 = i * 13, mg = inp.bus.marg;
  mar.age[0] = mg[mo13]!; mar.age[1] = mg[mo13 + 1]!; mar.age[2] = mg[mo13 + 2]!; mar.age[3] = mg[mo13 + 3]!; mar.male = mg[mo13 + 4]!;
  for (let q = 0; q < 4; q++) { mar.race[q] = mg[mo13 + 5 + q]!; mar.collegeByAge[q] = mg[mo13 + 9 + q]!; }
  rake(cells, mar, 3);
  for (let k = 0; k < N_COHORTS; k++) {
    const s = cells[k]!; if (s <= 0) continue;
    const gi = groupOf[k]!, mu = inp.counties.mu[cl * N_COHORTS + k]! + shift, sg = inp.sigma[k]!;
    gS[gi]! += s; gM[gi]! += s * mu; gV[gi]! += s * (sg * sg + mu * mu); gT[gi]! += s * inp.tau[k]!;
  }
  for (let gi = 0; gi < 16; gi++) {
    const S = gS[gi]!; if (S <= 0) continue;
    const mu = gM[gi]! / S, sig = Math.sqrt(Math.max(1e-6, gV[gi]! / S - mu * mu)), inv = 1 / sig, tk = gT[gi]! / S + tb;
    const weight = S * E, wo = gi * ZG;
    let g0 = Math.floor((mu - 5 * sig - Z_LO) / Z_W), g1 = Math.ceil((mu + 5 * sig - Z_LO) / Z_W);
    if (g0 < 0) g0 = 0; if (g1 > ZG - 1) g1 = ZG - 1;
    let prev = g0 === 0 ? 0 : phi((EDGES[g0]! - mu) * inv);
    for (let g = g0; g <= g1; g++) {
      const up = g === ZG - 1 || g === g1 ? 1 : phi((EDGES[g + 1]! - mu) * inv);
      const mass = up - prev; prev = up;
      if (mass < 1e-9) continue;
      WA[wo + g]! += weight * mass * part[g]! * logi(tk + zt[g]!);
      if (WR) WR[wo + g]! += weight * mass * part[g]!;
    }
  }
}

/** Utility of each option (and abstaining, last) for one voter type in one county — the kernel's choice model. */
export function typeUtilities(inp: Pick<ShardInput, 'homeStateBonus' | 'homeCountyBonus'>, c: KernelContest, h: number, g: number, county: number, zShift: number, u: Float64Array): void {
  const J = c.options.length;
  u[J] = c.abstain;
  for (let j = 0; j < J; j++) {
    const o = c.options[j]!;
    u[j] = c.weight * o.partySign * (ZC[g]! + zShift) + o.base + o.classFit[h]! - o.minorAppeal * ABSZ[g]!
      + (o.homeState ? inp.homeStateBonus : 0) + (o.homeCounty === county ? inp.homeCountyBonus : 0);
  }
}

/** Run the kernel for one shard (a state). */
export function runShard(inp: ShardInput): ShardOutput {
  const n = inp.bus.count;
  const ballots = new Int32Array(n), ballotsByMode = new Int32Array(n * N_MODES), eligible = new Int32Array(n);
  // Mode shares by (age band, z bin).
  const modeP = new Float64Array(4 * ZG * N_MODES);
  for (let a = 0; a < 4; a++) for (let g = 0; g < ZG; g++) {
    let s = 0; const u = new Float64Array(N_MODES);
    for (let m = 0; m < N_MODES; m++) { const l = inp.modeLogits[a * N_MODES + m]!; u[m] = Number.isFinite(l) ? dexp(l + inp.modeGap[m]! * ZC[g]!) : 0; s += u[m]!; }
    for (let m = 0; m < N_MODES; m++) modeP[(a * ZG + g) * N_MODES + m] = u[m]! / s;
  }
  // Contest bookkeeping.
  const outs: ContestOutput[] = [];
  const unitLists: number[][] = []; const voteLists: number[][] = []; const modeLists: number[][] = [];
  const night = inp.parts;
  for (const c of inp.contests) {
    const k = c.options.length + 1;
    outs.push({ id: c.id, units: new Int32Array(0), votes: new Int32Array(0), rjMode: new Int32Array(inp.rjCount * N_MODES * k), expected: new Float64Array(k),
      ...(night ? { expPartMode: new Float64Array(night.count * N_MODES * k) } : {}),
      ...(c.rcv ? { rcvComp: new Float64Array(inp.rjCount * (k - 1) * N_TYPES), rcvCounty: new Int32Array(inp.rjCount).fill(-1) } : {}) });
    unitLists.push([]); voteLists.push([]); modeLists.push([]);
  }
  const expBallotsPartMode = night ? new Float64Array(night.count * N_MODES) : undefined;
  const V = new Float64Array(N_MODES * N_TYPES);       // voters by mode and type
  const sc = typeScratch(inp, false), WA = sc.WA;     // voters by (age band × class) group and z bin
  const probCache = new Map<number, Float64Array>();    // (contest, county) → P[j][type]
  const pbar = new Float64Array(16), draw = new Int32Array(16);
  let expectedBallots = 0;
  let curCounty = -1;

  const probTable = (ci: number, county: number): Float64Array => {
    const key = ci * 65536 + county;
    let t = probCache.get(key);
    if (t) return t;
    const c = inp.contests[ci]!; const J = c.options.length;
    t = new Float64Array((J + 1) * N_TYPES);
    const u = new Float64Array(J + 1);
    for (let h = 0; h < N_CLASS; h++) for (let g = 0; g < ZG; g++) {
      const ty = h * ZG + g;
      let mx = c.abstain; u[J] = c.abstain;
      for (let j = 0; j < J; j++) {
        const o = c.options[j]!;
        u[j] = c.weight * o.partySign * ZC[g]! + o.base + o.classFit[h]! - o.minorAppeal * ABSZ[g]!
          + (o.homeState ? inp.homeStateBonus : 0) + (o.homeCounty === county ? inp.homeCountyBonus : 0);
        if (u[j]! > mx) mx = u[j]!;
      }
      let s = 0; for (let j = 0; j <= J; j++) { u[j] = dexp(u[j]! - mx); s += u[j]!; }
      for (let j = 0; j <= J; j++) t[j * N_TYPES + ty] = u[j]! / s;
    }
    probCache.set(key, t);
    return t;
  };

  // Contests by geography: statewide ones are on every ballot, the others by the unit's district. A unit's
  // contests are taken in ascending contest order, as a scan of every contest would (the random draws, and so
  // the results, are the same); a state can have 150+ contests, of which a unit votes in five or six.
  const statewide: number[] = [];
  const geoArrays = [inp.bus.cd, inp.bus.sldu, inp.bus.sldl, ...(inp.bus.extra ?? [])];
  const byDistrict: Map<number, number[]>[] = geoArrays.map(() => new Map());
  inp.contests.forEach((c, ci) => {
    if (c.cd < 0) { statewide.push(ci); return; }
    const m = byDistrict[c.geo ?? 0]!; const l = m.get(c.cd); if (l) l.push(ci); else m.set(c.cd, [ci]);
  });
  const mine: number[] = [];
  const nGeo = geoArrays.length;
  const unitContests = (i: number): number[] => {
    mine.length = 0;
    for (const ci of statewide) mine.push(ci);
    for (let g = 0; g < nGeo; g++) { const m = byDistrict[g]!; if (!m.size) continue; const l = m.get(geoArrays[g]![i]!); if (l) for (const ci of l) mine.push(ci); }
    if (mine.length > 1) mine.sort((a, b) => a - b);
    return mine;
  };
  // Scratch per contest (zeroed before each use) and per unit.
  const totS = inp.contests.map((c) => new Int32Array(c.options.length + 1));
  const byModeS = night ? inp.contests.map((c) => new Int32Array(N_MODES * (c.options.length + 1))) : null;
  const lm = new Float64Array(N_MODES), bmS = new Int32Array(N_MODES);
  for (let i = 0; i < n; i++) {
    const b = inp.bus.start + i;
    const county = inp.bus.county[i]!;
    if (county !== curCounty) { probCache.clear(); curCounty = county; }
    const E = Math.round(inp.bus.vep[i]!);
    eligible[i] = E;
    if (E <= 0) continue;
    const list = unitContests(i);
    if (!list.length) { eligible[i] = 0; continue; } // no election here: no ballots, and the unit is not in this electorate
    // 1. Voter types (shared with the measurement port).
    unitTypes(inp, i, E, sc);
    V.fill(0);
    for (let a = 0; a < 4; a++) for (let h = 0; h < N_CLASS; h++) for (let g = 0; g < ZG; g++) {
      const w = WA[(a * N_CLASS + h) * ZG + g]!; if (w === 0) continue;
      const mo = (a * ZG + g) * N_MODES, ty = h * ZG + g;
      for (let m = 0; m < N_MODES; m++) V[m * N_TYPES + ty]! += w * modeP[mo + m]!;
    }
    // 2. Ballots: drawn once per unit, split by mode.
    const r = Rng.stream(inp.seedKey, 'bu', b);
    let lambda = 0;
    for (let m = 0; m < N_MODES; m++) { let s = 0; for (let ty = 0; ty < N_TYPES; ty++) s += V[m * N_TYPES + ty]!; lm[m] = s; lambda += s; }
    expectedBallots += lambda;
    const unitPart = night ? night.of[i]! : -1;
    if (expBallotsPartMode) for (let m = 0; m < N_MODES; m++) expBallotsPartMode[unitPart * N_MODES + m]! += lm[m]!;
    const B = r.binomial(E, Math.min(1, lambda / E));
    const bm = r.multinomial(B, lm, bmS);
    ballots[i] = B;
    for (let m = 0; m < N_MODES; m++) ballotsByMode[i * N_MODES + m] = bm[m]!;
    // 3. Contests on this unit's ballot.
    const rjLocal = inp.bus.rj[i]! - inp.rjFirst;
    for (let li = 0; li < list.length; li++) {
      const ci = list[li]!;
      const c = inp.contests[ci]!;
      const J = c.options.length, K = J + 1;
      const P = probTable(ci, county);
      const out = outs[ci]!;
      const tot = totS[ci]!; tot.fill(0);
      const byMode = byModeS ? byModeS[ci]! : null; if (byMode) byMode.fill(0);
      for (let m = 0; m < N_MODES; m++) {
        if (lm[m]! <= 0) continue;
        pbar.fill(0, 0, K);
        for (let j = 0; j < K; j++) { let s = 0; const row = j * N_TYPES; for (let ty = 0; ty < N_TYPES; ty++) s += V[m * N_TYPES + ty]! * P[row + ty]!; pbar[j] = s; out.expected[j]! += s; }
        if (out.expPartMode) { const eo = (unitPart * N_MODES + m) * K; for (let j = 0; j < K; j++) out.expPartMode[eo + j]! += pbar[j]!; }
        if (out.rcvComp) { // ranked-choice: who is behind each first choice (the undervote has no ranking)
          for (let j = 0; j < J; j++) { const co = (rjLocal * J + j) * N_TYPES, row = j * N_TYPES, vo = m * N_TYPES; for (let ty = 0; ty < N_TYPES; ty++) out.rcvComp[co + ty]! += V[vo + ty]! * P[row + ty]!; }
          if (out.rcvCounty![rjLocal]! < 0) out.rcvCounty![rjLocal] = county;
        }
        if (bm[m]! === 0) continue;
        r.multinomial(bm[m]!, pbar.subarray(0, K), draw);
        const ro = (rjLocal * N_MODES + m) * K;
        for (let j = 0; j < K; j++) { tot[j]! += draw[j]!; out.rjMode[ro + j]! += draw[j]!; }
        if (byMode) for (let j = 0; j < K; j++) byMode[m * K + j] = draw[j]!;
      }
      unitLists[ci]!.push(b);
      for (let j = 0; j < K; j++) voteLists[ci]!.push(tot[j]!);
      if (byMode) for (let j = 0; j < N_MODES * K; j++) modeLists[ci]!.push(byMode[j]!);
    }
  }
  outs.forEach((o, ci) => { o.units = Int32Array.from(unitLists[ci]!); o.votes = Int32Array.from(voteLists[ci]!); if (night) o.votesByMode = Int32Array.from(modeLists[ci]!); });
  return { ballots, ballotsByMode, eligible, contests: outs, expectedBallots, ...(expBallotsPartMode ? { expBallotsPartMode } : {}) };
}
