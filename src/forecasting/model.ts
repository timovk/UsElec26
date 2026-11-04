/**
 * The forecast (docs/architecture/04 §4.10): a Bayesian-flavoured Monte Carlo over the Public Record only —
 * partisan lean from past results, a fundamentals prior for the national environment, polling averages, and a
 * correlated error model (national, regional, state; Student-t tails) whose national part grows with the time
 * to the election. Margins are Democratic minus Republican, in points of the two-party vote.
 */
import { Rng } from '../core/rng';

export interface ForecastRace {
  key: string; kind: 'pres_state' | 'pres_cd' | 'us_senator' | 'governor' | 'us_representative';
  label: string; state: number; division: number; ev: number;
  /** Partisan lean relative to the nation (points, D+), from past results (or the public lean index in the first cycle). */
  lean: number;
  /** Candidate effects known publicly: incumbency (D +, R −), quality and money differences, in points. */
  candidate: number;
  /** House-effect-adjusted polling average of the margin, if any. */
  poll: { mean: number; sd: number; n: number; age: number } | null;
  /** Both major parties have a candidate (otherwise the race is decided by who is on the ballot). */
  contested: boolean;
  /** When uncontested: the party certain to win (1 or 2), else 0. */
  sure: number;
}

export interface ForecastInput {
  seed: string; year: number; asOf: number; daysLeft: number;
  /** Fundamentals: the national margin expected from incumbency and the cycle (points), and its uncertainty. */
  fundamentals: { mean: number; sd: number };
  /** National polling average of the presidential race or the generic ballot (points), if any. */
  national: { mean: number; sd: number; n: number } | null;
  races: ForecastRace[];
  chambers: { senate: { holdD: number; holdR: number; seats: number }; house: { seats: number } };
  /** The Vice President's party breaks Senate ties (in a presidential year, the winner's in each draw). */
  vpParty: number; presidential: boolean;
  draws: number;
}

export interface RaceForecast { key: string; pD: number; mean: number; lo80: number; hi80: number; lo95: number; hi95: number }
export interface ForecastOutput {
  asOf: number; national: { mean: number; sd: number };
  races: RaceForecast[];
  president: { pD: number; pR: number; pTie: number; evMean: number; ev80: [number, number]; ev95: [number, number]; evHist: number[]; tipping: Record<string, number> } | null;
  senate: { pD: number; mean: number; hist: number[] } | null;
  house: { pD: number; mean: number; hist: number[] } | null;
  governors: { meanD: number; races: number } | null;
}

// Student-t (5 degrees of freedom) scaled to unit variance, sampled by inverse CDF from a table (one uniform per draw).
const T5_N = 4096;
const T5 = (() => {
  // CDF of t5 by numerical integration of its density, then inverted on a uniform grid.
  const dens = (x: number) => Math.pow(1 + (x * x) / 5, -3);
  const xs: number[] = [], cs: number[] = []; let c = 0; const step = 0.002, lo = -40;
  for (let x = lo; x <= -lo; x += step) { c += dens(x) * step; xs.push(x); cs.push(c); }
  const tab = new Float64Array(T5_N); let j = 0;
  for (let i = 0; i < T5_N; i++) { const u = ((i + 0.5) / T5_N) * c; while (cs[j]! < u) j++; tab[i] = xs[j]! * Math.sqrt(3 / 5); }
  return tab;
})();
const t5 = (r: Rng) => T5[Math.min(T5_N - 1, (r.float() * T5_N) | 0)]!;
const T5_Q = (q: number) => T5[Math.min(T5_N - 1, Math.max(0, Math.round(q * T5_N - 0.5)))]!;
// Normal CDF by table lookup (House seats are integrated analytically in every House draw).
const PHI_T = (() => { const t = new Float64Array(2001); for (let i = 0; i <= 2000; i++) t[i] = 0.5 * (1 + erf((-10 + i * 0.01) / Math.SQRT2)); return t; })();
const phiCdf = (x: number) => { const u = (x + 10) * 100; if (u <= 0) return 0; if (u >= 2000) return 1; const i = u | 0, f = u - i; return PHI_T[i]! + (PHI_T[i + 1]! - PHI_T[i]!) * f; };
function erf(x: number): number { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!; };

/** Prior SD of a race's margin around lean + national, by office (points). */
const PRIOR_SD: Record<ForecastRace['kind'], number> = { pres_state: 4, pres_cd: 5, us_senator: 7, governor: 8, us_representative: 8 };

export function runForecast(f: ForecastInput): ForecastOutput {
  const r = Rng.stream(f.seed, 'forecast', f.year, f.asOf);
  // National environment: fundamentals, updated by the national polling average.
  let nat = { mean: f.fundamentals.mean, sd: f.fundamentals.sd };
  if (f.national) {
    const v = f.national.sd ** 2 + 2.5 ** 2; // poll average error plus a systematic polling miss
    const w = 1 / nat.sd ** 2 + 1 / v;
    nat = { mean: (nat.mean / nat.sd ** 2 + f.national.mean / v) / w, sd: Math.sqrt(1 / w) };
  }
  // Each race: prior from lean, national and candidates; then its own polls.
  const T = Math.max(0, f.daysLeft);
  const sdN = Math.sqrt(nat.sd ** 2 + (0.6 + 2.2 * Math.sqrt(T / 120)) ** 2);   // national error grows with time left
  const sdDiv = 1.5, races = f.races;
  const post = races.map((x) => {
    const prior = { m: x.lean + nat.mean + x.candidate, v: PRIOR_SD[x.kind] ** 2 };
    if (!x.poll) return { m: prior.m, local: Math.sqrt(prior.v) };
    // The race's polls inform its deviation from the national environment; their own error includes a state-level miss.
    const pv = x.poll.sd ** 2 + 2 ** 2 + 0.05 * x.poll.age;
    const w = 1 / prior.v + 1 / pv;
    return { m: (prior.m / prior.v + x.poll.mean / pv) / w, local: Math.sqrt(1 / w) };
  });
  const S = f.draws;
  const pDwin = new Float64Array(races.length);
  const presMargin = new Float64Array(races.length); // this draw's margins (presidential races only, for the tipping point)
  const evD = new Int32Array(S), senD = new Int32Array(S), houseD = new Int32Array(S), govD = new Int32Array(S);
  const tipping = new Map<string, number>();
  const presRaces = races.map((x, i) => ({ x, i })).filter(({ x }) => x.kind === 'pres_state' || x.kind === 'pres_cd');
  const houseRaces = races.map((x, i) => ({ x, i })).filter(({ x }) => x.kind === 'us_representative');
  const divErr = new Float64Array(10);
  const totalEV = presRaces.reduce((a, { x }) => a + x.ev, 0);
  let presD = 0, presR = 0, tie = 0, senCtl = 0, houseCtl = 0, houseN = 0;
  for (let d = 0; d < S; d++) {
    const eN = t5(r) * sdN;
    for (let k = 0; k < 10; k++) divErr[k] = r.normal(0, sdDiv);
    let ev = 0, sen = 0, gov = 0;
    for (let i = 0; i < races.length; i++) {
      const x = races[i]!;
      if (x.kind === 'us_representative') continue;
      let m: number;
      if (!x.contested) m = x.sure === 1 ? 100 : x.sure === 2 ? -100 : 0;
      else m = post[i]!.m + eN + divErr[x.division]! + t5(r) * post[i]!.local * 0.85;
      presMargin[i] = m;
      if (m > 0) { pDwin[i]! += 1; if (x.kind === 'pres_state' || x.kind === 'pres_cd') ev += x.ev; else if (x.kind === 'us_senator') sen++; else if (x.kind === 'governor') gov++; }
    }
    // House: correlated through the national and regional errors, local outcomes integrated analytically
    // (every fifth draw: the seat distribution needs fewer draws than the state-by-state map).
    let hs = 0, hv = 0;
    const houseDraw = d % 5 === 0;
    if (houseDraw) houseN++;
    if (houseDraw) for (const { x, i } of houseRaces) {
      let p: number;
      if (!x.contested) p = x.sure === 1 ? 1 : 0;
      else p = phiCdf((post[i]!.m + eN + divErr[x.division]!) / post[i]!.local);
      pDwin[i]! += p; hs += p; hv += p * (1 - p);
    }
    evD[d] = ev; govD[d] = gov;
    if (houseDraw) { const house = Math.round(hs + Math.sqrt(hv) * r.normal(0, 1)); houseD[houseN - 1] = Math.max(0, Math.min(f.chambers.house.seats, house)); }
    senD[d] = f.chambers.senate.holdD + sen;
    if (presRaces.length) {
      if (ev >= 270) presD++; else if (totalEV - ev >= 270) presR++; else tie++;
      // Tipping point: sort states by margin; the one that brings the winner to 270.
      const winnerD = ev >= 270;
      const order = presRaces.map(({ x, i }) => ({ key: x.key, ev: x.ev, m: presMargin[i]! })).sort((a, b) => (winnerD ? b.m - a.m : a.m - b.m));
      let acc = 0; for (const o of order) { acc += o.ev; if (acc >= 270) { tipping.set(o.key, (tipping.get(o.key) ?? 0) + 1); break; } }
    }
    const vp = f.presidential ? (ev >= 270 ? 1 : 2) : f.vpParty;
    if (senD[d]! > f.chambers.senate.seats / 2 || (senD[d]! === f.chambers.senate.seats / 2 && vp === 1)) senCtl++;
    if (houseDraw && houseD[houseN - 1]! > f.chambers.house.seats / 2) houseCtl++;
  }
  // Intervals of each race's margin: national, regional and local parts combined (the t tails are kept by using t quantiles).
  const raceOut: RaceForecast[] = races.map((x, i) => {
    const n = x.kind === 'us_representative' ? Math.max(1, houseN) : S;
    if (!x.contested) { const m = x.sure === 1 ? 100 : x.sure === 2 ? -100 : 0; return { key: x.key, pD: pDwin[i]! / n, mean: m, lo80: m, hi80: m, lo95: m, hi95: m }; }
    const sd = Math.sqrt(sdN ** 2 + sdDiv ** 2 + (post[i]!.local * (x.kind === 'us_representative' ? 1 : 0.85)) ** 2), m = post[i]!.m;
    return { key: x.key, pD: pDwin[i]! / n, mean: m, lo80: m + sd * T5_Q(0.1), hi80: m + sd * T5_Q(0.9), lo95: m + sd * T5_Q(0.025), hi95: m + sd * T5_Q(0.975) };
  });
  const hist = (a: Int32Array, max: number) => { const h = new Array<number>(max + 1).fill(0); for (const v of a) h[Math.max(0, Math.min(max, v))]!++; return h; };
  const evs = Array.from(evD);
  const anyPres = presRaces.length > 0, senRaces = races.filter((x) => x.kind === 'us_senator').length, govRaces = races.filter((x) => x.kind === 'governor').length;
  return {
    asOf: f.asOf, national: nat, races: raceOut,
    president: anyPres ? { pD: presD / S, pR: presR / S, pTie: tie / S, evMean: evs.reduce((a, b) => a + b, 0) / S, ev80: [quantile(evs, 0.1), quantile(evs, 0.9)], ev95: [quantile(evs, 0.025), quantile(evs, 0.975)], evHist: hist(evD, 538), tipping: Object.fromEntries([...tipping].map(([k, v]) => [k, v / S])) } : null,
    senate: senRaces >= 10 ? { pD: senCtl / S, mean: Array.from(senD).reduce((a, b) => a + b, 0) / S, hist: hist(senD, f.chambers.senate.seats) } : null,
    house: houseRaces.length >= 10 ? { pD: houseCtl / Math.max(1, houseN), mean: Array.from(houseD.subarray(0, houseN)).reduce((a, b) => a + b, 0) / Math.max(1, houseN), hist: hist(houseD.subarray(0, houseN), f.chambers.house.seats) } : null,
    governors: govRaces ? { meanD: Array.from(govD).reduce((a, b) => a + b, 0) / S, races: govRaces } : null,
  };
}

/** Probabilities as the forecast reports them: whole percent, never 0 or 100. */
export const reportPct = (p: number) => (p > 0.99 ? '>99%' : p < 0.01 ? '<1%' : `${Math.round(100 * p)}%`);
