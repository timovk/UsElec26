/**
 * State legislatures (Phase 6; districts and seats per the 2016 law since Phase 7.4): one office per seat, held by a
 * person; regular elections on each chamber's schedule; chamber control from who holds the seats.
 *
 * - **Seats** follow the 2016 chamber sizes and each district's members (rules/legislativeSeats2016): single-member
 *   districts; "vote for N" districts (Arizona, New Jersey, North Dakota, South Dakota, Maryland, Vermont, West
 *   Virginia, New Hampshire with its floterials) elected in one race per district; numbered positions (Washington,
 *   Idaho) and West Virginia's staggered senate seats elected one by one. Districts are numbered uniquely and named
 *   as the state names them.
 * - **Schedules** (2016 law, simplified): lower houses every two years (four in Alabama, Maryland, Louisiana and
 *   Mississippi, and in North Dakota by halves; odd years in Virginia, New Jersey, Louisiana and Mississippi);
 *   two-year senates every even year; four-year senates by halves (odd-numbered districts in presidential years)
 *   except those elected all at once, and Minnesota's on its 2-4-4 cycle.
 * - **Candidates:** each party fields at most one candidate per seat (the incumbent, or a newcomer) and up to N in a
 *   vote-for-N district; there are no state legislative primaries yet, and many safe seats go uncontested.
 */
import { Rng } from '../core/rng';
import { ageOn, daysToCivil, easternDay, zonedToUtc } from '../core/time';
import { NONE16 } from '../geo/pack';
import { PARTY_D, PARTY_R, PRE_SIM, fullName, type Chamber, type Office, type OfficeKind, type Person, type Term } from '../institutions/model';
import { STATES_2016 } from '../rules/states2016';
import { districtWord, postSuffix, seatRule } from '../rules/legislativeSeats2016';
import type { World } from './world';

export type LegKind = 'state_senator' | 'state_representative';
const easternYear = (t: number) => daysToCivil(easternDay(t)).y;

/** One seat of a chamber: its district (in the plan in effect), and its place among the district's members. */
export interface SeatSlot { district: number; number: number; label: string; post: number; posts: number }

/** A state's chamber as seats: every district in effect for `year`, each with its members (Phase 7.4: the 2016 law's seat counts). */
export function seatSlots(w: Pick<World, 'districts'>, stateIdx: number, sld: 'sldu' | 'sldl', year: number): SeatSlot[] {
  return w.districts.districtsOf(sld, stateIdx, year).flatMap((d) => Array.from({ length: d.seats }, (_, p) => ({ district: d.idx, number: d.number, label: d.label, post: p + 1, posts: d.seats })));
}

/** The chamber's seat rule (vote for N, numbered positions, staggered seats; null for single-member districts). */
export const chamberRule = (usps: string, kind: LegKind) => seatRule(usps, kind === 'state_senator' ? 'upper' : 'lower');

/**
 * Each legislative office's place among its district's members (1-based) and the district's seat count, for
 * elections of `year`: offices of the same district, in office order. West Virginia's senate seats 1 and 2 come up
 * in alternate cycles, and Washington's and Idaho's positions keep their names.
 */
export function legislativePosts(w: Pick<World, 'offices' | 'districts'>, year: number): Map<number, { post: number; posts: number }> {
  const groups = new Map<string, number[]>();
  for (const o of w.offices) {
    if ((o.kind !== 'state_senator' && o.kind !== 'state_representative') || o.districtIdx === null) continue;
    const t = w.districts.table(o.kind === 'state_senator' ? 'sldu' : 'sldl')[o.districtIdx]; if (!t) continue;
    const key = `${o.kind}|${o.stateIdx}|${t.number}`;
    const l = groups.get(key); if (l) l.push(o.id); else groups.set(key, [o.id]);
  }
  void year;
  const out = new Map<number, { post: number; posts: number }>();
  for (const ids of groups.values()) { ids.sort((a, b) => a - b); ids.forEach((id, i) => out.set(id, { post: i + 1, posts: ids.length })); }
  return out;
}

const LOWER_4Y = new Set(['AL', 'MD', 'LA', 'MS']);
/** Four-year lower houses elected by halves with the senate district (North Dakota; Phase 7.4: its house was never up). */
const LOWER_4Y_STAGGERED = new Set(['ND']);
const ODD_YEAR = new Set(['VA', 'NJ', 'LA', 'MS']);
/** Four-year senates elected all at once, and the year in the four-year cycle (year % 4). */
const SENATE_ALL_AT_ONCE: Record<string, number> = { AL: 2, MD: 2, MI: 2, LA: 3, MS: 3, VA: 3, NM: 0, SC: 0, KS: 0, NJ: 1 };
/** Senates on a 2-4-4 cycle elected all at once: the years (year % 10) they are elected in (Minnesota: 2016, 2020, 2022, 2026). */
const SENATE_2_4_4: Record<string, readonly number[]> = { MN: [0, 2, 6] };

/** Odd-numbered districts in presidential years, even-numbered in midterms. */
const half = (number: number, year: number) => year % 2 === 0 && ((number % 2 === 1) === (year % 4 === 0));

/**
 * Whether a state legislative seat is up for regular election in `year`. `post` is the seat's place among its
 * district's members: West Virginia elects one of each senate district's two seats per cycle (seat 1 in
 * presidential years).
 */
export function legislativeSeatUp(o: Office, number: number, year: number, usps: string, post = 1): boolean {
  const inst = STATES_2016[usps]; if (!inst) return false;
  const odd = ODD_YEAR.has(usps);
  if (o.kind === 'state_representative') {
    if (!inst.lower) return false;
    if (odd) return year % 2 === 1 && (!LOWER_4Y.has(usps) || year % 4 === 3);
    if (LOWER_4Y.has(usps)) return year % 4 === 2;
    if (LOWER_4Y_STAGGERED.has(usps)) return half(number, year);
    return year % 2 === 0 && inst.lower.termYears <= 2;
  }
  if (o.kind !== 'state_senator' || !inst.upper) return false;
  const term = inst.upper.termYears;
  if (usps in SENATE_2_4_4) return SENATE_2_4_4[usps]!.includes(year % 10);
  if (usps in SENATE_ALL_AT_ONCE) return year % 4 === SENATE_ALL_AT_ONCE[usps]!;
  if (odd) return year % 2 === 1;
  if (term <= 2) return year % 2 === 0;
  if (chamberRule(usps, 'state_senator')?.mode === 'staggered') return year % 2 === 0 && ((post % 2 === 1) === (year % 4 === 0));
  // Staggered halves: odd-numbered districts in presidential years, even-numbered in midterms.
  return half(number, year);
}

/** "Arizona House of Representatives, District 7 (seat 2)", "Vermont Senate, Chittenden (seat 4)", "Washington House of Representatives, District 3 (Position 1)". */
export function legislativeTitle(st: { name: string; usps: string }, ch: Chamber, kind: LegKind, label: string, post: number, posts: number): string {
  return `${ch.name}, ${districtWord(label)}${postSuffix(chamberRule(st.usps, kind), post, posts)}`.replace(`${st.name} ${st.name}`, st.name);
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
      const slots = seatSlots(w, st.idx, sld, easternYear(w.time));
      if (!slots.length) continue;
      const lean = leans[sld];
      const posts = slots.map((s) => ({ ...s, score: lean[s.district]! + r.normal(0, 6) }));
      // Party of each seat: the D share of the chamber's seats to the most Democratic-leaning posts.
      const d = ch.composition.get(PARTY_D) ?? 0, rr = ch.composition.get(PARTY_R) ?? 0;
      const order = [...posts].sort((a, b) => b.score - a.score);
      const party = new Map<(typeof posts)[number], number>();
      order.forEach((p, i) => party.set(p, i < d ? PARTY_D : i >= order.length - rr ? PARTY_R : 5));
      const leaders = w.offices.filter((o) => o.kind === 'state_leg_leader' && o.chamberId === ch.id).map((o) => w.current.get(o.id)).filter((t): t is Term => !!t);
      const leaderPeople = new Map<number, Person[]>(); for (const t of leaders) { const p = w.persons.get(t.personId); if (p) { const a = leaderPeople.get(p.partyId) ?? []; a.push(p); leaderPeople.set(p.partyId, a); } }
      for (const p of posts) {
        const pty = party.get(p)!;
        const o = h.addOffice({ kind: kind as OfficeKind, title: legislativeTitle(st, ch, kind, p.label, p.post, p.posts), stateIdx: st.idx, districtIdx: p.district, senateClass: null, chamberId: ch.id, dept: null, rank: 5000 + created });
        const homeCounty = homes[sld][p.district] ?? null;
        const person = leaderPeople.get(pty)?.shift() ?? h.newPerson(r, 'C', pty, st.idx, { homeCounty, ageMean: 52, prominence: 0.02 });
        h.installTerm(o.id, person, start, 'elected (before the simulation)');
        created++;
      }
    }
  }
  return created;
}

/**
 * Seat every legislative office in a district of the plan in effect for `year`, by the 2016 law's members per
 * district (Phase 7.4; existing universes, and after redistricting). Offices already in a district with room stay;
 * the rest move to districts with seats to fill, in number order, keeping their holders until the next election.
 * Titles follow the districts' names. Returns the offices whose district or title changed.
 */
export function reseatChamber(w: World, stateIdx: number, kind: LegKind, year: number): Office[] {
  const st = w.pack.states[stateIdx]!, sld = kind === 'state_senator' ? 'sldu' : 'sldl';
  const ch = w.chambers.find((c) => c.kind === (kind === 'state_senator' ? 'state_upper' : 'state_lower') && c.stateIdx === stateIdx);
  const offices = w.offices.filter((o) => o.kind === kind && o.stateIdx === stateIdx && o.districtIdx !== null).sort((a, b) => a.id - b.id);
  if (!ch || !offices.length) return [];
  const slots = seatSlots(w, stateIdx, sld, year);
  const table = w.districts.table(sld);
  const inEffect = (o: Office) => w.districts.districtNumbered(sld, stateIdx, table[o.districtIdx!]!.number, year)?.idx ?? -1;
  const cap = new Map<number, number>(); for (const sl of slots) cap.set(sl.district, (cap.get(sl.district) ?? 0) + 1);
  const used = new Map<number, number>(), at = new Map<number, number>(), move: Office[] = [];
  for (const o of offices) {
    const d = inEffect(o), u = used.get(d) ?? 0;
    if (slots.length === offices.length && cap.has(d) && u < cap.get(d)!) { used.set(d, u + 1); at.set(o.id, d); } else move.push(o);
  }
  if (slots.length === offices.length) for (const sl of slots) { if ((used.get(sl.district) ?? 0) >= cap.get(sl.district)!) continue; const o = move.shift(); if (!o) break; used.set(sl.district, (used.get(sl.district) ?? 0) + 1); at.set(o.id, sl.district); }
  const changed: Office[] = [];
  const posts = new Map<number, number>();
  for (const o of offices) {
    const d = at.get(o.id) ?? (o.districtIdx !== null && inEffect(o) >= 0 ? inEffect(o) : o.districtIdx!);
    const info = table[d]!, post = (posts.get(d) ?? 0) + 1; posts.set(d, post);
    const title = legislativeTitle(st, ch, kind, info.label, post, cap.get(d) ?? info.seats);
    const moved = d !== inEffect(o) && at.has(o.id);
    if (moved || title !== o.title) { if (moved) o.districtIdx = d; o.title = title; changed.push(o); }
  }
  return changed;
}

const floterialCache = new WeakMap<Uint16Array, Map<number, Uint16Array>>();
/**
 * BU → the floterial district it votes in (global index; NONE16 where none), over a state's BUs, for the state
 * house plan in effect for `year` (New Hampshire, Phase 7.4). Each ordinary district belongs to at most one.
 */
export function floterialMap(w: World, stateIdx: number, year: number): Uint16Array {
  const assign = w.districts.assignment('sldl', year);
  let m = floterialCache.get(assign); if (!m) { m = new Map(); floterialCache.set(assign, m); }
  const hit = m.get(stateIdx); if (hit) return hit;
  const counties = w.pack.counties.filter((c) => c.stateIdx === stateIdx);
  const b0 = counties[0]?.buStart ?? 0, n = counties.reduce((a, c) => a + c.buCount, 0);
  const of = new Map<number, number>();
  for (const d of w.districts.districtsOf('sldl', stateIdx, year)) for (const mem of d.members ?? []) of.set(mem, d.idx);
  const out = new Uint16Array(n).fill(NONE16);
  for (let i = 0; i < n; i++) { const f = of.get(assign[b0 + i]!); if (f !== undefined) out[i] = f; }
  m.set(stateIdx, out);
  return out;
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
 * The field of a "vote for N" district (Phase 7.4): its incumbents run unless retiring; each major party runs a
 * slate of up to N, a full one where it can win and a shorter one (sometimes none) where it cannot; a minor
 * party now and then. The ballot always has at least N names.
 */
export function legislativeBlockField(w: World, r: Rng, offices: Office[], margin: number, year: number, newPerson: (party: number) => Person, quality: (p: Person, base?: number) => number, running: Set<number>): { field: LegCandidate[]; retired: Person[] } {
  const n = offices.length;
  const field: LegCandidate[] = [];
  const retired: Person[] = [];
  for (const o of offices) {
    const inc = w.current.get(o.id); const incP = inc ? w.persons.get(inc.personId) : undefined;
    if (!incP || incP.deathDay !== null || running.has(incP.id)) continue;
    const age = ageOn(incP.birthDay, easternDay(w.time));
    const hostile = Math.max(0, (incP.partyId === PARTY_D ? -margin : margin) / 100);
    if (!r.bernoulli(Math.min(0.85, 0.1 + Math.max(0, age - 66) * 0.04 + hostile * 0.3))) { field.push({ person: incP, party: incP.partyId, incumbent: true, quality: quality(incP) }); running.add(incP.id); }
    else retired.push(incP);
  }
  const add = (party: number) => { const c = newPerson(party); field.push({ person: c, party, incumbent: false, quality: quality(c, 0.3) }); running.add(c.id); };
  for (const party of [PARTY_D, PARTY_R]) {
    const pr = 1 / (1 + Math.exp(-(party === PARTY_D ? margin : -margin) / 9));
    for (let k = field.filter((c) => c.party === party).length; k < n; k++) if (r.bernoulli(Math.min(0.98, 0.15 + 1.7 * pr))) add(party);
  }
  // Every seat has a candidate: the stronger party completes the ballot.
  while (field.length < n) add(margin >= 0 ? PARTY_D : PARTY_R);
  if (r.bernoulli(0.06)) add(r.bernoulli(0.6) ? 3 : 5);
  void year;
  return { field, retired };
}

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
