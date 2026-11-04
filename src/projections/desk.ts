/**
 * Race-projection statistics (docs/architecture/04-statistical-methodology.md §4.13).
 *
 * For a linear contrast w over a race's options (leader − runner-up, or leader − everyone else for a
 * majority test), every cell (part × mode) has counted ballots c, counted contrast d, the wire's expected
 * ballots T̂ and a pre-election baseline rate b (contrast per ballot). The desk's belief about the rate of
 * the ballots still to be counted is hierarchical:
 *
 *   rate_j = b_j + s + δ_mode(j) + u_j
 *   s ~ N(s0, σ_s²) contest-wide swing (prior, voter survey, then the count)
 *   δ_m ~ N(0, σ_δ²) mode-specific swing (mail may break differently from Election Day)
 *   u_j ~ N(0, σ_u²) local deviation, learned from the cell's own counted ballots
 *
 * The final contrast is M = Σ d_j + Σ R_j · rate_j with R_j = max(0, T̂_j − c_j). Its mean and variance
 * follow analytically; P(M > 0) uses a Student-t (ν = 6) tail rather than the normal, because tail
 * behaviour matters near call thresholds.
 */
import { normCdf } from '../core/math';

export interface Cell {
  mode: number;
  counted: number;        // ballots counted
  contrast: number;       // Σ w_k × counted_k
  sq: number;             // Σ w_k² × counted_k (for the sampling variance)
  expected: number;       // wire's expected ballots T̂
  expectedSd: number;     // its uncertainty
  base: number;           // baseline contrast per ballot
  baseSq: number;         // baseline Σ w_k² share_k
  /** Per-cell drift of the remaining ballots (overrides the mode default; e.g. few precincts left = large). */
  drift?: number;
}

/**
 * drift: per mode, independent per-cell difference between ballots still to count and those counted.
 * sysDrift: per mode, the same difference shared across cells (late mail and late precincts differ
 * systematically from what was counted first), applied to the remaining ballots of observed cells.
 */
export interface Belief { s0: number; sdS: number; sdDelta: number; sdU: number; drift: number[]; sysDrift: number[] }

export interface Projection { mean: number; sd: number; p: number; counted: number; expected: number }

/** Student-t CDF with 6 degrees of freedom (closed form). */
export function t6Cdf(t: number): number {
  const x = 6 / (6 + t * t);
  return 0.5 + (t / (2 * Math.sqrt(6 + t * t))) * (1 + 0.5 * x + 0.375 * x * x);
}

export function project(cells: readonly Cell[], b: Belief): Projection {
  const N_MODES = 4;
  const sU2 = b.sdU * b.sdU, sD2 = b.sdDelta * b.sdDelta;
  // Mode-level evidence of swing relative to the baseline.
  const eM = new Float64Array(N_MODES), pM = new Float64Array(N_MODES);
  for (const c of cells) {
    if (c.counted <= 0) continue;
    const o = c.contrast / c.counted, nu = Math.max(1e-5, (c.sq / c.counted - o * o) / c.counted);
    const v = sU2 + nu;
    eM[c.mode]! += (o - c.base) / v; pM[c.mode]! += 1 / v;
  }
  let prec = 1 / (b.sdS * b.sdS), num = b.s0 * prec;
  const g = new Float64Array(N_MODES), vg = new Float64Array(N_MODES);
  for (let m = 0; m < N_MODES; m++) {
    if (pM[m]! <= 0) continue;
    g[m] = eM[m]! / pM[m]!; vg[m] = 1 / pM[m]!;
    prec += 1 / (vg[m]! + sD2); num += g[m]! / (vg[m]! + sD2);
  }
  const s = num / prec, varS = 1 / prec;
  const delta = new Float64Array(N_MODES), varDelta = new Float64Array(N_MODES).fill(sD2);
  for (let m = 0; m < N_MODES; m++) if (pM[m]! > 0) { delta[m] = (g[m]! - s) * sD2 / (sD2 + vg[m]!); varDelta[m] = sD2 * vg[m]! / (sD2 + vg[m]!); }

  let mean = 0, aS = 0, local = 0, turnout = 0, binom = 0, counted = 0, expected = 0;
  const aM = new Float64Array(N_MODES), rObs = new Float64Array(N_MODES);
  for (const c of cells) {
    mean += c.contrast; counted += c.counted;
    const T = Math.max(c.expected, c.counted); expected += T;
    const R = Math.max(0, c.expected - c.counted);
    let rate: number, lam = 0, varU = sU2;
    if (c.counted > 0) {
      const o = c.contrast / c.counted, nu = Math.max(1e-5, (c.sq / c.counted - o * o) / c.counted);
      lam = sU2 / (sU2 + nu); varU = sU2 * nu / (sU2 + nu);
      rate = (1 - lam) * (c.base + s + delta[c.mode]!) + lam * o;
      varU += (c.drift ?? b.drift[c.mode] ?? 0) ** 2;
      rObs[c.mode]! += R * lam;
    } else rate = c.base + s + delta[c.mode]!;
    if (rate > 1) rate = 1; else if (rate < -1) rate = -1;
    mean += R * rate;
    aS += R * (1 - lam); aM[c.mode]! += R * (1 - lam);
    local += R * R * varU;
    turnout += rate * rate * c.expectedSd * c.expectedSd;
    binom += R * Math.max(0, c.baseSq - rate * rate);
  }
  let variance = varS * aS * aS + local + turnout + binom;
  for (let m = 0; m < N_MODES; m++) variance += varDelta[m]! * aM[m]! * aM[m]! + ((b.sysDrift[m] ?? 0) * rObs[m]!) ** 2;
  const sd = Math.sqrt(Math.max(variance, 1e-9));
  return { mean, sd, p: t6Cdf(mean / sd), counted, expected };
}

/** P(|M| < band) under a normal approximation (recount risk). */
export function pInside(pr: Projection, band: number): number {
  if (band <= 0) return 0;
  return normCdf((band - pr.mean) / pr.sd) - normCdf((-band - pr.mean) / pr.sd);
}
