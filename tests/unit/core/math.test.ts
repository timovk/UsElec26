import { describe, expect, it } from 'vitest';
import { dexp, dlog, logFactorial, normCdf, normInv } from '../../../src/core/math';
import { Rng } from '../../../src/core/rng';

function ulpDiff(a: number, b: number): number {
  if (a === b) return 0;
  const f = new Float64Array([a, b]); const i = new BigInt64Array(f.buffer);
  const d = i[0]! - i[1]!; return Number(d < 0n ? -d : d);
}

describe('deterministic math (fdlibm ports)', () => {
  it('dexp matches Math.exp within 1 ulp over a wide range, and exactly on most inputs', () => {
    const r = Rng.stream('test', 'math', 'exp');
    let exact = 0, worst = 0; const N = 200_000;
    for (let i = 0; i < N; i++) {
      const x = (r.float() - 0.5) * 1400;
      const u = ulpDiff(dexp(x), Math.exp(x)); worst = Math.max(worst, u); if (u === 0) exact++;
    }
    expect(worst).toBeLessThanOrEqual(1);
    expect(exact / N).toBeGreaterThan(0.99);
  });
  it('dlog matches Math.log within 1 ulp', () => {
    const r = Rng.stream('test', 'math', 'log');
    let worst = 0;
    for (let i = 0; i < 200_000; i++) { const x = Math.pow(10, (r.float() - 0.5) * 600); worst = Math.max(worst, ulpDiff(dlog(x), Math.log(x))); }
    expect(worst).toBeLessThanOrEqual(1);
  });
  it('handles special values', () => {
    expect(dexp(0)).toBe(1); expect(dexp(Infinity)).toBe(Infinity); expect(dexp(-Infinity)).toBe(0);
    expect(Number.isNaN(dexp(NaN))).toBe(true); expect(dexp(1000)).toBe(Infinity); expect(dexp(-1000)).toBe(0);
    expect(dlog(1)).toBe(0); expect(dlog(0)).toBe(-Infinity); expect(Number.isNaN(dlog(-1))).toBe(true);
    expect(dlog(5e-324)).toBeCloseTo(Math.log(5e-324), 10);
  });
  it('normCdf / normInv are consistent and accurate', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7); expect(normCdf(1.959964)).toBeCloseTo(0.975, 6);
    for (const p of [1e-6, 0.01, 0.2, 0.5, 0.8, 0.99, 1 - 1e-6]) expect(normCdf(normInv(p))).toBeCloseTo(p, 6);
  });
  it('logFactorial is continuous across the table boundary', () => {
    let s = 0; for (let i = 2; i <= 2000; i++) s += Math.log(i);
    expect(logFactorial(2000)).toBeCloseTo(s, 6);
    expect(logFactorial(1023) + Math.log(1024)).toBeCloseTo(logFactorial(1024), 8);
  });
});
