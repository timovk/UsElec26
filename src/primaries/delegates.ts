/**
 * Delegate allocation (docs/architecture/02 §2.2, module `primaries`): pure functions from a state's results
 * to pledged delegates under the 2016 rules of each party (src/rules/primaries2016.ts).
 */
import type { Allocation } from '../rules/primaries2016';

/** Largest-remainder (Hamilton) apportionment of `seats` among `votes` (only entries with weight > 0 share). */
export function hamilton(seats: number, votes: readonly number[]): number[] {
  const out = votes.map(() => 0); const tot = votes.reduce((a, b) => a + Math.max(0, b), 0);
  if (seats <= 0 || tot <= 0) return out;
  const quota = votes.map((v) => (Math.max(0, v) * seats) / tot);
  let given = 0;
  quota.forEach((q, i) => { out[i] = Math.floor(q); given += out[i]!; });
  const rest = quota.map((q, i) => ({ i, r: q - Math.floor(q) })).sort((a, b) => b.r - a.r || votes[b.i]! - votes[a.i]! || a.i - b.i);
  for (let k = 0; given < seats && k < rest.length; k++) { out[rest[k]!.i]! += 1; given++; }
  return out;
}

/** Proportional with a threshold: candidates below it get nothing; if nobody clears it, everyone shares. */
export function proportional(seats: number, votes: readonly number[], threshold: number): number[] {
  const tot = votes.reduce((a, b) => a + b, 0);
  if (tot <= 0) return votes.map(() => 0);
  const elig = votes.map((v) => (v / tot >= threshold ? v : 0));
  return hamilton(seats, elig.some((v) => v > 0) ? elig : votes);
}

const winner = (votes: readonly number[]) => { let w = 0; votes.forEach((v, i) => { if (v > votes[w]!) w = i; }); return w; };

export interface StateResult { statewide: readonly number[]; byDistrict: readonly (readonly number[])[] }
export interface Allocated { pledged: number[]; unbound: number }

/** Democratic rule: about two thirds of the delegates by district (equal shares per district), the rest statewide; 15% thresholds at each level. */
export function allocateDemocratic(delegates: number, res: StateResult, threshold = 0.15): Allocated {
  const nCd = Math.max(1, res.byDistrict.length);
  const district = res.byDistrict.length > 1 ? Math.round((delegates * 2) / 3) : 0;
  const pledged = res.statewide.map(() => 0);
  if (district > 0) {
    const per = hamilton(district, new Array<number>(nCd).fill(1));
    res.byDistrict.forEach((v, i) => proportional(per[i]!, v, threshold).forEach((x, j) => { pledged[j]! += x; }));
  }
  proportional(delegates - district, res.statewide, threshold).forEach((x, j) => { pledged[j]! += x; });
  return { pledged, unbound: 0 };
}

/** Republican rules: proportional (with optional winner-take-all trigger and district allocation), winner-take-all, winner-take-all by district, or unbound. */
export function allocateRepublican(delegates: number, a: Allocation, res: StateResult): Allocated {
  const n = res.statewide.length, pledged = new Array<number>(n).fill(0);
  const tot = res.statewide.reduce((x, y) => x + y, 0);
  const unbound = a.rule === 'unbound' ? delegates : a.unbound ?? 0;
  const bound = delegates - unbound;
  if (bound <= 0 || tot <= 0 || n === 0) return { pledged, unbound: delegates };
  const w = winner(res.statewide);
  const nCd = res.byDistrict.length;
  const cdSeats = (a.rule === 'wta_cd' || a.byDistrict) && nCd > 0 ? Math.min(bound - 3, 3 * nCd) : 0;
  if (a.rule === 'wta' || (a.wtaAbove !== undefined && res.statewide[w]! / tot > a.wtaAbove)) { pledged[w] = bound; return { pledged, unbound }; }
  const atLarge = bound - Math.max(0, cdSeats);
  if (a.rule === 'wta_cd') {
    pledged[w]! += atLarge;
    res.byDistrict.forEach((v) => { if (v.reduce((x, y) => x + y, 0) > 0) pledged[winner(v)]! += 3; else pledged[w]! += 3; });
    return { pledged, unbound };
  }
  // Proportional statewide (at-large), districts 3 each: 3 to a majority winner, else 2 to the winner and 1 to the runner-up.
  proportional(atLarge, res.statewide, a.threshold).forEach((x, j) => { pledged[j]! += x; });
  if (cdSeats > 0) res.byDistrict.forEach((v) => {
    const dt = v.reduce((x, y) => x + y, 0); if (dt <= 0) { pledged[w]! += 3; return; }
    const order = v.map((x, i) => ({ x, i })).sort((p, q) => q.x - p.x || p.i - q.i);
    if (order[0]!.x / dt > (a.wtaAbove ?? 0.5) || order.length < 2) pledged[order[0]!.i]! += 3;
    else { pledged[order[0]!.i]! += 2; pledged[order[1]!.i]! += 1; }
  });
  return { pledged, unbound };
}

/** The majority needed for the nomination. */
export const needed = (total: number) => Math.floor(total / 2) + 1;
