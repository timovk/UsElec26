/** On-device performance diagnostics (Settings → Diagnostics). Reports measured numbers only. */
import { Rng } from '../core/rng';
import { encodeIntColumns } from '../core/codec';
import { buLean } from '../electorate/model';
import type { Universe } from './universe';
import type { DiagnosticsResult } from './protocol';

export async function runDiagnostics(dbBench: () => { rows: number; ms: number }, u: Universe | null): Promise<DiagnosticsResult[]> {
  const out: DiagnosticsResult[] = [];
  // 1. Ballot-kernel throughput: multinomial draws as in the Phase 2 realization step.
  const r = Rng.stream('diagnostics', 'kernel');
  const probs = [0.46, 0.44, 0.06, 0.04]; const buf = new Int32Array(4);
  const units = 20_000, modes = 4, contests = 8;
  let t0 = performance.now(); let draws = 0;
  for (let b = 0; b < units; b++) for (let m = 0; m < modes; m++) for (let e = 0; e < contests; e++) { r.multinomial(80 + (b % 300), probs, buf); draws += 3; }
  let dt = performance.now() - t0;
  out.push({ name: 'Ballot kernel', value: Math.round(dt * 1e6 / draws), unit: 'ns per binomial draw', note: `${units.toLocaleString()} units × ${modes} modes × ${contests} contests in ${Math.round(dt)} ms. Projected national general election (230k units): ${(dt * 230_000 / units / 1000).toFixed(1)} s single-threaded.` });
  // 2. Archive codec.
  // Realistic vote-count-like values: unit sizes vary, shares vary (same distribution as the Phase 0 spike).
  const vr = Rng.stream('diagnostics', 'codec');
  const vals = Array.from({ length: 250_000 }, () => vr.binomial(Math.round(600 * Math.exp(0.6 * vr.normal())), vr.range(0.2, 0.7)));
  t0 = performance.now(); const enc = await encodeIntColumns([{ values: vals }]); dt = performance.now() - t0;
  out.push({ name: 'Archive encoding', value: +(enc.length / vals.length).toFixed(2), unit: 'bytes per count', note: `250,000 counts encoded in ${Math.round(dt)} ms` });
  // 3. SQLite write throughput (in-memory database).
  const wb = dbBench();
  out.push({ name: 'Database writes', value: Math.round(wb.rows / (wb.ms / 1000)), unit: 'rows per second', note: `${wb.rows.toLocaleString()} rows in one transaction in ${Math.round(wb.ms)} ms` });
  // 4. Electorate evaluation at full resolution (if a universe is open).
  if (u) {
    t0 = performance.now(); buLean(u.world.electorate, u.world.pack, u.world.pop); dt = performance.now() - t0;
    out.push({ name: 'Electorate evaluation', value: Math.round(dt), unit: 'ms', note: `Expected vote of all ${u.world.pack.bu.rows.toLocaleString()} Base Units × 64 cohorts` });
    t0 = performance.now(); await u.advance({ kind: 'days', days: 0 }, false); dt = performance.now() - t0;
    out.push({ name: 'Checkpoint save', value: Math.round(dt), unit: 'ms', note: 'Write of the universe checkpoint to on-device storage' });
  }
  out.push({ name: 'Logical processors', value: navigator.hardwareConcurrency ?? 0, unit: 'threads', note: 'Reported by the browser' });
  return out;
}
