/**
 * Deterministic math for the simulation core.
 *
 * ECMAScript leaves Math.exp/log/pow/... implementation-defined, so results may differ between
 * engines and versions. These are TypeScript ports of fdlibm's __ieee754_exp and __ieee754_log
 * (Sun Microsystems, freely redistributable), which makes simulation results bit-identical
 * everywhere. Math.sqrt, +, -, *, / are IEEE-754 correctly rounded and therefore already deterministic.
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Little-endian: u32[0] = low word, u32[1] = high word. All supported platforms are little-endian.
if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('core/math requires a little-endian platform');

function hi(x: number): number { f64[0] = x; return u32[1]! | 0; }
function lo(x: number): number { f64[0] = x; return u32[0]!; }
function withHi(x: number, h: number): number { f64[0] = x; u32[1] = h >>> 0; return f64[0]; }

const o_threshold = 7.09782712893383973096e+02;
const u_threshold = -7.45133219101941108420e+02;
const ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01] as const;
const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10] as const;
const halF = [0.5, -0.5] as const;
const invln2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;
const twom1000 = 9.33263618503218878990e-302;
const huge = 1.0e+300;

/** fdlibm exp(x). */
export function dexp(x: number): number {
  let hx = hi(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  let hiPart = 0, loPart = 0, k = 0;

  if (hx >= 0x40862E42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lo(x)) !== 0) return x + x; // NaN
      return xsb === 0 ? x : 0.0;
    }
    if (x > o_threshold) return Infinity;
    if (x < u_threshold) return 0;
  }

  if (hx > 0x3fd62e42) {
    if (hx < 0x3FF0A2B2) {
      hiPart = x - ln2HI[xsb]!; loPart = ln2LO[xsb]!; k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(invln2 * x + halF[xsb]!);
      const t = k;
      hiPart = x - t * ln2HI[0];
      loPart = t * ln2LO[0];
    }
    x = hiPart - loPart;
  } else if (hx < 0x3e300000) {
    if (huge + x > 1) return 1 + x;
  } else {
    k = 0;
  }

  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
  const y = 1 - ((loPart - (x * c) / (2.0 - c)) - hiPart);
  if (k >= -1021) {
    if (k === 1024) return y * 2.0 * 2 ** 1023;
    return withHi(y, hi(y) + (k << 20));
  }
  return withHi(y, hi(y) + ((k + 1000) << 20)) * twom1000;
}

const ln2_hi = 6.93147180369123816490e-01;
const ln2_lo = 1.90821492927058770002e-10;
const two54 = 1.80143985094819840000e+16;
const Lg1 = 6.666666666666735130e-01;
const Lg2 = 3.999999999940941908e-01;
const Lg3 = 2.857142874366239149e-01;
const Lg4 = 2.222219843214978396e-01;
const Lg5 = 1.818357216161805012e-01;
const Lg6 = 1.531383769920937332e-01;
const Lg7 = 1.479819860511658591e-01;

/** fdlibm log(x) (natural logarithm). */
export function dlog(x: number): number {
  let hx = hi(x);
  const lx = lo(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= two54; hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) {
      if (k === 0) return 0;
      const dk = k; return dk * ln2_hi + dk * ln2_lo;
    }
    const R = f * f * (0.5 - (1 / 3) * f);
    if (k === 0) return f - R;
    const dk = k; return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}

/** x^y via exp(y·log x). Deterministic, not correctly rounded; defined for x > 0, and x = 0 with y > 0. */
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    const r = dexp(y * dlog(-x));
    return y % 2 === 0 ? r : -r;
  }
  return dexp(y * dlog(x));
}

export function dlogistic(x: number): number {
  return x >= 0 ? 1 / (1 + dexp(-x)) : (() => { const e = dexp(x); return e / (1 + e); })();
}

export function dlogit(p: number): number { return dlog(p / (1 - p)); }

export function dtanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e = dexp(2 * x);
  return (e - 1) / (e + 1);
}

/** Standard normal CDF Φ(x). Abramowitz & Stegun 26.2.17 (|error| < 7.5e-8), built on dexp. */
export function normCdf(x: number): number {
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = 0.3989422804014327 * dexp(-0.5 * ax * ax) * poly;
  return x >= 0 ? 1 - tail : tail;
}

/** Inverse standard normal CDF (Acklam's algorithm with one Halley refinement step). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * dlog(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5, r = q * q;
    x = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * dlog(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * dexp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

const LOG_FACT_TABLE_SIZE = 1024;
const logFactTable = new Float64Array(LOG_FACT_TABLE_SIZE);
for (let i = 2; i < LOG_FACT_TABLE_SIZE; i++) logFactTable[i] = logFactTable[i - 1]! + dlog(i);

/** ln(k!) for integer k ≥ 0. */
export function logFactorial(k: number): number {
  if (k < LOG_FACT_TABLE_SIZE) return logFactTable[k]!;
  const x = k + 1; // ln Γ(x) by Stirling series
  const ix = 1 / x, ix2 = ix * ix;
  return (x - 0.5) * dlog(x) - x + 0.9189385332046728 + ix * (1 / 12 - ix2 * (1 / 360 - ix2 / 1260));
}

/** Kahan–Babuška summation of an array-like. */
export function ksum(xs: ArrayLike<number>): number {
  let s = 0, c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!; const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
    s = t;
  }
  return s + c;
}

export function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
