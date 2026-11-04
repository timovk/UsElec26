import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Rng, hash128 } from '../../../src/core/rng';

describe('keyed RNG streams', () => {
  it('same key → same sequence; different keys → different sequences', () => {
    const a = Rng.stream('seed', 'ballots', 2016, 'PA'), b = Rng.stream('seed', 'ballots', 2016, 'PA');
    const c = Rng.stream('seed', 'ballots', 2016, 'OH');
    const sa = Array.from({ length: 50 }, () => a.nextU32()), sb = Array.from({ length: 50 }, () => b.nextU32());
    expect(sa).toEqual(sb);
    expect(Array.from({ length: 50 }, () => c.nextU32())).not.toEqual(sa);
  });
  it('known-answer vector (guards against accidental algorithm changes)', () => {
    expect(hash128('ENA')).toEqual(hash128('ENA'));
    const r = Rng.stream('known-answer');
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toMatchSnapshot();
  });
  it('state round-trips mid-stream including the cached normal', () => {
    const r = Rng.stream('s', 'state'); r.normal(); r.float();
    const st = r.state(); const r2 = Rng.fromState(JSON.parse(JSON.stringify(st)));
    for (let i = 0; i < 20; i++) expect(r2.normal()).toBe(r.normal());
  });
  it('float is in [0,1) and int is unbiased-ish', () => {
    const r = Rng.stream('s', 'u'); const counts = new Array(7).fill(0);
    for (let i = 0; i < 70_000; i++) { const f = r.float(); expect(f >= 0 && f < 1).toBe(true); counts[r.int(7)]++; }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });
  it('binomial has correct mean and variance in both regimes', () => {
    for (const [n, p] of [[30, 0.1], [5000, 0.37], [1_000_000, 0.5], [200, 0.97]] as const) {
      const r = Rng.stream('s', 'binom', n, p); const N = 20_000; let s = 0, s2 = 0;
      for (let i = 0; i < N; i++) { const x = r.binomial(n, p); expect(x >= 0 && x <= n).toBe(true); s += x; s2 += x * x; }
      const mean = s / N, v = s2 / N - mean * mean, mu = n * p, sig2 = n * p * (1 - p);
      expect(Math.abs(mean - mu)).toBeLessThan(5 * Math.sqrt(sig2 / N) + 1e-9);
      expect(Math.abs(v / sig2 - 1)).toBeLessThan(0.06);
    }
  });
  it('multinomial always sums exactly to n (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100_000 }), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 8 }), fc.integer(),
      (n, probs, seed) => {
        const out = Rng.stream('mn', seed).multinomial(n, probs);
        let s = 0; for (const x of out) { if (x < 0) return false; s += x; }
        return s === n;
      }));
  });
  it('gamma/beta/dirichlet means', () => {
    const r = Rng.stream('s', 'g'); let s = 0; for (let i = 0; i < 20_000; i++) s += r.gamma(2.5);
    expect(s / 20_000).toBeCloseTo(2.5, 1);
    let b = 0; for (let i = 0; i < 20_000; i++) b += r.beta(2, 6); expect(b / 20_000).toBeCloseTo(0.25, 2);
    const d = r.dirichlet([1, 2, 3]); expect(d.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
  });
  it('hypergeometric has the exact mean and variance and stays in its support', () => {
    for (const [good, bad, n] of [[5, 7, 4], [40, 60, 30], [3000, 1000, 2500], [120_000, 80_000, 50_000], [1, 999, 500], [700, 300, 1000]] as const) {
      const r = Rng.stream('s', 'hg', good, bad, n); const T = 20_000; let s = 0, s2 = 0;
      const N = good + bad, lo = Math.max(0, n - bad), hi = Math.min(n, good);
      for (let i = 0; i < T; i++) { const x = r.hypergeometric(good, bad, n); expect(x >= lo && x <= hi).toBe(true); s += x; s2 += x * x; }
      const mean = s / T, v = s2 / T - mean * mean, mu = n * good / N, sig2 = n * (good / N) * (bad / N) * (N - n) / Math.max(1, N - 1);
      expect(Math.abs(mean - mu)).toBeLessThan(5 * Math.sqrt(sig2 / T) + 1e-9);
      if (sig2 > 0) expect(Math.abs(v / sig2 - 1)).toBeLessThan(0.07);
    }
  });
  it('multivariate hypergeometric partitions exactly (property)', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 7 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer(),
      (counts, frac, seed) => {
        const total = counts.reduce((a, b) => a + b, 0), n = Math.floor(total * frac);
        const out = Rng.stream('mvhg', seed).mvHypergeometric(counts, n, new Int32Array(counts.length));
        let s = 0; for (let i = 0; i < counts.length; i++) { if (out[i]! < 0 || out[i]! > counts[i]!) return false; s += out[i]!; }
        return s === n;
      }));
  });
});
