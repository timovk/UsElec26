// Phase 0 feasibility spike — NOT application code.
// Measures the cost of the "stratified realization" ballot kernel described in
// docs/architecture/04-statistical-methodology.md §4.4 at national scale.
//
// Usage: node tools/spikes/ballot-kernel-bench.mjs [baseUnits] [strata] [contests] [ballotScale]
// Defaults approximate a presidential-year general election at block-group resolution.

const BU = Number(process.argv[2] ?? 230_000); // base units (2010 block-group parts)
const Q = Number(process.argv[3] ?? 5);         // latent-lean strata (Gauss-Hermite nodes)
const E = Number(process.argv[4] ?? 8);         // contests on an average ballot
const SCALE = Number(process.argv[5] ?? 1);     // ballots-per-cell multiplier (use 5 with strata=1 to keep ~136M ballots)
const M = 4;                                    // ballot modes: ED, early in-person, mail, provisional
const K = 4;                                    // options per contest: 3 candidates + undervote

// --- PCG32-style deterministic PRNG (32-bit state ops via Math.imul) --------------------------
let s0 = 0x9e3779b9 | 0, s1 = 0x243f6a88 | 0, s2 = 0xb7e15162 | 0, s3 = 0x7f4a7c15 | 0;
function nextU32() { // xoshiro128**
  const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9);
  const t = s1 << 9;
  s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
  return r >>> 0;
}
function rotl(x, k) { return (x << k) | (x >>> (32 - k)); }
function uniform() { return (nextU32() + 0.5) / 4294967296; }
let spare = NaN;
function normal() {
  if (!Number.isNaN(spare)) { const v = spare; spare = NaN; return v; }
  let u, v, s;
  do { u = 2 * uniform() - 1; v = 2 * uniform() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const f = Math.sqrt(-2 * Math.log(s) / s); spare = v * f; return u * f;
}
// Binomial: inversion for small mean, clamped normal approximation for large n·p·q.
// (Production will use BTPE for exactness at large n; cost profile is comparable.)
function binomial(n, p) {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  const flip = p > 0.5; const pp = flip ? 1 - p : p;
  let x;
  if (n * pp < 20) {
    const q = 1 - pp, r = pp / q; let f = Math.pow(q, n), u = uniform(); x = 0;
    while (u > f && x < n) { u -= f; x++; f *= r * (n - x + 1) / x; }
  } else {
    const mu = n * pp, sd = Math.sqrt(mu * (1 - pp));
    x = Math.round(mu + sd * normal()); if (x < 0) x = 0; else if (x > n) x = n;
  }
  return flip ? n - x : x;
}

// --- Synthetic inputs ---------------------------------------------------------------------------
const ballots = new Uint16Array(BU * M * Q);          // ballots per (BU, mode, stratum)
for (let i = 0; i < ballots.length; i++) ballots[i] = (5 + (nextU32() % 50)) * SCALE;
const probs = new Float32Array(Q * E * K);            // P(option | stratum, contest)
for (let q = 0; q < Q; q++) for (let e = 0; e < E; e++) {
  let tot = 0; const base = (q * E + e) * K;
  for (let k = 0; k < K; k++) { const v = k === K - 1 ? 0.04 : 0.2 + uniform(); probs[base + k] = v; tot += v; }
  for (let k = 0; k < K; k++) probs[base + k] /= tot;
}
const out = new Uint32Array(BU * M * E * K);          // realized votes per (BU, mode, contest, option)

// --- Kernel -----------------------------------------------------------------------------------
const t0 = performance.now();
let draws = 0;
for (let b = 0; b < BU; b++) {
  for (let m = 0; m < M; m++) {
    const outBase = (b * M + m) * E * K;
    for (let q = 0; q < Q; q++) {
      const n0 = ballots[(b * M + m) * Q + q];
      for (let e = 0; e < E; e++) {
        // multinomial via sequential conditional binomials
        let n = n0, rem = 1; const pb = (q * E + e) * K, ob = outBase + e * K;
        for (let k = 0; k < K - 1; k++) {
          const p = probs[pb + k] / rem; const x = binomial(n, p > 1 ? 1 : p);
          out[ob + k] += x; n -= x; rem -= probs[pb + k]; draws++;
        }
        out[ob + K - 1] += n; // remainder -> last option; per-contest sum == ballots exactly
      }
    }
  }
}
const t1 = performance.now();

// --- Invariant check: every contest's options sum to the ballots cast in each (BU, mode) ------
let violations = 0;
for (let b = 0; b < BU; b++) for (let m = 0; m < M; m++) {
  let cast = 0; for (let q = 0; q < Q; q++) cast += ballots[(b * M + m) * Q + q];
  for (let e = 0; e < E; e++) {
    let s = 0; const ob = ((b * M + m) * E + e) * K; for (let k = 0; k < K; k++) s += out[ob + k];
    if (s !== cast) violations++;
  }
}
// --- County roll-up (≈74 BUs per county) ------------------------------------------------------
const C = 3142; const county = new Float64Array(C * E * K);
const t2 = performance.now();
for (let b = 0; b < BU; b++) { const c = b % C; for (let m = 0; m < M; m++) { const ob = (b * M + m) * E * K;
  for (let i = 0; i < E * K; i++) county[c * E * K + i] += out[ob + i]; } }
const t3 = performance.now();

const totalBallots = ballots.reduce((a, x) => a + x, 0);
console.log(JSON.stringify({
  baseUnits: BU, strata: Q, contests: E, modes: M, options: K,
  totalBallots, binomialDraws: draws,
  kernelMs: Math.round(t1 - t0), countyRollupMs: Math.round(t3 - t2),
  nsPerDraw: +((t1 - t0) * 1e6 / draws).toFixed(1), sumViolations: violations,
  node: process.version,
}, null, 2));
