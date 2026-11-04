/**
 * The forecast engine: probabilities behave (monotone in the margin, uncertainty grows with time left), the
 * electoral-vote distribution and the chambers are consistent, and on synthetic cycles drawn from a world whose
 * errors match the model, forecasts are calibrated.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng';
import { runForecast, type ForecastInput, type ForecastRace } from '../../../src/forecasting/model';

const states = (lean: (i: number) => number, poll?: (i: number) => number | null): ForecastRace[] => Array.from({ length: 51 }, (_, i) => {
  const p = poll?.(i) ?? null;
  return { key: `PS:${i}`, kind: 'pres_state', label: `S${i}`, state: i, division: i % 9 + 1, ev: i < 10 ? 20 : i < 30 ? 9 : 4, lean: lean(i), candidate: 0, poll: p === null ? null : { mean: p, sd: 1.5, n: 10, age: 3 }, contested: true, sure: 0 };
});
const base = (races: ForecastRace[], daysLeft = 10, nat = 0): ForecastInput => ({ seed: 'F', year: 2016, asOf: 100, daysLeft, fundamentals: { mean: nat, sd: 4 }, national: { mean: nat, sd: 1, n: 50 }, races, chambers: { senate: { holdD: 30, holdR: 30, seats: 100 }, house: { seats: 435 } }, vpParty: 1, presidential: true, draws: 3000 });

describe('forecast engine', () => {
  it('win probability rises with the margin; uncertainty grows with the time left', () => {
    const out = runForecast(base(states((i) => (i - 25) * 0.8)));
    const ps = out.races.map((r) => r.pD);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeGreaterThanOrEqual(ps[i - 1]! - 0.05);
    const near = runForecast(base(states(() => 3), 5)), far = runForecast(base(states(() => 3), 200));
    expect(far.races[0]!.hi80 - far.races[0]!.lo80).toBeGreaterThan(near.races[0]!.hi80 - near.races[0]!.lo80);
    expect(Math.abs(far.races[0]!.pD - 0.5)).toBeLessThan(Math.abs(near.races[0]!.pD - 0.5));
  });
  it('electoral votes, ties and the tipping point are consistent', () => {
    const out = runForecast(base(states((i) => (i - 25) * 0.6)));
    const p = out.president!;
    expect(p.pD + p.pR + p.pTie).toBeCloseTo(1, 6);
    expect(p.evHist.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(Object.values(p.tipping).reduce((a, b) => a + b, 0)).toBeGreaterThan(0.95);
    expect(p.ev80[0]).toBeLessThanOrEqual(p.evMean); expect(p.ev80[1]).toBeGreaterThanOrEqual(p.evMean);
  });
  it('is calibrated on synthetic cycles whose errors follow the model', () => {
    // Truth: final margin = estimate + correlated national, regional and state errors (as the model assumes).
    const bins = Array.from({ length: 10 }, () => ({ n: 0, wins: 0, p: 0 }));
    for (let cyc = 0; cyc < 60; cyc++) {
      const r = Rng.stream('cal', cyc);
      const lean = Array.from({ length: 51 }, () => r.normal(0, 9));
      const nat = r.normal(0, 3), eN = r.normal(0, 2.4), div = Array.from({ length: 10 }, () => r.normal(0, 1.5));
      const truth = lean.map((l, i) => l + nat + eN + div[i % 9 + 1]! + r.normal(0, 2.2));
      const polled = lean.map((l, i) => (r.bernoulli(0.6) ? truth[i]! - eN - div[i % 9 + 1]! + r.normal(0, 1.5) : null));
      const out = runForecast({ ...base(states((i) => lean[i]!, (i) => polled[i]!), 10, nat), seed: `cal${cyc}`, national: { mean: nat, sd: 1, n: 50 } });
      out.races.forEach((x, i) => { const b = bins[Math.min(9, Math.floor(x.pD * 10))]!; b.n++; b.p += x.pD; if (truth[i]! > 0) b.wins++; });
    }
    let worst = 0;
    for (const b of bins) if (b.n >= 60) worst = Math.max(worst, Math.abs(b.wins / b.n - b.p / b.n));
    console.log(bins.map((b) => (b.n ? `${(b.p / b.n).toFixed(2)}→${(b.wins / b.n).toFixed(2)} (${b.n})` : '-')).join(' | '));
    expect(worst).toBeLessThan(0.12);
  });
});
