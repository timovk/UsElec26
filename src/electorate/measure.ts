/**
 * Measurement of the electorate by observers (the information firewall's one sanctioned door,
 * docs/architecture/02 §2.2): every quantity leaves here with realistic error, and observers
 * (wire, survey, decision desks) never see the cast results or the model's expectations directly.
 */
import type { Rng } from '../core/rng';

const N_MODES = 4;

/**
 * The desks' pre-election baseline for each (part, mode) cell of a race: the vote shares one would expect
 * from public information (past results and polling, until Phase 5 provides real forecasts). Built from the
 * model expectation plus error along the race's main axis: a state component, a component per voting mode,
 * a race component and local noise.
 */
export function publishedBaseline(expPartMode: Float64Array, parts: readonly number[], K: number, axis: readonly number[],
  err: { state: number; mode: readonly number[]; race: number }, rng: Rng): { shares: Float64Array; has: Uint8Array } {
  const shares = new Float64Array(parts.length * N_MODES * K), has = new Uint8Array(parts.length * N_MODES);
  const a = axis.indexOf(1), b = axis.indexOf(-1);
  parts.forEach((p, i) => {
    const loc = rng.normal(0, 0.035);
    for (let m = 0; m < N_MODES; m++) {
      const o = (p * N_MODES + m) * K;
      let tot = 0; for (let k = 0; k < K; k++) tot += expPartMode[o + k]!;
      if (tot <= 0) continue;
      has[i * N_MODES + m] = 1;
      const so = (i * N_MODES + m) * K;
      for (let k = 0; k < K; k++) shares[so + k] = expPartMode[o + k]! / tot;
      if (a >= 0 && b >= 0) {
        const e = err.state + err.mode[m]! + err.race + loc, pair = shares[so + a]! + shares[so + b]!;
        const sa = Math.min(pair - 0.001, Math.max(0.001, shares[so + a]! + 0.5 * e * pair));
        shares[so + a] = sa; shares[so + b] = pair - sa;
      }
    }
  });
  return { shares, has };
}

/** The voter survey (exit poll): a sample of the realized electorate with nonresponse bias along the race axis. */
export function voterSurvey(castValid: readonly number[], axis: readonly number[], bias: number, n: number, rng: Rng): { shares: number[]; nEff: number } | null {
  const tot = castValid.reduce((x, y) => x + y, 0);
  if (tot <= 0 || castValid.length < 2) return null;
  const sh = castValid.map((v) => v / tot);
  const a = axis.indexOf(1), b = axis.indexOf(-1);
  if (a >= 0 && b >= 0) { const pair = sh[a]! + sh[b]!; sh[a] = Math.min(pair, Math.max(0, sh[a]! + 0.5 * bias * pair)); sh[b] = pair - sh[a]!; }
  const nEff = Math.max(1, Math.round(n / 1.6)); // design effect of a clustered sample
  const draw = rng.multinomial(nEff, sh, new Int32Array(sh.length));
  return { shares: Array.from(draw, (x) => x / nEff), nEff };
}

/** The wire's turnout priors per part: Election Day and accepted provisional ballots, with modelling error. */
export function wirePriors(expBallots: Float64Array, parts: number, provReject: number, rng: Rng): { ed: Float64Array; prov: Float64Array } {
  const ed = new Float64Array(parts), prov = new Float64Array(parts);
  const stateT = Math.exp(rng.normal(0, 0.05));
  for (let p = 0; p < parts; p++) {
    ed[p] = expBallots[p * N_MODES]! * stateT * Math.exp(rng.normal(0, 0.07));
    prov[p] = expBallots[p * N_MODES + 3]! * (1 - provReject) * Math.exp(rng.normal(0, 0.3));
  }
  return { ed, prov };
}
