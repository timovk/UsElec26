/**
 * The economy (docs/architecture/04-statistical-methodology.md §4.12), one step a month.
 *
 * - **National:** a two-state regime (expansion/recession; mean expansion about 7 years, mean recession about
 *   11 months); GDP growth (annualized) as AR(1) around the regime's mean; unemployment following growth with
 *   inertia (an Okun-type link toward a slowly moving natural rate); inflation as AR(1) around a 2% target
 *   with a Phillips-curve term and rare supply shocks. Initial conditions are the real January 2016 values;
 *   from there the paths are simulated and diverge from history.
 * - **States:** growth g_s = g_N + β_s (g_N − ḡ) + AR(1)_s with a cyclical sensitivity β_s drawn once per
 *   state; each state's unemployment follows its own growth around a persistent offset.
 *
 * Values here are the economy's truth. The Public Record sees only released figures (see `releases`).
 */
import { Rng } from '../core/rng';

export interface EconomyState {
  /** Months since January 2016 (0 = January 2016). */
  month: number;
  recession: boolean;
  /** Months in the current regime. */
  regimeAge: number;
  gdp: number;            // annualized real GDP growth this month (%)
  unemployment: number;   // %
  natural: number;        // natural rate of unemployment (%)
  inflation: number;      // CPI, 12-month (%)
  supplyShock: number;    // persistent supply-shock component of inflation (points)
  /** Per state: cyclical sensitivity, own AR(1) growth deviation, unemployment offset and unemployment. */
  stateBeta: number[]; stateDev: number[]; stateOffset: number[]; stateUnemp: number[];
  /** Real income index (Jan 2016 = 100). */
  income: number;
}

export const ECON_START = { gdp: 1.6, unemployment: 4.9, inflation: 1.4 } as const;

export function initialEconomy(seed: string, states: number): EconomyState {
  const r = Rng.stream(seed, 'economy', 'init');
  const stateOffset = Array.from({ length: states }, () => r.normal(0, 0.9));
  return {
    month: 0, recession: false, regimeAge: 79, gdp: ECON_START.gdp, unemployment: ECON_START.unemployment, natural: 4.6,
    inflation: ECON_START.inflation, supplyShock: 0,
    stateBeta: Array.from({ length: states }, () => Math.max(0.3, r.normal(1, 0.35))), stateDev: new Array<number>(states).fill(0),
    stateOffset, stateUnemp: stateOffset.map((o) => Math.max(2, ECON_START.unemployment + o)), income: 100,
  };
}

/** One month. Deterministic in the seed and the month. */
export function stepEconomy(seed: string, s: EconomyState): EconomyState {
  const month = s.month + 1;
  const r = Rng.stream(seed, 'economy', month);
  // Regime switching: expansions end with a hazard that rises slowly with age; recessions last about 11 months.
  let recession = s.recession, regimeAge = s.regimeAge + 1;
  if (!recession && r.bernoulli(0.0085 + 0.00004 * regimeAge)) { recession = true; regimeAge = 0; }
  else if (recession && r.bernoulli(regimeAge < 4 ? 0.03 : 0.11)) { recession = false; regimeAge = 0; }
  // GDP growth: AR(1) toward the regime mean; recoveries start strong.
  const target = recession ? -3.4 : regimeAge < 12 && s.recession === false && s.regimeAge < 12 ? 3.4 : 2.1;
  const gdp = 0.72 * s.gdp + 0.28 * target + r.normal(0, 0.9);
  // Unemployment: an Okun link (growth above trend lowers it), with inertia, toward a slowly moving natural rate.
  const natural = Math.min(6, Math.max(3.8, s.natural + r.normal(0, 0.02)));
  const okun = -0.05 * (gdp - 2.0);
  const unemployment = Math.min(14, Math.max(2.8, s.unemployment + okun + 0.02 * (natural - s.unemployment) + r.normal(0, 0.06)));
  // Inflation: AR(1) around 2% with a Phillips term and rare, persistent supply shocks.
  const supplyShock = 0.92 * s.supplyShock + (r.bernoulli(0.008) ? r.normal(2.5, 1.2) : 0);
  const inflation = Math.min(12, Math.max(-1.5, 0.93 * s.inflation + 0.07 * 2.0 - 0.02 * (s.unemployment - natural) + 0.08 * supplyShock - 0.08 * s.supplyShock + r.normal(0, 0.12)));
  // States.
  const stateDev = s.stateDev.map((d) => 0.85 * d + r.normal(0, 0.6));
  const stateUnemp = s.stateUnemp.map((u, i) => {
    const g = gdp + s.stateBeta[i]! * (gdp - 2.0) + stateDev[i]!;
    return Math.min(18, Math.max(1.8, u - 0.035 * (g - 2.0) + 0.03 * (unemployment + s.stateOffset[i]! - u) + r.normal(0, 0.05)));
  });
  const income = s.income * (1 + (gdp - 0.8) / 1200 - Math.max(0, inflation - 2.5) / 2400);
  return { month, recession, regimeAge, gdp, unemployment, natural, inflation, supplyShock, stateBeta: s.stateBeta, stateDev, stateOffset: s.stateOffset, stateUnemp, income };
}

/** Calendar of a month index (0 = January 2016). */
export const monthOf = (m: number): { y: number; m: number } => ({ y: 2016 + Math.floor(m / 12), m: (m % 12) + 1 });
export const monthIndex = (y: number, m: number): number => (y - 2016) * 12 + (m - 1);

/**
 * How the economy feels: a standardized index (0 is an ordinary economy, −2 a recession, +1 a boom) from
 * unemployment and its change, growth and inflation. This is what voters respond to.
 */
export function economicIndex(s: EconomyState, unempYearAgo: number): number {
  return -0.55 * (s.unemployment - 5) - 0.6 * (s.unemployment - unempYearAgo) + 0.25 * (s.gdp - 2.1) - 0.3 * Math.max(0, s.inflation - 2.8);
}
