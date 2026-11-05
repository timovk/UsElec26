/**
 * State legislatures (Phase 6): one office per seat, held by a person; regular elections on each chamber's
 * schedule; chamber control from who holds the seats.
 *
 * - **Seats** follow the 2016 chamber sizes. Where a chamber has more seats than districts (multi-member
 *   districts), each district's seats are allocated by 2010 population (largest remainder) and elected as
 *   numbered posts, as Washington and Idaho do it.
 * - **Schedules** (2016 law, simplified): lower houses every two years (four in Alabama, Maryland, Louisiana and
 *   Mississippi; odd years in Virginia, New Jersey, Louisiana and Mississippi); two-year senates every even year;
 *   four-year senates by halves (odd-numbered districts in presidential years) except those elected all at once.
 * - **Candidates:** each party fields at most one candidate per seat (the incumbent, or a newcomer); there are
 *   no state legislative primaries yet, and many safe seats go uncontested.
 */
import { Rng } from '../core/rng';
import { ageOn, easternDay, zonedToUtc } from '../core/time';
import type { GeoPack } from '../geo/pack';
import { NONE16 } from '../geo/pack';
import { PARTY_D, PARTY_R, PRE_SIM, fullName, type Chamber, type Office, type OfficeKind, type Person, type Term } from '../institutions/model';
import { STATES_2016 } from '../rules/states2016';
import type { World } from './world';

export type LegKind = 'state_senator' | 'state_representative';

/** Seats per district of a state's chamber: largest-remainder allocation by 2010 population (at least one each). */
export function seatsByDistrict(pack: GeoPack, stateIdx: number, sld: 'sldu' | 'sldl', seats: number): { district: number; number: number; seats: number }[] {
  const ds = pack[sld].filter((d) => d.stateIdx === stateIdx);
  if (!ds.length) return [];
  const n = (d: { code?: string; name?: string; idx: number }) => Number(d.code ?? d.name) || d.idx;
  // More districts than seats (only in synthetic geographies): the most populous districts get the seats.
  if (seats <= ds.length) return [...ds].sort((a, b) => b.pop2010 - a.pop2010 || a.idx - b.idx).slice(0, seats).map((d) => ({ district: d.idx, number: n(d), seats: 1 })).sort((a, b) => a.number - b.number);
  const popOf = (d: { pop2010: number }) => (Number.isFinite(d.pop2010) && d.pop2010 > 0 ? d.pop2010 : 1);
  const total = ds.reduce((a, d) => a + popOf(d), 0) || 1;
  const quota = ds.map((d) => (seats * popOf(d)) / total);
  const alloc = quota.map((q) => Math.max(1, Math.floor(q)));
  let left = seats - alloc.reduce((a, b) => a + b, 0);
  const order = quota.map((q, i) => ({ i, rem: q - Math.floor(q) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length * 4; k++) { alloc[order[k % order.length]!.i]!++; left--; }
  while (left < 0) { const i = alloc.indexOf(Math.max(...alloc)); alloc[i]!--; left++; }
  return ds.map((d, i) => ({ district: d.idx, number: n(d), seats: alloc[i]! })).sort((a, b) => a.number - b.number);
}

const LOWER_4Y = new Set(['AL', 'MD', 'LA', 'MS']);
const ODD_YEAR = new Set(['VA', 'NJ', 'LA', 'MS']);
/** Four-year senates elected all at once, and the year in the four-year cycle (year % 4). */
const SENATE_ALL_AT_ONCE: Record<string, number> = { AL: 2, MD: 2, MI: 2, LA: 3, MS: 3, VA: 3, NM: 0, SC: 0, KS: 0, NJ: 1, MN: 2 };

/** Whether a state legislative seat is up for regular election in `year`. */
export function legislativeSeatUp(o: Office, number: number, year: number, usps: string): boolean {
  const inst = STATES_2016[usps]; if (!inst) return false;
  const odd = ODD_YEAR.has(usps);
  if (o.kind === 'state_representative') {
    if (!inst.lower) return false;
    if (odd) return year % 2 === 1 && (!LOWER_4Y.has(usps) || year % 4 === 3);
    if (LOWER_4Y.has(usps)) return year % 4 === 2;
    return year % 2 === 0 && inst.lower.termYears <= 2;
  }
  if (o.kind !== 'state_senator' || !inst.upper) return false;
  const term = inst.upper.termYears;
  if (usps in SENATE_ALL_AT_ONCE) return year % 4 === SENATE_ALL_AT_ONCE[usps]!;
  if (odd) return year % 2 === 1;
  if (term <= 2) return year % 2 === 0;
  // Staggered halves: odd-numbered districts in presidential years, even-numbered in midterms.
  return year % 2 === 0 && ((number % 2 === 1) === (year % 4 === 0));
}

export function legislativeTitle(st: { name: string }, ch: Chamber, number: number, post: number, posts: number): string {
  return `${ch.name}, District ${number}${posts > 1 ? ` (seat ${post})` : ''}`.replace(`${st.name} ${st.name}`, st.name);
}

interface Host {
  world: World;
  newPerson(r: Rng, tier: Person['tier'], party: number, stateIdx: number, opts?: { homeCounty?: number | null; ageMean?: number; prominence?: number; background?: { tier: number; text: string } }): Person;
  addOffice(o: Omit<Office, 'id'>): Office;
  installTerm(officeId: number, person: Person, start: number, acquired: string): Term;
}

/** Neutral lean (points, D+) of every state senate and state house district, from the BU lean. */
export function sldLean(w: World, sld: 'sldu' | 'sldl', assign: Uint16Array = w.pack.bu[sld]): Float64Array {
  // Every plan's districts: new plans append to the table, so size by the table, not the 2016 pack.
  const n = Math.max(w.pack[sld].length, w.districts.table(sld).length), d = new Float64Array(n), t = new Float64Array(n);
  for (let b = 0; b < w.pack.bu.rows; b++) { const k = assign[b]!; if (k === NONE16 || k >= n) continue; d[k]! += w.lean.bu.dVotes[b]!; t[k]! += w.lean.bu.votes[b]!; }
  return Float64Array.from(d, (x, k) => (t[k]! > 0 ? 100 * (2 * x / t[k]! - 1) : 0));
}

/**
 * Create every state legislator (once): one office per seat, held by a person of the party the chamber's
 * composition gives it. Seats go to parties by district lean (with noise), so the most Democratic districts
 * are mostly held by Democrats. A chamber's leaders take seats of their party.
 */
export function materializeLegislatures(h: Host): number {
  const w = h.world;
  if (w.offices.some((o) => o.kind === 'state_senator' || o.kind === 'state_representative')) return 0;
  const r = Rng.stream(w.seed, 'legislatures', 'materialize');
  const start = Math.min(w.time, zonedToUtc(2015, 1, 12, 12, 0, 'America/New_York'));
  let created = 0;
  const leans = { sldu: sldLean(w, 'sldu'), sldl: sldLean(w, 'sldl') }, homes = { sldu: dominantCounties(w, 'sldu'), sldl: dominantCounties(w, 'sldl') };
  for (const st of w.pack.states) {
    const inst = STATES_2016[st.usps]; if (!inst) continue;
    for (const [chKind, kind, sld] of [['state_upper', 'state_senator', 'sldu'], ['state_lower', 'state_representative', 'sldl']] as const) {
      const ch = w.chambers.find((c) => c.kind === chKind && c.stateIdx === st.idx); if (!ch) continue;
      const seats = seatsByDistrict(w.pack, st.idx, sld, ch.seats);
      if (!seats.length) continue;
      const lean = leans[sld];
      const posts = seats.flatMap((s) => Array.from({ length: s.seats }, (_, p) => ({ ...s, post: p + 1, score: lean[s.district]! + r.normal(0, 6) })));
      // Party of each seat: the D share of the chamber's seats to the most Democratic-leaning posts.
      const d = ch.composition.get(PARTY_D) ?? 0, rr = ch.composition.get(PARTY_R) ?? 0;
      const order = [...posts].sort((a, b) => b.score - a.score);
      const party = new Map<(typeof posts)[number], number>();
      order.forEach((p, i) => party.set(p, i < d ? PARTY_D : i >= order.length - rr ? PARTY_R : 5));
      const leaders = w.offices.filter((o) => o.kind === 'state_leg_leader' && o.chamberId === ch.id).map((o) => w.current.get(o.id)).filter((t): t is Term => !!t);
      const leaderPeople = new Map<number, Person[]>(); for (const t of leaders) { const p = w.persons.get(t.personId); if (p) { const a = leaderPeople.get(p.partyId) ?? []; a.push(p); leaderPeople.set(p.partyId, a); } }
      for (const p of posts) {
        const pty = party.get(p)!;
        const o = h.addOffice({ kind: kind as OfficeKind, title: legislativeTitle(st, ch, p.number, p.post, p.seats), stateIdx: st.idx, districtIdx: p.district, senateClass: null, chamberId: ch.id, dept: null, rank: 5000 + created });
        const homeCounty = homes[sld][p.district] ?? null;
        const person = leaderPeople.get(pty)?.shift() ?? h.newPerson(r, 'C', pty, st.idx, { homeCounty, ageMean: 52, prominence: 0.02 });
        h.installTerm(o.id, person, start, 'elected (before the simulation)');
        created++;
      }
    }
  }
  return created;
}

/** For every district of a kind: the county holding most of its eligible voters (one pass over BUs). */
export function dominantCounties(w: World, sld: 'sldu' | 'sldl', assign: Uint16Array = w.pack.bu[sld]): (number | null)[] {
  const n = w.pack[sld].length, best: (number | null)[] = new Array(n).fill(null), bv = new Float64Array(n).fill(-1);
  // BUs are sorted by county, so each county's contribution to a district is a contiguous run.
  let curC = -1; const acc = new Map<number, number>();
  const flush = () => { for (const [d, v] of acc) if (v > bv[d]!) { bv[d] = v; best[d] = curC; } acc.clear(); };
  for (let b = 0; b < w.pack.bu.rows; b++) {
    const c = w.pack.bu.county[b]!; if (c !== curC) { flush(); curC = c; }
    const d = assign[b]!; if (d === NONE16 || d >= n) continue;
    acc.set(d, (acc.get(d) ?? 0) + w.pop.vep[b]!);
  }
  flush();
  return best;
}

export interface LegCandidate { person: Person; party: number; incumbent: boolean; quality: number }

/**
 * A seat's field: the incumbent runs unless retiring; each major party fields a candidate with a probability
 * that rises with its prospects (safe seats often go uncontested); a minor party occasionally.
 */
export function legislativeField(w: World, r: Rng, o: Office, margin: number, year: number, newPerson: (party: number) => Person, quality: (p: Person, base?: number) => number, running: Set<number>): { field: LegCandidate[]; retired: Person | null } {
  const inc = w.current.get(o.id); const incP = inc ? w.persons.get(inc.personId) : undefined;
  const field: LegCandidate[] = [];
  let retired: Person | null = null;
  if (incP && incP.deathDay === null && !running.has(incP.id)) {
    const age = ageOn(incP.birthDay, easternDay(w.time));
    const hostile = Math.max(0, (incP.partyId === PARTY_D ? -margin : margin) / 100);
    if (!r.bernoulli(Math.min(0.85, 0.1 + Math.max(0, age - 66) * 0.04 + hostile * 0.3))) { field.push({ person: incP, party: incP.partyId, incumbent: true, quality: quality(incP) }); running.add(incP.id); }
    else retired = incP;
  }
  for (const party of [PARTY_D, PARTY_R]) {
    if (field.some((c) => c.party === party)) continue;
    const pr = 1 / (1 + Math.exp(-(party === PARTY_D ? margin : -margin) / 9));
    const hasInc = field.some((c) => c.incumbent);
    const p = hasInc ? 0.38 + 0.6 * pr : 0.5 + 0.5 * Math.min(1, 2 * pr);
    if (!r.bernoulli(Math.min(0.98, p))) continue;
    const c = newPerson(party);
    field.push({ person: c, party, incumbent: false, quality: quality(c, 0.3) }); running.add(c.id);
  }
  if (field.length === 0) { const party = margin >= 0 ? PARTY_D : PARTY_R; const c = newPerson(party); field.push({ person: c, party, incumbent: false, quality: quality(c, 0.3) }); }
  if (r.bernoulli(0.05)) { const party = r.bernoulli(0.6) ? 3 : 5; const c = newPerson(party); field.push({ person: c, party, incumbent: false, quality: quality(c, 0.1) }); }
  void year; void fullName; void PRE_SIM;
  return { field, retired };
}
