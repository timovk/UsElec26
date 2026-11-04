/**
 * Keyed, reproducible random streams.
 *
 * Every random process draws from a stream identified by (universe seed, purpose, keys…). Streams are
 * independent of evaluation order, sharding and worker count. Within a stream, draws are sequential
 * (xoshiro128**). A stream's full state is 4 words plus a cached normal deviate, so it can be serialized.
 */
import { dexp, dlog, logFactorial } from './math';

export type StreamKey = readonly (string | number)[];

/** cyrb128: 128-bit non-cryptographic string hash (public domain, bryc). Deterministic. */
export function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** 32-bit hash of a string (for cheap deterministic choices that need no stream). */
export function hash32(str: string): number { return hash128(str)[0]; }

function rotl(x: number, k: number): number { return (x << k) | (x >>> (32 - k)); }

export interface RngState { s: [number, number, number, number]; spare: number | null }

export class Rng {
  private s0: number; private s1: number; private s2: number; private s3: number;
  private spare: number | null = null;

  constructor(seed: readonly [number, number, number, number]) {
    const [a0, b, c, d] = seed;
    const a = (a0 | b | c | d) === 0 ? 0x9e3779b9 : a0;
    this.s0 = a | 0; this.s1 = b | 0; this.s2 = c | 0; this.s3 = d | 0;
    for (let i = 0; i < 8; i++) this.nextU32(); // decorrelate nearby seeds
  }

  /** The canonical way to obtain randomness: a stream keyed by the universe seed and a purpose. */
  static stream(universeSeed: string, ...key: StreamKey): Rng {
    return new Rng(hash128(`${universeSeed}\u001f${key.join('\u001f')}`));
  }

  static fromState(st: RngState): Rng {
    const r = Object.create(Rng.prototype) as Rng;
    r.s0 = st.s[0] | 0; r.s1 = st.s[1] | 0; r.s2 = st.s[2] | 0; r.s3 = st.s[3] | 0; r.spare = st.spare;
    return r;
  }

  state(): RngState { return { s: [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0], spare: this.spare }; }

  /** A child stream derived from this stream's next output and a key (for hierarchical generation). */
  fork(...key: StreamKey): Rng {
    return new Rng(hash128(`${this.nextU32()}\u001f${this.nextU32()}\u001f${key.join('\u001f')}`));
  }

  nextU32(): number {
    const r = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9);
    const t = this.s1 << 9;
    this.s2 ^= this.s0; this.s3 ^= this.s1; this.s1 ^= this.s2; this.s0 ^= this.s3; this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return r >>> 0;
  }

  /** Uniform in [0, 1) with 53 bits of precision. */
  float(): number {
    const a = this.nextU32() >>> 5, b = this.nextU32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** Uniform in (0, 1): never returns 0 (safe for log). */
  floatOpen(): number {
    let u = this.float();
    while (u === 0) u = this.float();
    return u;
  }

  /** Unbiased integer in [0, n). */
  int(n: number): number {
    if (n <= 0) throw new RangeError('int(n) requires n > 0');
    if (n <= 0x100000000) {
      const limit = 0x100000000 - (0x100000000 % n);
      let x = this.nextU32();
      while (x >= limit) x = this.nextU32();
      return x % n;
    }
    return Math.floor(this.float() * n);
  }

  range(a: number, b: number): number { return a + (b - a) * this.float(); }
  intRange(a: number, bInclusive: number): number { return a + this.int(bInclusive - a + 1); }
  bernoulli(p: number): boolean { return this.float() < p; }

  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return mean + sd * v; }
    let u: number, v: number, s: number;
    do { u = 2 * this.float() - 1; v = 2 * this.float() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt(-2 * dlog(s) / s);
    this.spare = v * f;
    return mean + sd * u * f;
  }

  /** Normal truncated to [lo, hi] by rejection (intended for mild truncation). */
  truncNormal(mean: number, sd: number, lo: number, hi: number): number {
    for (let i = 0; i < 1000; i++) { const x = this.normal(mean, sd); if (x >= lo && x <= hi) return x; }
    return Math.min(hi, Math.max(lo, mean));
  }

  /** Gamma(shape, 1), Marsaglia–Tsang. */
  gamma(shape: number): number {
    if (shape < 1) return this.gamma(shape + 1) * dexp(dlog(this.floatOpen()) / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do { x = this.normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = this.floatOpen();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (dlog(u) < 0.5 * x * x + d * (1 - v + dlog(v))) return d * v;
    }
  }

  beta(a: number, b: number): number { const x = this.gamma(a); return x / (x + this.gamma(b)); }

  /** Beta parameterized by mean and concentration (a + b). */
  betaMean(mean: number, concentration: number): number { return this.beta(mean * concentration, (1 - mean) * concentration); }

  dirichlet(alpha: ArrayLike<number>, out = new Float64Array(alpha.length)): Float64Array {
    let sum = 0;
    for (let i = 0; i < alpha.length; i++) { const g = this.gamma(alpha[i]!); out[i] = g; sum += g; }
    for (let i = 0; i < alpha.length; i++) out[i]! /= sum;
    return out;
  }

  /** Binomial(n, p). Exact: inversion for small means, Hörmann's BTRS otherwise. */
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (p > 0.5) return n - this.binomial(n, 1 - p);
    if (n * p < 10) {
      // Inversion via sequential search (geometric waiting-time free).
      const q = 1 - p, r = p / q;
      let f = dexp(n * dlog(q)); let u = this.float(); let x = 0;
      while (u > f && x < n) { u -= f; x++; f *= r * (n - x + 1) / x; }
      return x;
    }
    const spq = Math.sqrt(n * p * (1 - p));
    const b = 1.15 + 2.53 * spq;
    const a = -0.0873 + 0.0248 * b + 0.01 * p;
    const c = n * p + 0.5;
    const vr = 0.92 - 4.2 / b;
    const alpha = (2.83 + 5.1 / b) * spq;
    const lpq = dlog(p / (1 - p));
    const m = Math.floor((n + 1) * p);
    const h = logFactorial(m) + logFactorial(n - m);
    for (;;) {
      const u = this.float() - 0.5;
      let v = this.float();
      const us = 0.5 - Math.abs(u);
      const k = Math.floor((2 * a / us + b) * u + c);
      if (k < 0 || k > n) continue;
      if (us >= 0.07 && v <= vr) return k;
      v = dlog(v * alpha / (a / (us * us) + b));
      if (v <= h - logFactorial(k) - logFactorial(n - k) + (k - m) * lpq) return k;
    }
  }

  /** Multinomial(n, probs) via conditional binomials. Writes counts into `out`; Σ out = n exactly. */
  multinomial(n: number, probs: ArrayLike<number>, out: Int32Array | Uint32Array | Float64Array = new Int32Array(probs.length)): typeof out {
    let rem = n, mass = 0;
    for (let i = 0; i < probs.length; i++) mass += probs[i]!;
    for (let i = 0; i < probs.length - 1; i++) {
      const p = mass > 0 ? probs[i]! / mass : 0;
      const x = rem > 0 ? this.binomial(rem, p > 1 ? 1 : p) : 0;
      out[i] = x; rem -= x; mass -= probs[i]!;
    }
    out[probs.length - 1] = rem;
    return out;
  }

  /**
   * Hypergeometric: the number of `good` items in a sample of `sample` drawn without replacement from
   * `good + bad` items. Exact, by inversion searching outward from the mode (Kemp's chop-down), so the
   * expected cost grows with the standard deviation, not the population. Deterministic (dexp/dlog only).
   */
  hypergeometric(good: number, bad: number, sample: number): number {
    const N = good + bad;
    if (sample <= 0 || good <= 0) return 0;
    if (sample >= N) return good;
    if (bad <= 0) return sample;
    // Symmetries keep the search short: sample ≤ N/2 and good ≤ bad.
    if (sample > N / 2) return good - this.hypergeometric(good, bad, N - sample);
    if (good > bad) return sample - this.hypergeometric(bad, good, sample);
    const lo = Math.max(0, sample - bad), hi = Math.min(sample, good);
    const m = Math.min(hi, Math.max(lo, Math.floor((sample + 1) * (good + 1) / (N + 2))));
    const logPm = logFactorial(good) - logFactorial(m) - logFactorial(good - m) + logFactorial(bad) - logFactorial(sample - m)
      - logFactorial(bad - sample + m) - (logFactorial(N) - logFactorial(sample) - logFactorial(N - sample));
    const pm = dexp(logPm);
    let u = this.float() - pm;
    if (u <= 0) return m;
    // ratio p(k+1)/p(k) = (good-k)(sample-k) / ((k+1)(bad-sample+k+1))
    let up = m, pUp = pm, dn = m, pDn = pm;
    for (;;) {
      const canUp = up < hi, canDn = dn > lo;
      if (!canUp && !canDn) return m; // rounding exhausted the mass: return the mode
      if (canUp) {
        pUp *= ((good - up) * (sample - up)) / ((up + 1) * (bad - sample + up + 1)); up++;
        u -= pUp; if (u <= 0) return up;
      }
      if (canDn) {
        pDn *= (dn * (bad - sample + dn)) / ((good - dn + 1) * (sample - dn + 1)); dn--;
        u -= pDn; if (u <= 0) return dn;
      }
    }
  }

  /**
   * Multivariate hypergeometric: draw `sample` items without replacement from categories with `counts`
   * (by sequential conditional hypergeometric draws). Writes into `out`; Σ out = sample and out ≤ counts.
   */
  mvHypergeometric(counts: ArrayLike<number>, sample: number, out: Int32Array): Int32Array {
    let total = 0;
    for (let i = 0; i < counts.length; i++) total += counts[i]!;
    let rem = Math.min(sample, total);
    for (let i = 0; i < counts.length - 1; i++) {
      const c = counts[i]!;
      total -= c;
      const x = rem > 0 ? this.hypergeometric(c, total, rem) : 0;
      out[i] = x; rem -= x;
    }
    out[counts.length - 1] = rem;
    return out;
  }

  /** Index drawn proportionally to non-negative weights. */
  weighted(weights: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i]!;
    if (!(total > 0)) return this.int(weights.length);
    let u = this.float() * total;
    for (let i = 0; i < weights.length; i++) { u -= weights[i]!; if (u < 0) return i; }
    return weights.length - 1;
  }

  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]!; }

  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) { const j = this.int(i + 1); const t = xs[i]!; xs[i] = xs[j]!; xs[j] = t; }
    return xs;
  }
}
