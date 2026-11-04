// Phase 0 feasibility spike — NOT application code.
// Estimates archive bytes per stored vote count using the planned encoding
// (column-major, zig-zag delta against a per-unit expected value, LEB128 varint, deflate-raw).
// Usage: node tools/spikes/archive-encoding-bench.mjs [units] [options]
import { deflateRawSync } from 'node:zlib';

const N = Number(process.argv[2] ?? 230_000);
const K = Number(process.argv[3] ?? 4); // e.g. D, R, minor, undervote
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// Synthetic but realistically distributed counts: unit ballots ~ lognormal around 600,
// two-party share varies with a smooth geographic trend plus local noise.
const ballots = new Uint32Array(N), votes = new Uint32Array(N * K);
let lean = 0;
for (let i = 0; i < N; i++) {
  lean = 0.97 * lean + 0.25 * gauss();                // spatially autocorrelated ordering
  const b = Math.max(20, Math.round(600 * Math.exp(0.6 * gauss())));
  ballots[i] = b;
  const pD = 1 / (1 + Math.exp(-(lean + 0.3 * gauss())));
  const under = Math.round(b * (0.02 + 0.02 * rnd())), minor = Math.round(b * 0.03 * rnd());
  const two = b - under - minor, d = Math.round(two * pD);
  votes.set([d, two - d, minor, under], i * K);
}

function varints(values) {
  const out = []; for (const v0 of values) { let v = v0 >>> 0; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); }
  return Uint8Array.from(out);
}
const zz = (x) => ((x << 1) ^ (x >> 31)) >>> 0;

// Encoding A: raw row-major uint32
const rawBytes = votes.byteLength;
// Encoding B: column-major varint + deflate
const colMajor = []; for (let k = 0; k < K; k++) for (let i = 0; i < N; i++) colMajor.push(votes[i * K + k]);
const b = deflateRawSync(varints(colMajor), { level: 9 }).length;
// Encoding C: store ballots column, then each option as zig-zag delta vs. previous unit's same option
const cols = [];
for (let i = 0; i < N; i++) cols.push(zz(ballots[i] - (i ? ballots[i - 1] : 0)));
for (let k = 0; k < K - 1; k++) for (let i = 0; i < N; i++) cols.push(zz(votes[i * K + k] - (i ? votes[(i - 1) * K + k] : 0)));
// last option is implied: ballots - sum(other options)  (sum constraint makes it free)
const c = deflateRawSync(varints(cols), { level: 9 }).length;

const ints = N * K;
console.log(JSON.stringify({
  units: N, options: K, storedInts: ints,
  rawMB: +(rawBytes / 1e6).toFixed(2),
  colVarintDeflateMB: +(b / 1e6).toFixed(2), bytesPerIntB: +(b / ints).toFixed(2),
  deltaImpliedLastMB: +(c / 1e6).toFixed(2), bytesPerIntC: +(c / ints).toFixed(2),
}, null, 2));
