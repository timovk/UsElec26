/**
 * Polling averages (docs/architecture/04 §4.9): a local-level Kalman filter per race on each option's share and
 * on the leading margin, with house effects estimated across every race and shrunk by empirical Bayes. Only
 * published polls go in. A recency-weighted average is computed alongside for transparency.
 */

export interface PollObs {
  day: number;                       // middle of the field period (Eastern day number)
  pollster: number; n: number;
  /** Option key → share in points (0–100), undecided excluded from the keys. */
  shares: Record<string, number>;
}

export interface AverageOut {
  day: number; polls: number;
  /** Option key → mean share (points) and 80% band. */
  options: Record<string, { mean: number; lo: number; hi: number }>;
  /** Margin of `lead` over `second` (points) with its 80% band; Democratic minus Republican when both exist. */
  margin: { a: string; b: string; mean: number; lo: number; hi: number } | null;
  /** Simple recency-weighted average (last 21 days), for comparison. */
  simple: Record<string, number>;
  /** Points of margin by which registered-voter polls were moved toward the likely electorate (general elections). */
  lvGap?: number;
}

const Z80 = 1.2816;

/** Pollster house effects on the margin (points), from residuals against unadjusted averages, shrunk toward 0. */
export function houseEffects(residuals: { pollster: number; resid: number }[], k = 6): Map<number, number> {
  const acc = new Map<number, { s: number; n: number }>();
  for (const r of residuals) { const a = acc.get(r.pollster) ?? { s: 0, n: 0 }; a.s += r.resid; a.n++; acc.set(r.pollster, a); }
  return new Map([...acc].map(([p, a]) => [p, a.s / (a.n + k)]));
}

/**
 * The Kalman local-level filter for one series of observations (points), evaluated at `asOf`.
 * q: daily state variance; each observation's variance = sampling + pollster error.
 */
export function kalman(obs: { day: number; y: number; v: number }[], asOf: number, q = 0.06, prior = { m: 0, v: 400 }): { mean: number; sd: number } {
  const xs = [...obs].filter((o) => o.day <= asOf).sort((a, b) => a.day - b.day);
  if (!xs.length) return { mean: prior.m, sd: Math.sqrt(prior.v) };
  let m = prior.m, P = prior.v, t = xs[0]!.day;
  for (const o of xs) {
    P += q * Math.max(0, o.day - t); t = o.day;
    const K = P / (P + o.v); m += K * (o.y - m); P *= 1 - K;
  }
  P += q * Math.max(0, asOf - t);
  return { mean: m, sd: Math.sqrt(P) };
}

/** Observation variance (points²) of a share in a poll of size n, with design effect and pollster error. */
const obsVar = (share: number, n: number) => (share * (100 - share) * 1.6) / Math.max(50, n) + 2.5;

/**
 * The average of one race as of `asOf`: house-effect-adjusted Kalman estimates for every option and the margin.
 * `house` maps a pollster to its estimated house effect on the margin (points, positive toward option `a`).
 * Repeated releases from one pollster inside a week are down-weighted.
 */
export function raceAverage(polls: PollObs[], asOf: number, house: Map<number, number>, marginPair: [string, string] | null): AverageOut | null {
  const ps = polls.filter((p) => p.day <= asOf);
  if (!ps.length) return null;
  const keys = [...new Set(ps.flatMap((p) => Object.keys(p.shares)))].sort();
  // Flooding guard: a pollster's polls within 7 days of a later one by the same pollster count for less.
  const weight = ps.map((p) => 1 / (1 + ps.filter((o) => o.pollster === p.pollster && o.day > p.day && o.day - p.day < 7).length));
  const options: AverageOut['options'] = {};
  for (const k of keys) {
    const obs = ps.map((p, i) => ({ day: p.day, y: p.shares[k] ?? 0, v: obsVar(p.shares[k] ?? 0, p.n) / weight[i]! }));
    const first = obs[0]!.y;
    const f = kalman(obs, asOf, 0.04, { m: first, v: 100 });
    options[k] = { mean: f.mean, lo: f.mean - Z80 * f.sd, hi: f.mean + Z80 * f.sd };
  }
  let margin: AverageOut['margin'] = null;
  const pair = marginPair ?? (() => { const o = keys.sort((x, y) => options[y]!.mean - options[x]!.mean); return o.length > 1 ? [o[0]!, o[1]!] as [string, string] : null; })();
  if (pair) {
    const [a, b] = pair;
    const obs = ps.map((p, i) => {
      const m = (p.shares[a] ?? 0) - (p.shares[b] ?? 0) - (house.get(p.pollster) ?? 0);
      const v = (obsVar(p.shares[a] ?? 0, p.n) + obsVar(p.shares[b] ?? 0, p.n)) * 1.6;
      return { day: p.day, y: m, v: v / weight[i]! };
    });
    const f = kalman(obs, asOf, 0.08, { m: obs[0]!.y, v: 200 });
    margin = { a, b, mean: f.mean, lo: f.mean - Z80 * f.sd, hi: f.mean + Z80 * f.sd };
  }
  const recent = ps.filter((p) => asOf - p.day <= 21);
  const simple: Record<string, number> = {};
  if (recent.length) for (const k of keys) {
    let s = 0, w = 0; for (const p of recent) { const ww = Math.exp(-(asOf - p.day) / 10) * Math.sqrt(p.n); s += ww * (p.shares[k] ?? 0); w += ww; }
    simple[k] = s / w;
  }
  return { day: asOf, polls: ps.length, options, margin, simple };
}
