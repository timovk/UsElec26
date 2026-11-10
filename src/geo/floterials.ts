/**
 * New Hampshire's floterial districts (Phase 7.4), generated the way the state builds them.
 *
 * The House has 400 seats. Each ordinary district (a town or group of towns) gets the whole seats its population
 * earns. The fractions left over in neighbouring districts of the same county are pooled into a floterial
 * district: it overlaps them, and their voters elect its seat(s) as well as their own. The Census files hold the
 * ordinary districts only (districts cannot overlap there), so the floterials and their boundaries are simulated,
 * like the board districts of Phase 7.2; their numbers continue the county's (Belknap 1–6, then floterial 7…).
 *
 * Pure function of the districts' populations and centroids.
 */

export interface FloterialInput { label: string; pop: number; x: number; y: number }
export interface Floterial { members: number[]; seats: number; label: string }
export interface FloterialPlan { baseSeats: number[]; floterials: Floterial[] }

/** A district's county name ("Belknap 3" → "Belknap"), or '' when districts are not named by county. */
export const countyOfLabel = (label: string): string => (/^(.*\D)\s*\d+$/.exec(label)?.[1]?.trim() ?? '');

/**
 * Whole seats per ordinary district and the floterials pooling the leftovers, for a chamber of `seats` members.
 * A district keeps the whole seats of its quota (rounded up from x.85); leftovers of at least 0.25 seat are
 * pooled with the nearest such districts of the county until they make a seat (at most four districts), and a
 * leftover of half a seat that finds no partner rounds up.
 */
export function planFloterials(ds: readonly FloterialInput[], seats: number): FloterialPlan {
  const n = ds.length;
  if (!n) return { baseSeats: [], floterials: [] };
  const pop = ds.map((d) => (Number.isFinite(d.pop) && d.pop > 0 ? d.pop : 1));
  const total = pop.reduce((a, b) => a + b, 0);
  const ideal = total / seats;
  const quota = pop.map((p) => p / ideal);
  const base = quota.map((q) => Math.max(1, Math.floor(q + 0.15)));
  const left = quota.map((q, i) => q - base[i]!);
  // Pool leftovers county by county, nearest first.
  const byCounty = new Map<string, number[]>();
  ds.forEach((d, i) => { const c = countyOfLabel(d.label); const l = byCounty.get(c); if (l) l.push(i); else byCounty.set(c, [i]); });
  const floterials: Floterial[] = [];
  const used = new Set<number>();
  for (const [county, idx] of byCounty) {
    const cand = idx.filter((i) => left[i]! >= 0.25).sort((a, b) => left[b]! - left[a]! || a - b);
    let nextNumber = Math.max(0, ...idx.map((i) => Number(/(\d+)$/.exec(ds[i]!.label)?.[1] ?? 0)));
    for (const seed of cand) {
      if (used.has(seed)) continue;
      const group = [seed]; let sum = left[seed]!;
      while (sum < 0.8 && group.length < 4) {
        let best = -1, bd = Infinity;
        for (const j of cand) {
          if (used.has(j) || group.includes(j)) continue;
          const d2 = Math.min(...group.map((g) => (ds[g]!.x - ds[j]!.x) ** 2 + (ds[g]!.y - ds[j]!.y) ** 2));
          if (d2 < bd) { bd = d2; best = j; }
        }
        if (best < 0) break;
        group.push(best); sum += left[best]!;
      }
      if (sum < 0.6 || group.length < 2) continue;
      for (const g of group) used.add(g);
      nextNumber++;
      floterials.push({ members: [...group].sort((a, b) => a - b), seats: Math.max(1, Math.round(sum)), label: county ? `${county} ${nextNumber}` : String(nextNumber) });
    }
  }
  // Leftovers left over join the county's nearest floterial (up to five districts), whose seats grow to match.
  const dist2 = (i: number, j: number) => (ds[i]!.x - ds[j]!.x) ** 2 + (ds[i]!.y - ds[j]!.y) ** 2;
  for (let i = 0; i < n; i++) {
    if (used.has(i) || left[i]! < 0.25) continue;
    const c = countyOfLabel(ds[i]!.label);
    let best: Floterial | null = null, bd = Infinity;
    for (const f of floterials) {
      if (f.members.length >= 5 || countyOfLabel(ds[f.members[0]!]!.label) !== c) continue;
      const d2 = Math.min(...f.members.map((m) => dist2(i, m)));
      if (d2 < bd) { bd = d2; best = f; }
    }
    if (!best) continue;
    best.members = [...best.members, i].sort((a, b) => a - b); used.add(i);
    best.seats = Math.max(1, Math.round(best.members.reduce((a, m) => a + left[m]!, 0)));
  }
  // A leftover of half a seat that found no partner earns the district a whole seat.
  for (let i = 0; i < n; i++) if (!used.has(i) && left[i]! >= 0.5) base[i]!++;
  // The chamber's size: settle the difference on the districts most under- (or over-) represented.
  const repOf = (i: number) => {
    let r = base[i]!;
    for (const f of floterials) if (f.members.includes(i)) { const fp = f.members.reduce((a, m) => a + pop[m]!, 0); r += f.seats * pop[i]! / fp; }
    return r;
  };
  let sum = base.reduce((a, b) => a + b, 0) + floterials.reduce((a, f) => a + f.seats, 0);
  for (let guard = 0; sum !== seats && guard < 4 * n; guard++) {
    const gap = quota.map((q, i) => q - repOf(i));
    if (sum < seats) { let k = 0; for (let i = 1; i < n; i++) if (gap[i]! > gap[k]!) k = i; base[k]!++; sum++; }
    else { let k = -1; for (let i = 0; i < n; i++) if (base[i]! > 1 && (k < 0 || gap[i]! < gap[k]!)) k = i; if (k < 0) break; base[k]!--; sum--; }
  }
  return { baseSeats: base, floterials };
}
