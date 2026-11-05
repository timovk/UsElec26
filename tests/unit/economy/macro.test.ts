/** The macro model against stylized facts of the U.S. business cycle over many simulated decades. */
import { describe, expect, it } from 'vitest';
import { economicIndex, initialEconomy, stepEconomy } from '../../../src/economy/macro';

describe('the economy', () => {
  it('business cycles, unemployment and inflation behave like the postwar U.S. economy', () => {
    const exp: number[] = [], rec: number[] = []; const unemp: number[] = [], infl: number[] = [], gdp: number[] = []; const recRise: number[] = [];
    for (let seed = 0; seed < 60; seed++) {
      let s = initialEconomy(`E${seed}`, 51); let len = s.regimeAge, start = s.unemployment, first = true;
      for (let m = 0; m < 600; m++) {
        const n = stepEconomy(`E${seed}`, s);
        if (n.recession !== s.recession) {
          if (!first) (s.recession ? rec : exp).push(len);
          first = false; len = 0;
          if (n.recession) start = s.unemployment; else recRise.push(s.unemployment - start);
        }
        len++; s = n; unemp.push(s.unemployment); infl.push(s.inflation); gdp.push(s.gdp);
        for (const u of s.stateUnemp) { expect(u).toBeGreaterThanOrEqual(1.8); expect(u).toBeLessThanOrEqual(18); }
      }
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    console.log(`expansions ${(mean(exp) / 12).toFixed(1)} y (${exp.length}), recessions ${mean(rec).toFixed(1)} mo, unemployment ${mean(unemp).toFixed(1)}% (${Math.min(...unemp).toFixed(1)}–${Math.max(...unemp).toFixed(1)}), rise in recessions ${mean(recRise).toFixed(1)} pts, inflation ${mean(infl).toFixed(1)}%, growth ${mean(gdp).toFixed(1)}%`);
    expect(mean(exp) / 12).toBeGreaterThan(4.5); expect(mean(exp) / 12).toBeLessThan(10);
    expect(mean(rec)).toBeGreaterThan(6); expect(mean(rec)).toBeLessThan(16);
    expect(mean(unemp)).toBeGreaterThan(4); expect(mean(unemp)).toBeLessThan(7.5);
    expect(mean(recRise)).toBeGreaterThan(1);
    expect(mean(infl)).toBeGreaterThan(1.2); expect(mean(infl)).toBeLessThan(3.5);
    expect(mean(gdp)).toBeGreaterThan(1.3); expect(mean(gdp)).toBeLessThan(2.8);
  });
  it('the economic index falls in recessions and is near zero in ordinary times', () => {
    let s = initialEconomy('IDX', 51); const hist: number[] = [s.unemployment]; const inRec: number[] = [], outRec: number[] = [];
    for (let m = 0; m < 1200; m++) { s = stepEconomy('IDX', s); hist.push(s.unemployment); const x = economicIndex(s, hist[Math.max(0, hist.length - 13)]!); (s.recession ? inRec : outRec).push(x); }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(inRec)).toBeLessThan(mean(outRec) - 0.5);
    expect(Math.abs(mean(outRec))).toBeLessThan(1);
  });
});
