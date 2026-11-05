/**
 * Baseline algorithmic redistricting (docs/architecture/06-geographic-strategy.md; roadmap Phase 6):
 * contiguous, compact, equal-population plans built from whole Base Units, without partisan data.
 *
 * 1. **Recursive bisection.** A region with k districts is cut in two parts holding ⌊k/2⌋ and ⌈k/2⌉ districts'
 *    worth of population. Cuts are straight lines at 16 orientations; the cut position balances population
 *    exactly to one BU. The orientation chosen minimises the parts' moment of inertia (compactness) plus a
 *    penalty for each county split.
 * 2. **Contiguity repair** on the BU neighbour graph: stray fragments join the neighbouring district they
 *    share the most boundary with.
 * 3. **Rebalancing:** boundary BUs move from over- to under-populated neighbours, never disconnecting a
 *    district, until every district is within the tolerance (or no move helps).
 *
 * The BU neighbour graph approximates adjacency from geometry the pack carries (BU centroids and county
 * adjacency): each BU links to its nearest BUs in the same or an adjacent county, and islands link to the
 * nearest mainland BU, as real plans do across water.
 */
import Flatbush from 'flatbush';

export interface PlanRegion {
  /** Coordinates (projected), population and county of each BU in the region (local indices 0..n−1). */
  x: Float32Array | Float64Array; y: Float32Array | Float64Array; pop: Float64Array; county: Uint16Array | Int32Array;
  /** County adjacency (global county indices). */
  countyAdj: readonly (readonly number[])[];
  /** Land area per BU (m²) and the projection's scale (projected units per metre), for compactness. */
  area: Float32Array | Float64Array; unitsPerMeter: number;
}

export interface PlanOptions {
  /** Relative size of each district (1 for single-member; seats for multi-member districts). */
  sizes: number[];
  /** Maximum relative population deviation from each district's ideal (e.g. 0.005). */
  tolerance: number;
  /** Optional: an enclosing plan each district must nest in (local enclosing-district index per BU) and the enclosing district of each new district. */
  nest?: { within: Int32Array; parentOf: number[] };
}

export interface PlanResult { district: Int32Array; stats: PlanStats }
export interface PlanStats {
  populations: number[]; ideal: number[]; maxDeviation: number; contiguous: boolean;
  countiesSplit: number; compactness: number[]; moves: number;
}

/** BU neighbour graph (CSR): k nearest neighbours in the same or adjacent counties, symmetrized, components joined. */
export function buGraph(r: PlanRegion, k = 8): { off: Int32Array; nbr: Int32Array } {
  const n = r.x.length;
  const lists: Set<number>[] = Array.from({ length: n }, () => new Set());
  if (n === 0) return { off: new Int32Array(1), nbr: new Int32Array(0) };
  const index = new Flatbush(n);
  for (let i = 0; i < n; i++) index.add(r.x[i]!, r.y[i]!, r.x[i]!, r.y[i]!);
  index.finish();
  const adjSet = new Map<number, Set<number>>();
  const adjacent = (a: number, b: number) => { if (a === b) return true; let s = adjSet.get(a); if (!s) { s = new Set(r.countyAdj[a] ?? []); adjSet.set(a, s); } return s.has(b); };
  for (let i = 0; i < n; i++) {
    const near = index.neighbors(r.x[i]!, r.y[i]!, k + 1, Infinity, (j) => j !== i && adjacent(r.county[i]!, r.county[j]!));
    for (const j of near) { if (j === i) continue; lists[i]!.add(j); lists[j]!.add(i); }
  }
  // Join components (islands, peninsulas the k-NN missed) to the largest one by their nearest pair.
  for (let guard = 0; guard < 200; guard++) {
    const comp = components(n, (i, f) => { for (const j of lists[i]!) f(j); });
    if (comp.count <= 1) break;
    const sizes = new Array<number>(comp.count).fill(0); for (let i = 0; i < n; i++) sizes[comp.id[i]!]!++;
    const main = sizes.indexOf(Math.max(...sizes));
    for (let c = 0; c < comp.count; c++) {
      if (c === main) continue;
      let best = -1, bi = -1, bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (comp.id[i] !== c) continue;
        const near = index.neighbors(r.x[i]!, r.y[i]!, 1, Infinity, (j) => comp.id[j] !== c);
        const j = near[0]; if (j === undefined) continue;
        const d = (r.x[i]! - r.x[j]!) ** 2 + (r.y[i]! - r.y[j]!) ** 2;
        if (d < bd) { bd = d; best = j; bi = i; }
      }
      if (bi >= 0) { lists[bi]!.add(best); lists[best]!.add(bi); }
    }
  }
  const off = new Int32Array(n + 1); for (let i = 0; i < n; i++) off[i + 1] = off[i]! + lists[i]!.size;
  const nbr = new Int32Array(off[n]!); for (let i = 0; i < n; i++) { let p = off[i]!; for (const j of [...lists[i]!].sort((a, b) => a - b)) nbr[p++] = j; }
  return { off, nbr };
}

function components(n: number, each: (i: number, f: (j: number) => void) => void, include?: (i: number) => boolean): { id: Int32Array; count: number } {
  const id = new Int32Array(n).fill(-1); let count = 0; const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (id[s] !== -1 || (include && !include(s))) continue;
    id[s] = count; stack.push(s);
    while (stack.length) { const i = stack.pop()!; each(i, (j) => { if (id[j] === -1 && (!include || include(j))) { id[j] = count; stack.push(j); } }); }
    count++;
  }
  return { id, count };
}

const ANGLES = 16;

/** Draw a plan. Deterministic in its inputs. */
export function drawPlan(r: PlanRegion, opts: PlanOptions, graph = buGraph(r)): PlanResult {
  const n = r.x.length, D = opts.sizes.length;
  const district = new Int32Array(n).fill(-1);
  const total = r.pop.reduce((a, b) => a + b, 0);
  const sizeSum = opts.sizes.reduce((a, b) => a + b, 0);
  const ideal = opts.sizes.map((s) => (total * s) / sizeSum);
  const all = Array.from({ length: n }, (_, i) => i);
  POP_REF = r.pop;
  if (opts.nest) {
    // Nested plans: split each enclosing district into its own districts.
    const parents = new Map<number, number[]>(); opts.nest.parentOf.forEach((p, d) => { const a = parents.get(p) ?? []; a.push(d); parents.set(p, a); });
    for (const [p, ds] of parents) bisect(r, graph, all.filter((i) => opts.nest!.within[i] === p), ds, opts.sizes, district);
  } else bisect(r, graph, all, Array.from({ length: D }, (_, d) => d), opts.sizes, district);
  for (let i = 0; i < n; i++) if (district[i]! < 0) district[i] = 0;
  const moves = repair(r, graph, district, ideal, opts.tolerance, opts.nest?.within ?? null);
  return { district, stats: planStats(r, graph, district, ideal, moves) };
}

function bisect(r: PlanRegion, g: Graph, items: number[], ds: number[], sizes: number[], out: Int32Array): void {
  if (ds.length === 1 || items.length <= 1) { for (const i of items) out[i] = ds[0]!; return; }
  const k1 = Math.floor(ds.length / 2);
  const left = ds.slice(0, k1), right = ds.slice(k1);
  const wl = left.reduce((a, d) => a + sizes[d]!, 0), wr = right.reduce((a, d) => a + sizes[d]!, 0);
  let tot = 0; for (const i of items) tot += r.pop[i]!;
  const target = (tot * wl) / (wl + wr);
  const whole = inertia(r, items, 0, items.length);
  let best: { score: number; order: number[]; cut: number } | null = null;
  const proj = new Float64Array(r.x.length);
  const consider = (order: number[], cut: number) => {
    cut = Math.max(1, Math.min(order.length - 1, cut));
    const stray = strayPop(g, order, cut) / (tot || 1);
    const score = (inertia(r, order, 0, cut) + inertia(r, order, cut, order.length)) / (whole || 1) + 0.04 * splitCounties(r, order, cut) / Math.max(1, ds.length) + 25 * stray;
    if (!best || score < best.score) best = { score, order, cut };
  };
  const cutAt = (order: number[]) => {
    let cum = 0, cut = 0;
    for (; cut < order.length - 1; cut++) { const nx = cum + r.pop[order[cut]!]!; if (nx > target) { if (nx - target < target - cum) cut++; break; } cum = nx; }
    return cut;
  };
  for (let a = 0; a < ANGLES; a++) {
    const th = (Math.PI * a) / ANGLES, c = Math.cos(th), s = Math.sin(th);
    for (const i of items) proj[i] = r.x[i]! * c + r.y[i]! * s;
    // (a) A straight cut through BUs.
    const order = [...items].sort((p, q) => proj[p]! - proj[q]! || p - q);
    consider(order, cutAt(order));
    // (b) A cut along county lines: whole counties in order of their centroid, splitting only the county the target falls in.
    const cy = new Map<number, { w: number; m: number; bus: number[] }>();
    for (const i of items) { const k = r.county[i]!; const e = cy.get(k) ?? { w: 0, m: 0, bus: [] }; const w = r.pop[i]! + 1; e.w += w; e.m += w * proj[i]!; e.bus.push(i); cy.set(k, e); }
    const counties = [...cy].sort((x, y) => x[1].m / x[1].w - y[1].m / y[1].w || x[0] - y[0]);
    const byCounty: number[] = [];
    for (const [, e] of counties) byCounty.push(...e.bus.sort((p, q) => proj[p]! - proj[q]! || p - q));
    consider(byCounty, cutAt(byCounty));
  }
  const b = best!;
  bisect(r, g, b.order.slice(0, b.cut), left, sizes, out);
  bisect(r, g, b.order.slice(b.cut), right, sizes, out);
}

type Graph = { off: Int32Array; nbr: Int32Array };

/** Population outside the largest connected piece of each side of a cut. */
function strayPop(g: Graph, order: number[], cut: number): number {
  const n = g.off.length - 1;
  if (!MARK || MARK.length < n) { MARK = new Int32Array(n); SEEN = new Int32Array(n); }
  let stray = 0;
  for (const [a, b] of [[0, cut], [cut, order.length]] as const) {
    const side = ++STAMP; for (let j = a; j < b; j++) MARK[order[j]!] = side;
    const seen = ++STAMP; let total = 0, largest = 0;
    const stack: number[] = [];
    for (let j = a; j < b; j++) {
      const s0 = order[j]!; if (SEEN![s0] === seen) continue;
      let sz = 0; stack.push(s0); SEEN![s0] = seen;
      while (stack.length) { const i = stack.pop()!; sz += POP_REF![i]! + 1; for (let p = g.off[i]!; p < g.off[i + 1]!; p++) { const k = g.nbr[p]!; if (MARK[k] === side && SEEN![k] !== seen) { SEEN![k] = seen; stack.push(k); } } }
      total += sz; largest = Math.max(largest, sz);
    }
    stray += total - largest;
  }
  return stray;
}
let MARK: Int32Array | null = null, SEEN: Int32Array | null = null, STAMP = 0;
let POP_REF: Float64Array | null = null;

function inertia(r: PlanRegion, order: number[], a: number, b: number): number {
  let w = 0, mx = 0, my = 0;
  for (let j = a; j < b; j++) { const i = order[j]!, p = r.pop[i]! + 1; w += p; mx += p * r.x[i]!; my += p * r.y[i]!; }
  if (w <= 0) return 0; mx /= w; my /= w;
  let s = 0; for (let j = a; j < b; j++) { const i = order[j]!, p = r.pop[i]! + 1; s += p * ((r.x[i]! - mx) ** 2 + (r.y[i]! - my) ** 2); }
  return s;
}

function splitCounties(r: PlanRegion, order: number[], cut: number): number {
  const L = new Set<number>(), R = new Set<number>();
  for (let j = 0; j < order.length; j++) (j < cut ? L : R).add(r.county[order[j]!]!);
  let n = 0; for (const c of L) if (R.has(c)) n++;
  return n;
}

/** Make every district contiguous, then rebalance populations by moving boundary BUs. Returns the number of moves. */
function repair(r: PlanRegion, g: { off: Int32Array; nbr: Int32Array }, district: Int32Array, ideal: number[], tol: number, within: Int32Array | null): number {
  const n = district.length, D = ideal.length;
  const pop = new Float64Array(D); for (let i = 0; i < n; i++) pop[district[i]!]! += r.pop[i]!;
  const sameParent = (i: number, j: number) => !within || within[i] === within[j];
  // Contiguity: fragments join the neighbour they touch most.
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let d = 0; d < D; d++) {
      const comp = components(n, (i, f) => { for (let p = g.off[i]!; p < g.off[i + 1]!; p++) f(g.nbr[p]!); }, (i) => district[i] === d);
      if (comp.count <= 1) continue;
      const size = new Array<number>(comp.count).fill(0); for (let i = 0; i < n; i++) if (comp.id[i]! >= 0) size[comp.id[i]!]! += r.pop[i]! + 1;
      const keep = size.indexOf(Math.max(...size));
      for (let c = 0; c < comp.count; c++) {
        if (c === keep) continue;
        // A large fragment stays (the district is reported non-contiguous): moving it would break population balance.
        if (size[c]! > 0.35 * ideal[d]!) continue;
        const touch = new Map<number, number>();
        for (let i = 0; i < n; i++) if (comp.id[i] === c) for (let p = g.off[i]!; p < g.off[i + 1]!; p++) { const e = district[g.nbr[p]!]!; if (e !== d && sameParent(i, g.nbr[p]!)) touch.set(e, (touch.get(e) ?? 0) + 1); }
        if (!touch.size) continue;
        const to = [...touch].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
        for (let i = 0; i < n; i++) if (comp.id[i] === c) { district[i] = to; pop[d]! -= r.pop[i]!; pop[to]! += r.pop[i]!; }
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Rebalancing: the worst district trades boundary BUs with its neighbours (members are tracked per district).
  let moves = 0;
  const dev = (d: number) => (pop[d]! - ideal[d]!) / ideal[d]!;
  // Squared deviations: surplus flows downhill through neighbouring districts, so it can reach a deficit
  // several districts away even when the districts in between are within tolerance.
  const moveGain = (from: number, to: number, x: number) => {
    const a = dev(from), b = dev(to), a2 = (pop[from]! - x - ideal[from]!) / ideal[from]!, b2 = (pop[to]! + x - ideal[to]!) / ideal[to]!;
    return a * a + b * b - a2 * a2 - b2 * b2;
  };
  const members: Set<number>[] = Array.from({ length: D }, () => new Set());
  for (let i = 0; i < n; i++) members[district[i]!]!.add(i);
  const seen = new Int32Array(n); let stamp = 0;
  const connectedWithout = (d: number, skip: number): boolean => {
    const m = members[d]!; if (m.size <= 1) return false;
    let start = -1; for (const i of m) if (i !== skip) { start = i; break; }
    const st = ++stamp; seen[start] = st; const stack = [start]; let reached = 1;
    while (stack.length) { const i = stack.pop()!; for (let p = g.off[i]!; p < g.off[i + 1]!; p++) { const j = g.nbr[p]!; if (seen[j] !== st && j !== skip && district[j] === d) { seen[j] = st; reached++; stack.push(j); } } }
    return reached === m.size - 1;
  };
  const move = (i: number, to: number) => { const from = district[i]!; members[from]!.delete(i); members[to]!.add(i); district[i] = to; pop[from]! -= r.pop[i]!; pop[to]! += r.pop[i]!; moves++; };
  const stuck = new Set<number>();
  for (let iter = 0; iter < 60 * D + 2000; iter++) {
    let worst = -1, wv = tol;
    for (let d = 0; d < D; d++) { if (stuck.has(d)) continue; const v = Math.abs(dev(d)); if (v > wv) { wv = v; worst = d; } }
    if (worst < 0) break;
    const over = dev(worst) > 0;
    // Candidates: (over) a member of `worst` moving to a neighbouring district; (under) a neighbour's BU moving in.
    const cands: { i: number; from: number; to: number; gain: number }[] = [];
    for (const i of members[worst]!) {
      for (let p = g.off[i]!; p < g.off[i + 1]!; p++) {
        const j = g.nbr[p]!, dj = district[j]!;
        if (dj === worst || !sameParent(i, j)) continue;
        const c = over ? { i, from: worst, to: dj } : { i: j, from: dj, to: worst };
        const gain = moveGain(c.from, c.to, r.pop[c.i]!);
        if (gain > 1e-14) cands.push({ ...c, gain });
      }
    }
    cands.sort((a, b) => b.gain - a.gain || a.i - b.i);
    let moved = false;
    const tried = new Set<number>();
    for (const c of cands) {
      if (tried.has(c.i)) continue; tried.add(c.i);
      if (tried.size > 40) break;
      if (connectedWithout(c.from, c.i)) { move(c.i, c.to); moved = true; break; }
    }
    if (!moved) { stuck.add(worst); if (stuck.size >= D) break; } else stuck.clear();
  }
  return moves;
}

/** Population, deviation, contiguity, county splits and compactness of a plan. */
export function planStats(r: PlanRegion, g: { off: Int32Array; nbr: Int32Array }, district: Int32Array, ideal: number[], moves = 0): PlanStats {
  const n = district.length, D = ideal.length;
  const populations = new Array<number>(D).fill(0);
  for (let i = 0; i < n; i++) populations[district[i]!]! += r.pop[i]!;
  let maxDeviation = 0; for (let d = 0; d < D; d++) maxDeviation = Math.max(maxDeviation, Math.abs(populations[d]! / ideal[d]! - 1));
  let contiguous = true;
  for (let d = 0; d < D && contiguous; d++) if (components(n, (i, f) => { for (let p = g.off[i]!; p < g.off[i + 1]!; p++) f(g.nbr[p]!); }, (i) => district[i] === d).count > 1) contiguous = false;
  const countyDistricts = new Map<number, Set<number>>();
  for (let i = 0; i < n; i++) { const s = countyDistricts.get(r.county[i]!) ?? new Set(); s.add(district[i]!); countyDistricts.set(r.county[i]!, s); }
  let countiesSplit = 0; for (const s of countyDistricts.values()) if (s.size > 1) countiesSplit++;
  // Compactness: an equal-area disc's mean distance to its centre (2/3 of its radius) over the district's
  // area-weighted mean distance of BU centroids to the district centroid (1 = a disc; long, thin districts → 0.3).
  const compactness = Array.from({ length: D }, (_, d) => {
    let A = 0, mx = 0, my = 0;
    for (let i = 0; i < n; i++) if (district[i] === d) { const a = r.area[i]! + 1; A += a; mx += a * r.x[i]!; my += a * r.y[i]!; }
    if (A <= 0) return 0; mx /= A; my /= A;
    let s = 0; for (let i = 0; i < n; i++) if (district[i] === d) { const a = r.area[i]! + 1; s += a * Math.hypot(r.x[i]! - mx, r.y[i]! - my); }
    const mean = s / A, disc = (2 / 3) * Math.sqrt((A * r.unitsPerMeter ** 2) / Math.PI);
    return mean > 0 ? Math.min(1.5, disc / mean) : 1;
  });
  return { populations, ideal, maxDeviation, contiguous, countiesSplit, compactness, moves };
}
