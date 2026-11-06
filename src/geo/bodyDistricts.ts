/**
 * Districts of elected boards, commissions and district-elected courts (Phase 7.2). The real lines (Texas's 15
 * State Board of Education districts, Louisiana's five Public Service Commission districts…) are not in the
 * geography pack, so the simulation draws them: a state's building blocks — its state house districts of the
 * year, or counties, or Base Units where those are too few — are grouped into compact districts of nearly equal
 * population (in proportion to each district's seats). Grouping is a capacitated nearest-centre assignment,
 * refined a few times; deterministic, with ties broken by index. Districts are compact but not guaranteed to be
 * contiguous.
 */

export interface ComposeInput {
  /** Building block of each unit (−1: none), unit coordinates (projected) and population. */
  block: Int32Array; x: ArrayLike<number>; y: ArrayLike<number>; pop: ArrayLike<number>;
}

/** District (1-based) of every unit, or 0 for units without population; `sizes[d]` is district d+1's share of seats. */
export function composeDistricts(inp: ComposeInput, sizes: number[]): Uint16Array {
  const n = inp.block.length, N = sizes.length;
  const out = new Uint16Array(n);
  if (N <= 1) { for (let i = 0; i < n; i++) out[i] = 1; return out; }
  // Blocks: population and centroid. Too few blocks for the districts: the units themselves are the blocks.
  let nb = 0; for (let i = 0; i < n; i++) if (inp.block[i]! + 1 > nb) nb = inp.block[i]! + 1;
  const ids = new Int32Array(n);
  const used = new Set<number>(); for (let i = 0; i < n; i++) if (inp.block[i]! >= 0 && inp.pop[i]! > 0) used.add(inp.block[i]!);
  const asUnits = used.size < 2 * N;
  for (let i = 0; i < n; i++) ids[i] = asUnits ? i : inp.block[i]!;
  const B = asUnits ? n : nb;
  const bp = new Float64Array(B), bx = new Float64Array(B), by = new Float64Array(B);
  for (let i = 0; i < n; i++) {
    const b = ids[i]!; if (b < 0) continue;
    const p = inp.pop[i]!; if (!(p > 0)) continue;
    bp[b]! += p; bx[b]! += p * inp.x[i]!; by[b]! += p * inp.y[i]!;
  }
  const blocks: number[] = [];
  for (let b = 0; b < B; b++) if (bp[b]! > 0) { bx[b]! /= bp[b]!; by[b]! /= bp[b]!; blocks.push(b); }
  if (!blocks.length) { for (let i = 0; i < n; i++) out[i] = 1; return out; }
  const total = blocks.reduce((a, b) => a + bp[b]!, 0), seatSum = sizes.reduce((a, s) => a + s, 0);
  const target = sizes.map((s) => (total * s) / seatSum);
  const d2 = (b: number, cx: number, cy: number) => (bx[b]! - cx) ** 2 + (by[b]! - cy) ** 2;

  // Seeds: the largest district at the most populous block, the others by farthest-point sampling.
  const cx = new Float64Array(N), cy = new Float64Array(N);
  const order = sizes.map((s, d) => ({ s, d })).sort((a, b) => b.s - a.s || a.d - b.d).map((x) => x.d);
  let first = blocks[0]!; for (const b of blocks) if (bp[b]! > bp[first]!) first = b;
  cx[order[0]!] = bx[first]!; cy[order[0]!] = by[first]!;
  const minD = new Float64Array(B).fill(Infinity);
  for (let k = 1; k < N; k++) {
    const prev = order[k - 1]!;
    let best = -1, bestV = -1;
    for (const b of blocks) {
      const v = d2(b, cx[prev]!, cy[prev]!); if (v < minD[b]!) minD[b] = v;
      const score = minD[b]! * Math.sqrt(bp[b]!);
      if (score > bestV) { bestV = score; best = b; }
    }
    cx[order[k]!] = bx[best]!; cy[order[k]!] = by[best]!;
  }

  // Capacitated assignment: blocks in order of regret (how much worse their second-best centre is), each to the
  // nearest centre with room; then centres move to their districts' centroids.
  const assign = new Int32Array(B).fill(-1);
  for (let iter = 0; iter < 8; iter++) {
    const load = new Float64Array(N);
    const ranked = blocks.map((b) => {
      let a = Infinity, c = Infinity;
      for (let d = 0; d < N; d++) { const v = d2(b, cx[d]!, cy[d]!); if (v < a) { c = a; a = v; } else if (v < c) c = v; }
      return { b, regret: c - a };
    }).sort((p, q) => q.regret - p.regret || p.b - q.b);
    for (const { b } of ranked) {
      let best = -1, bestV = Infinity;
      for (let d = 0; d < N; d++) {
        const v = d2(b, cx[d]!, cy[d]!);
        if (load[d]! + bp[b]! <= target[d]! * 1.06 && v < bestV) { bestV = v; best = d; }
      }
      if (best < 0) { // no room anywhere: the least-loaded district relative to its target
        let r = Infinity; for (let d = 0; d < N; d++) { const f = load[d]! / target[d]!; if (f < r) { r = f; best = d; } }
      }
      assign[b] = best; load[best]! += bp[b]!;
    }
    const sx = new Float64Array(N), sy = new Float64Array(N), sp = new Float64Array(N);
    for (const b of blocks) { const d = assign[b]!; sx[d]! += bx[b]! * bp[b]!; sy[d]! += by[b]! * bp[b]!; sp[d]! += bp[b]!; }
    for (let d = 0; d < N; d++) if (sp[d]! > 0) { cx[d] = sx[d]! / sp[d]!; cy[d] = sy[d]! / sp[d]!; }
  }
  // Every unit: its block's district; units without a populated block go to the nearest centre.
  for (let i = 0; i < n; i++) {
    const b = ids[i]!;
    if (b >= 0 && assign[b]! >= 0) { out[i] = assign[b]! + 1; continue; }
    let best = 0, bestV = Infinity;
    for (let d = 0; d < N; d++) { const v = (inp.x[i]! - cx[d]!) ** 2 + (inp.y[i]! - cy[d]!) ** 2; if (v < bestV) { bestV = v; best = d; } }
    out[i] = best + 1;
  }
  return out;
}
