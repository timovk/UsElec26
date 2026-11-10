/**
 * State legislative districts as each state's law stood on January 1, 2016 (Phase 7.4): how many members each
 * district elects, how they are elected, and how districts are numbered and named.
 *
 * - **Single-member districts** everywhere except the chambers below.
 * - **"Vote for N" districts** (one race per district; each voter marks up to N names; the top N win):
 *   Arizona's, New Jersey's and North Dakota's two-member house districts; South Dakota's (two members, except
 *   districts 26 and 28, split into single-member halves); Maryland's three-delegate districts, some split into
 *   subdistricts of one or two; Vermont's house (one or two members) and senate (one to six, by county);
 *   West Virginia's house (one to five); New Hampshire's house (one to eleven, plus floterial districts that
 *   overlap the ordinary ones).
 * - **Numbered positions** (two separate races per district): Washington (Position 1 and 2) and Idaho (Seat A and
 *   B).
 * - **Staggered seats**: West Virginia's senate districts have two members elected in alternate cycles.
 *
 * Seat counts: fixed per district where the law fixes them; where the state apportions seats by population
 * (Vermont, West Virginia, New Hampshire, Maryland's subdistricts) they are derived from 2010 population by
 * rounding to the nearest whole seat (Webster's divisor method), which reproduces the 2012 plans. The Census
 * files hold the districts but not their seat counts.
 */

export type SeatMode = 'single' | 'block' | 'posts' | 'staggered';
export type LegChamber = 'upper' | 'lower';

export interface ChamberSeatRule {
  mode: Exclude<SeatMode, 'single'>;
  /** Members per numbered district, shared among its lettered subdistricts by population (Maryland, South Dakota). */
  perNumber?: number;
  /** Seats apportioned to districts by population. */
  byPopulation?: boolean;
  /** New Hampshire: floterial districts take the seats left over after the ordinary districts' whole seats. */
  floterials?: boolean;
  /** Names of numbered positions (Washington, Idaho). */
  postLabels?: readonly string[];
}

export const SEAT_RULES_2016: Record<string, Partial<Record<LegChamber, ChamberSeatRule>>> = {
  AZ: { lower: { mode: 'block', perNumber: 2 } },
  NJ: { lower: { mode: 'block', perNumber: 2 } },
  ND: { lower: { mode: 'block', perNumber: 2 } },
  SD: { lower: { mode: 'block', perNumber: 2 } },
  MD: { lower: { mode: 'block', perNumber: 3 } },
  VT: { lower: { mode: 'block', byPopulation: true }, upper: { mode: 'block', byPopulation: true } },
  WV: { lower: { mode: 'block', byPopulation: true }, upper: { mode: 'staggered', perNumber: 2 } },
  NH: { lower: { mode: 'block', byPopulation: true, floterials: true } },
  WA: { lower: { mode: 'posts', perNumber: 2, postLabels: ['Position 1', 'Position 2'] } },
  ID: { lower: { mode: 'posts', perNumber: 2, postLabels: ['Seat A', 'Seat B'] } },
};

export interface DistrictKey { code?: string; name?: string; idx: number; pop2010: number }

const NUMERIC = /^0*(\d+)$/;
const SUBDISTRICT = /^0*(\d+)([A-Z])$/;

/** The legislative district number a code belongs to (Maryland's 1A, 1B and 1C are parts of district 1), or null. */
export function districtNumberPart(code: string | undefined): number | null {
  if (!code) return null;
  const m = NUMERIC.exec(code) ?? SUBDISTRICT.exec(code);
  return m ? Number(m[1]) : null;
}

/** A district's display name: its number ("12", "1A", "A") or, where the state names its districts, the name. */
export function districtLabelOf(d: DistrictKey): string {
  const name = d.name?.trim() ?? '', code = d.code?.trim() ?? '';
  // Named districts: Massachusetts ("1st Barnstable"), New Hampshire ("Belknap County No. 1" → "Belknap 1"), Vermont ("Addison-1").
  if (name && !/^(District\s+)?0*\d+[A-Z]?$/i.test(name) && !/^[A-Z]{1,2}D-\d+$/.test(name) && !/^[A-Z]$/.test(name)) return name.replace(/ County No\. (\d+)$/, ' $1');
  if (/^[A-Z]$/.test(name)) return name; // Alaska's senate districts A–T
  if (code) { const m = SUBDISTRICT.exec(code) ?? NUMERIC.exec(code); if (m) return Number(m[1]) === 0 && m[2] ? m[2] : `${Number(m[1])}${m[2] ?? ''}`; return code.replace(/^0+(?=[A-Z])/, ''); }
  return name || String(d.idx);
}

/** How a district is written in an office title: "District 12", "District 1A", or the district's name. */
export function districtWord(label: string): string {
  return /^\d+[A-Z]?$/.test(label) || /^[A-Z]$/.test(label) ? `District ${label}` : label;
}

/**
 * Each district's number, unique within the state's chamber. Purely numeric codes keep their number; otherwise
 * (letters, subdistricts, names) districts are numbered 1, 2, … in order of their number part and code, so
 * Minnesota's 1A, 1B, 2A, … are 1, 2, 3, … and Alaska's senate districts A–T are 1–20.
 */
export function districtNumbers(ds: readonly DistrictKey[]): number[] {
  const nums = ds.map((d) => { const m = NUMERIC.exec(d.code ?? ''); return m ? Number(m[1]) : null; });
  if (nums.every((n) => n !== null) && new Set(nums).size === nums.length) return nums as number[];
  const key = (d: DistrictKey) => { const p = districtNumberPart(d.code); return [p ?? Number.MAX_SAFE_INTEGER, d.code ?? d.name ?? '', d.idx] as const; };
  const order = ds.map((d, i) => ({ i, k: key(d) })).sort((a, b) => a.k[0] - b.k[0] || (a.k[1] < b.k[1] ? -1 : a.k[1] > b.k[1] ? 1 : 0) || a.k[2] - b.k[2]);
  const out = new Array<number>(ds.length);
  order.forEach((x, rank) => { out[x.i] = rank + 1; });
  return out;
}

/** Webster's (Sainte-Laguë) divisor method: whole seats proportional to population, at least `min` each, summing to `seats`. */
export function websterSeats(pops: readonly number[], seats: number, min = 1): number[] {
  const p = pops.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  if (!p.length) return [];
  if (seats <= p.length * min) return p.map(() => min);
  const total = p.reduce((a, b) => a + b, 0);
  const alloc = (d: number) => p.map((x) => Math.max(min, Math.round(x / d)));
  let lo = total / (seats * 4), hi = total / Math.max(1, seats - p.length * min) * 4;
  let best = alloc(total / seats);
  for (let it = 0; it < 80; it++) {
    const d = (lo + hi) / 2, a = alloc(d), s = a.reduce((x, y) => x + y, 0);
    best = a;
    if (s === seats) return a;
    if (s > seats) lo = d; else hi = d;
  }
  // Ties at a rounding boundary: settle the last seats by the largest (or smallest) remainders.
  let s = best.reduce((x, y) => x + y, 0);
  const d = total / seats;
  const order = p.map((x, i) => ({ i, r: x / d - best[i]! })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; s < seats; k = (k + 1) % order.length) { best[order[k]!.i]!++; s++; }
  for (let k = order.length - 1; s > seats; k = (k - 1 + order.length) % order.length) { const i = order[k]!.i; if (best[i]! > min) { best[i]!--; s--; } }
  return best;
}

/** Largest-remainder shares of `seats` by population, at least one each (the fallback for geographies that are not the real 2016 one). */
export function largestRemainderSeats(pops: readonly number[], seats: number): number[] {
  const p = pops.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  const total = p.reduce((a, b) => a + b, 0) || 1;
  const quota = p.map((x) => (seats * x) / total);
  const alloc = quota.map((q) => Math.max(1, Math.floor(q)));
  let left = seats - alloc.reduce((a, b) => a + b, 0);
  const order = quota.map((q, i) => ({ i, rem: q - Math.floor(q) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length * 4; k++) { alloc[order[k % order.length]!.i]!++; left--; }
  while (left < 0) { const i = alloc.indexOf(Math.max(...alloc)); alloc[i]!--; left++; }
  return alloc;
}

/** The seat rule of a state's chamber (null: single-member districts). */
export function seatRule(usps: string, chamber: LegChamber): ChamberSeatRule | null {
  return SEAT_RULES_2016[usps]?.[chamber] ?? null;
}

/**
 * Members per district for a chamber of `seats` members over these districts (the 2016 districts, or a later
 * plan's). Where the districts are not the state's real ones (a synthetic geography, or a seat total that no
 * longer fits the rule), seats are shared by population, as Phase 6 did.
 */
export function seatsPerDistrict(usps: string, chamber: LegChamber, ds: readonly DistrictKey[], seats: number): { seats: number[]; mode: SeatMode } {
  const rule = seatRule(usps, chamber);
  if (!ds.length) return { seats: [], mode: 'single' };
  // More districts than seats (only in synthetic geographies): the most populous districts get the seats.
  if (seats < ds.length) {
    const top = new Set(ds.map((d, i) => ({ i, p: d.pop2010 })).sort((a, b) => b.p - a.p || a.i - b.i).slice(0, seats).map((x) => x.i));
    return { seats: ds.map((_, i) => (top.has(i) ? 1 : 0)), mode: 'single' };
  }
  if (!rule) {
    if (seats === ds.length) return { seats: ds.map(() => 1), mode: 'single' };
    // More seats than districts (only in synthetic geographies): numbered posts, as Phase 6 elected them.
    return { seats: largestRemainderSeats(ds.map((d) => d.pop2010), seats), mode: 'posts' };
  }
  if (rule.perNumber) {
    const groups = new Map<number, number[]>();
    ds.forEach((d, i) => { const n = districtNumberPart(d.code) ?? -1 - i; const g = groups.get(n) ?? []; g.push(i); groups.set(n, g); });
    if (groups.size * rule.perNumber === seats) {
      const out = new Array<number>(ds.length).fill(1);
      for (const idx of groups.values()) {
        const share = websterSeats(idx.map((i) => ds[i]!.pop2010), rule.perNumber);
        idx.forEach((i, k) => { out[i] = share[k]!; });
      }
      return { seats: out, mode: rule.mode };
    }
  } else if (rule.byPopulation) return { seats: websterSeats(ds.map((d) => d.pop2010), seats), mode: rule.mode };
  return { seats: largestRemainderSeats(ds.map((d) => d.pop2010), seats), mode: rule.mode };
}

/** The title suffix of a district's p-th member (1-based) of `n`: "(Position 2)", "(seat 3)", or nothing. */
export function postSuffix(rule: ChamberSeatRule | null, post: number, n: number): string {
  if (n <= 1) return '';
  const label = rule?.postLabels?.[post - 1];
  return label ? ` (${label})` : ` (seat ${post})`;
}
