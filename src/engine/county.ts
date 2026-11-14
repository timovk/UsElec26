/**
 * County government (Phase 7.6): the seats of every county's elected offices and their first officeholders, the
 * districts county boards are elected from, prosecutors' multi-county districts, and vacancies.
 *
 * - **Scope** is a per-universe setting: every county (the default), the major counties (250,000 people or more in
 *   2010), or none. Offices outside the scope are not elected.
 * - **Seats** follow each state's 2016 law (rules/county2016): one office per seat, its `seat.county` the county (−1
 *   for a prosecutor's multi-county district), `seat.body` the office's key, `seat.district` its board district (or
 *   circuit number).
 * - **Board districts** are drawn inside each county from the 2010 Census, and redrawn after each simulated census;
 *   each plan is stored (table county_plan) with the first year it is used.
 */
import { Rng } from '../core/rng';
import { daysToCivil, easternDay, zonedToUtc, type SimTime } from '../core/time';
import { composeDistricts } from '../geo/bodyDistricts';
import type { GeoPack } from '../geo/pack';
import { PARTY_D, PARTY_R, type Office } from '../institutions/model';
import { circuitOffices, circuitPlan, countyBodies, countySeatUp, isCountyKind, pickFor, type CircuitPlan, type CountyBody, type CPros } from '../rules/county2016';
import { leanMargin, type CountyWorld, type World } from './world';
import type { DownballotHost, CourtHost } from './downballot';

export type { CountyScope, CountyWorld } from './world';
/** A major county: 250,000 people or more at the 2010 Census. */
export const MAJOR_POP = 250_000;

export const countyOf = (w: World): CountyWorld => w.county ?? { scope: 'off', plans: [] };

// ---- Bodies and districts of the geography (cached per pack) ------------------------------------------------

const bodyCache = new WeakMap<GeoPack, CountyBody[][]>();
/** The elected bodies of a county (2016 law), indexed like `pack.counties`. */
export function bodiesOf(pack: GeoPack, county: number): CountyBody[] {
  let all = bodyCache.get(pack);
  if (!all) { all = pack.counties.map((c) => countyBodies(pack.states[c.stateIdx]!.usps, c)); bodyCache.set(pack, all); }
  return all[county] ?? [];
}

export interface Circuit { pros: CPros; key: string; plan: CircuitPlan }
const circuitCache = new WeakMap<GeoPack, Circuit[][]>();
/** A state's prosecutors elected by multi-county districts, with the districts (real 2016 circuits or generated). */
export function circuitsOf(pack: GeoPack, stateIdx: number): Circuit[] {
  let all = circuitCache.get(pack);
  if (!all) {
    all = pack.states.map((s) => {
      const cs = pack.counties.filter((c) => c.stateIdx === s.idx);
      return circuitOffices(s.usps).map((p) => ({ pros: p, key: p.key ?? 'pros', plan: circuitPlan(p, cs, pack.countyAdjacency) }));
    });
    circuitCache.set(pack, all);
  }
  return all[stateIdx] ?? [];
}

/** Display name of a circuit ("9th Judicial Circuit", "Atlanta Judicial Circuit", "Prosecutorial District 3"). */
export function circuitName(c: Circuit, d: number): string {
  const n = c.plan.names[d] ?? String(d + 1), word = c.pros.districtWord ?? 'District';
  return /^\d+$/.test(n) ? `${word} ${n}` : `${n} ${word}`;
}

const majorOf = (pack: GeoPack, county: number) => (pack.counties[county]?.pop2010 ?? 0) >= MAJOR_POP;
/** Whether a county's offices are simulated under the universe's scope. */
export function countyInScope(w: World, county: number): boolean {
  const s = countyOf(w).scope;
  return s === 'all' || (s === 'major' && majorOf(w.pack, county));
}
/** Whether a multi-county district's office is simulated: in scope when any of its counties is. */
export function circuitInScope(w: World, stateIdx: number, key: string, d: number): boolean {
  const s = countyOf(w).scope; if (s === 'all') return true; if (s === 'off') return false;
  const c = circuitsOf(w.pack, stateIdx).find((x) => x.key === key); if (!c) return false;
  for (const [ci, dd] of c.plan.of) if (dd === d && majorOf(w.pack, ci)) return true;
  return false;
}

// ---- A county office's seat -------------------------------------------------------------------------------

export interface CountySeat { state: number; county: number | null; body: CountyBody; circuit: Circuit | null; district: number }
const seatCache = new WeakMap<Office, CountySeat | null>();

/** The county body (or multi-county district) of a county office; undefined for other offices. */
export function countySeat(w: World, o: Office): CountySeat | undefined {
  if (!isCountyKind(o.kind) || !o.seat || o.stateIdx === null) return undefined;
  const hit = seatCache.get(o); if (hit !== undefined) return hit ?? undefined;
  let out: CountySeat | null = null;
  const county = o.seat.county ?? -1;
  if (county >= 0) {
    const body = bodiesOf(w.pack, county).find((b) => b.key === o.seat!.body);
    if (body) out = { state: o.stateIdx, county, body, circuit: null, district: o.seat.district };
  } else {
    const key = o.seat.body.replace(/^pros:/, '');
    const c = circuitsOf(w.pack, o.stateIdx).find((x) => x.key === key);
    if (c) out = { state: o.stateIdx, county: null, circuit: c, district: o.seat.district,
      body: { key, kind: c.pros.kind ?? 'prosecutor', name: c.pros.name, member: null, seats: 1, by: 'single', term: c.pros.term, cycles: [o.seat.cycle], districts: [o.seat.district], np: !!c.pros.np, spring: false } };
  }
  seatCache.set(o, out);
  return out ?? undefined;
}

/** Whether a county office is up for election in `year` (and simulated under the scope). */
export function countySeatElectionIn(w: World, o: Office, year: number): boolean {
  const s = countySeat(w, o); if (!s || !o.seat) return false;
  if (s.county !== null ? !countyInScope(w, s.county) : !circuitInScope(w, s.state, s.circuit!.key, s.district - 1)) return false;
  return countySeatUp(o.seat.cycle, o.seat.termYears, year);
}

/**
 * Whether news about a county office is local (county pages only): all of it, except the executive, sheriff and
 * prosecutor of a county of a million people or more (or of a district containing one), which make the national feed.
 */
export function countyNewsLocal(w: World, o: Office): boolean {
  const s = countySeat(w, o); if (!s) return false;
  if (s.body.kind !== 'county_executive' && s.body.kind !== 'sheriff' && s.body.kind !== 'prosecutor') return true;
  if (s.county !== null) return (w.pack.counties[s.county]?.pop2010 ?? 0) < 1_000_000;
  for (const [ci, d] of s.circuit!.plan.of) if (d === s.district - 1 && (w.pack.counties[ci]?.pop2010 ?? 0) >= 1_000_000) return false;
  return true;
}

/** Whether a county office is in the universe's scope. */
export function countyOfficeInScope(w: World, o: Office): boolean {
  const s = countySeat(w, o); if (!s) return false;
  return s.county !== null ? countyInScope(w, s.county) : circuitInScope(w, s.state, s.circuit!.key, s.district - 1);
}

/** The local election a county seat is decided at: Wisconsin's spring election, Tennessee's August county election, Alaska's October borough election. */
export function countyLocal(w: World, o: Office): 'spring' | 'august' | 'october' | null {
  const s = countySeat(w, o); if (!s) return null;
  if (s.body.spring) return 'spring';
  const usps = w.pack.states[s.state]!.usps;
  if (usps === 'TN') return 'august';
  if (usps === 'AK') return 'october';
  return null;
}

/** Term start of a county office elected in `year`: January 1 after a November election; after a local election, soon after it. */
export function countyTermStart(w: World, o: Office, year: number): SimTime {
  const local = countyLocal(w, o);
  if (local === 'spring') return zonedToUtc(year, 4, 20, 12, 0, 'America/New_York');
  if (local === 'august') return zonedToUtc(year, 9, 1, 12, 0, 'America/New_York');
  if (local === 'october') return zonedToUtc(year, 10, 26, 12, 0, 'America/New_York');
  return zonedToUtc(year + 1, 1, 1, 12, 0, 'America/New_York');
}

// ---- Board districts -------------------------------------------------------------------------------------------

/** The district-elected board of a county, if any (one per county in the 2016 law). */
export function districtBoard(pack: GeoPack, county: number): CountyBody | undefined {
  const b = bodiesOf(pack, county).find((x) => x.by === 'district' && x.seats > 1);
  return b && splittable(pack, county, b.seats) ? b : undefined;
}

/**
 * Whether a county can be split into `seats` board districts: it needs at least that many populated Base Units. A
 * county too small for its board (a few block groups for nine districts) elects its members countywide, each for a
 * numbered district, as residency districts do.
 */
const splitCache = new WeakMap<GeoPack, Map<number, number>>();
function splittable(pack: GeoPack, county: number, seats: number): boolean {
  let m = splitCache.get(pack); if (!m) { m = new Map(); splitCache.set(pack, m); }
  let n = m.get(county);
  if (n === undefined) {
    const c = pack.counties[county]!; n = 0;
    for (let b = c.buStart; b < c.buStart + c.buCount; b++) if (pack.bu.pop2010[b]! > 0) n++;
    m.set(county, n);
  }
  return n >= seats;
}

/**
 * Board districts of every county with a district-elected board: each Base Unit's district (1-based) within its
 * county, 0 elsewhere. Drawn from the given populations (2010 Census, or a simulated census).
 */
export function drawBoardPlan(pack: GeoPack, pop: ArrayLike<number>): Uint16Array {
  const plan = new Uint16Array(pack.bu.rows);
  for (const c of pack.counties) {
    const b = districtBoard(pack, c.idx); if (!b) continue;
    const n = c.buCount, block = new Int32Array(n);
    for (let i = 0; i < n; i++) block[i] = i;
    const p = new Float64Array(n); for (let i = 0; i < n; i++) p[i] = pop[c.buStart + i]!;
    const d = composeDistricts({ block, x: pack.bu.x.subarray(c.buStart, c.buStart + n), y: pack.bu.y.subarray(c.buStart, c.buStart + n), pop: p }, Array.from({ length: b.seats }, () => 1));
    plan.set(d, c.buStart);
  }
  return plan;
}

/**
 * Redraw a state's county board districts from a census (its units' populations, indexed from `b0`), for elections
 * from `year`: the plan for that year is the latest one with this state's counties redrawn. Returns the plan.
 */
export function redrawCountyBoards(w: World, stateIdx: number, pop: ArrayLike<number>, b0: number, year: number): Uint16Array | null {
  const cw = countyOf(w); if (cw.scope === 'off') return null;
  const counties = w.pack.counties.filter((c) => c.stateIdx === stateIdx && districtBoard(w.pack, c.idx));
  if (!counties.length) return null;
  let entry = cw.plans.find((p) => p.year === year);
  if (!entry) { entry = { year, plan: boardPlan(w, year - 1).slice() }; cw.plans.push(entry); }
  for (const c of counties) {
    const b = districtBoard(w.pack, c.idx)!, n = c.buCount, block = new Int32Array(n), p = new Float64Array(n);
    for (let i = 0; i < n; i++) { block[i] = i; p[i] = pop[c.buStart - b0 + i]!; }
    const d = composeDistricts({ block, x: w.pack.bu.x.subarray(c.buStart, c.buStart + n), y: w.pack.bu.y.subarray(c.buStart, c.buStart + n), pop: p }, Array.from({ length: b.seats }, () => 1));
    entry.plan.set(d, c.buStart);
  }
  return entry.plan;
}

/** The board district plan in effect in `year`. */
export function boardPlan(w: World, year: number): Uint16Array {
  const cw = countyOf(w);
  let best: { year: number; plan: Uint16Array } | null = null;
  for (const p of cw.plans) if (p.year <= year && (!best || p.year > best.year)) best = p;
  if (best) return best.plan;
  if (!cw.plans.length) { const plan = drawBoardPlan(w.pack, w.pack.bu.pop2010); cw.plans.push({ year: 2011, plan }); return plan; }
  return cw.plans.reduce((a, b) => (a.year < b.year ? a : b)).plan;
}

/**
 * The kernel's district maps of a state's units (indexed from the state's first unit): the county (global index),
 * the board district (`(county − first county of the state) × 64 + district`), and each multi-county office's
 * district (1-based).
 */
export function countyMaps(w: World, stateIdx: number, buStart: number, buEnd: number, year: number): { county: Uint16Array; board: Uint16Array; circuits: Map<string, Uint16Array> } {
  const n = buEnd - buStart, plan = boardPlan(w, year);
  const county = w.pack.bu.county.subarray(buStart, buEnd) as Uint16Array;
  const first = w.pack.counties.findIndex((c) => c.stateIdx === stateIdx);
  const board = new Uint16Array(n);
  for (let i = 0; i < n; i++) { const d = plan[buStart + i]!; if (d) board[i] = (county[i]! - first) * 64 + d; }
  const circuits = new Map<string, Uint16Array>();
  for (const c of circuitsOf(w.pack, stateIdx)) {
    const m = new Uint16Array(n);
    for (let i = 0; i < n; i++) { const d = c.plan.of.get(county[i]!); m[i] = d === undefined ? 0 : d + 1; }
    circuits.set(c.key, m);
  }
  return { county, board, circuits };
}

/** The kernel's map and district code of a county office: which units vote for it. */
export function countyGeo(w: World, o: Office): { map: 'county' | 'board' | string; code: number } | null {
  const s = countySeat(w, o); if (!s) return null;
  if (s.circuit) return { map: `circuit:${s.circuit.key}`, code: s.district };
  const first = w.pack.counties.findIndex((c) => c.stateIdx === s.state);
  if (s.body.by === 'district' && s.district > 0 && districtBoard(w.pack, s.county!)?.key === s.body.key) return { map: 'board', code: (s.county! - first) * 64 + s.district };
  return { map: 'county', code: s.county! };
}

/** The Base Units that vote for a county office (in the plan of `year`). */
export function countySeatUnits(w: World, o: Office, year: number): number[] {
  const s = countySeat(w, o); if (!s) return [];
  const out: number[] = [];
  if (s.circuit) {
    for (const [ci, d] of s.circuit.plan.of) if (d === s.district - 1) { const c = w.pack.counties[ci]!; for (let b = c.buStart; b < c.buStart + c.buCount; b++) out.push(b); }
    return out;
  }
  const c = w.pack.counties[s.county!]!;
  const g = countyGeo(w, o)!;
  const plan = g.map === 'board' ? boardPlan(w, year) : null;
  for (let b = c.buStart; b < c.buStart + c.buCount; b++) if (!plan || plan[b] === s.district) out.push(b);
  return out;
}

/** Lean (D margin, points) of the area a county office is elected by. */
export function countySeatMargin(w: World, o: Office, year: number): number {
  const s = countySeat(w, o); if (!s) return 0;
  const g = countyGeo(w, o);
  if (g?.map === 'county') return leanMargin(w.lean.county, s.county!);
  let d = 0, t = 0;
  for (const b of countySeatUnits(w, o, year)) { d += w.lean.bu.dVotes[b]!; t += w.lean.bu.votes[b]!; }
  return t > 0 ? 100 * (2 * d / t - 1) : leanMargin(w.lean.state, s.state);
}

/** A home county for a county officeholder or candidate (a multi-county district: weighted by population). */
export function countySeatHomeCounty(w: World, o: Office, r: Rng): number | null {
  const s = countySeat(w, o); if (!s) return null;
  if (s.county !== null) return s.county;
  const cs = [...s.circuit!.plan.of].filter(([, d]) => d === s.district - 1).map(([ci]) => ci).sort((a, b) => a - b);
  if (!cs.length) return null;
  return cs[r.weighted(cs.map((ci) => Math.max(1, w.pack.counties[ci]!.pop2010)))]!;
}

// ---- Titles ------------------------------------------------------------------------------------------------

/** "Sheriff, Harris County"; "Commissioner, Harris County Commissioners Court, District 2"; "State Attorney, 9th Judicial Circuit of Florida". */
export function countySeatTitle(pack: GeoPack, s: { county: number | null; state: number; body: CountyBody; circuit: Circuit | null }, number: number, district: number): string {
  if (s.circuit) return `${s.body.name}, ${circuitName(s.circuit, district - 1)} of ${pack.states[s.state]!.name}`;
  const c = pack.counties[s.county!]!, b = s.body;
  if (b.seats === 1) return `${b.name}, ${c.fullName}`;
  // "Cook County Board", not "Cook County County Board".
  const body = b.kind === 'county_board' ? `${c.fullName} ${/ County$/.test(c.fullName) ? b.name.replace(/^County /, '') : b.name}` : c.fullName;
  if (b.by === 'district' || b.by === 'residency') return `${b.member ?? 'Member'}, ${body}, District ${district}`;
  return `${b.member ?? 'Member'}, ${body}, seat ${number}`;
}

// ---- First officeholders ---------------------------------------------------------------------------------------

const BACKGROUND: Record<string, [number, string, number][]> = {
  sheriff: [[0.3, 'deputy sheriff', 5], [0.28, 'police officer', 3], [0.26, 'state trooper', 1]],
  prosecutor: [[0.32, 'assistant prosecutor', 5], [0.27, 'attorney in private practice', 3], [0.25, 'public defender', 1]],
  county_board: [[0.24, 'businessperson', 4], [0.22, 'farmer', 2], [0.26, 'city council member', 3], [0.23, 'school board member', 2], [0.2, 'retired teacher', 1]],
  county_executive: [[0.34, 'county commissioner', 4], [0.36, 'state legislator', 2], [0.3, 'mayor', 2], [0.25, 'businessperson', 2]],
  default: [[0.2, 'deputy in the office', 5], [0.2, 'businessperson', 2], [0.18, 'county employee', 3], [0.2, 'city clerk', 1]],
};
export function countyBackground(kind: string, r: Rng): { tier: number; text: string } {
  const list = BACKGROUND[kind] ?? BACKGROUND.default!;
  const bg = list[r.weighted(list.map((x) => x[2]))]!;
  return { tier: bg[0], text: bg[1] };
}

/** Officeholders' parties: the area's lean plus a local spread (row offices are less nationalized than boards). */
function seatParty(r: Rng, margin: number, kind: string): number {
  const sd = kind === 'county_board' || kind === 'county_executive' ? 10 : 14;
  return margin + r.normal(0, sd) > 0 ? PARTY_D : PARTY_R;
}

/**
 * Create the county offices and first officeholders (once per office; offices outside the scope are created but
 * left unfilled). Offices are created in state, county and body order, so ids are the same in every universe of a
 * pack and scope. Returns the number of officeholders installed.
 */
export function materializeCounty(h: DownballotHost): number {
  const w = h.world, cw = countyOf(w);
  const existing = new Map<string, Office>();
  for (const o of w.offices) if (isCountyKind(o.kind) && o.seat) existing.set(`${o.stateIdx}|${o.seat.county ?? -1}|${o.seat.body}|${o.seat.number}`, o);
  const now = w.time, today = easternDay(now), year = daysToCivil(today).y;
  if (!cw.plans.length) boardPlan(w, year);
  let made = 0, rank = 20000 + w.offices.filter((o) => isCountyKind(o.kind)).length;
  const install = (o: Office, s: CountySeat, k: number) => {
    // A seat with a vacancy (a death, a resignation) is the simulation's to fill, by appointment or election.
    if (w.current.has(o.id) || w.vacancies.has(o.id) || !countyOfficeInScope(w, o)) return;
    const r = Rng.stream(w.seed, 'county', o.stateIdx!, s.county ?? -1, o.seat!.body, k);
    const term = o.seat!.termYears;
    let last = o.seat!.cycle; while (last > year - 1) last -= term; while (last + term <= year - 1) last += term;
    const margin = countySeatMargin(w, o, year) + (w.history.env[String(Math.max(2006, Math.min(2015, last)))] ?? 0);
    const party = seatParty(r, margin, o.kind);
    const person = h.newPerson(r, 'C', party, o.stateIdx!, { homeCounty: countySeatHomeCounty(w, o, r), ageMean: 54, prominence: o.kind === 'county_executive' ? 0.03 : 0.01, background: countyBackground(o.kind, r) });
    const start = Math.min(now, zonedToUtc(last + 1, 1, 1, 12, 0, 'America/New_York'));
    h.installTerm(o.id, person, start, `elected ${last}`);
    made++;
  };
  for (const st of w.pack.states) {
    for (const c of w.pack.counties) {
      if (c.stateIdx !== st.idx) continue;
      for (const b of bodiesOf(w.pack, c.idx)) {
        for (let k = 0; k < b.seats; k++) {
          const number = k + 1, district = b.districts[k]!;
          let o = existing.get(`${st.idx}|${c.idx}|${b.key}|${number}`);
          const s: CountySeat = { state: st.idx, county: c.idx, body: b, circuit: null, district };
          if (!o) {
            o = h.addOffice({ kind: b.kind, title: countySeatTitle(w.pack, s, number, district), stateIdx: st.idx, districtIdx: null, senateClass: null, chamberId: null,
              dept: b.kind === 'county_board' ? `${c.fullName} ${b.name}` : c.fullName, rank: rank++, seat: { body: b.key, number, district, cycle: b.cycles[k]!, termYears: b.term, county: c.idx } });
          }
          install(o, s, k);
        }
      }
    }
    for (const c of circuitsOf(w.pack, st.idx)) {
      for (let d = 0; d < c.plan.names.length; d++) {
        const number = d + 1;
        let o = existing.get(`${st.idx}|-1|pros:${c.key}|${number}`);
        const seatCounty = [...c.plan.of].filter(([, dd]) => dd === d).map(([ci]) => ci).sort((a, b) => a - b)[0];
        const cyc = pickFor(seatCounty !== undefined ? w.pack.counties[seatCounty]! : { idx: d, name: '', legalType: '', pop2010: 0, stateIdx: st.idx }, c.key, c.pros.y);
        const body: CountyBody = { key: c.key, kind: c.pros.kind ?? 'prosecutor', name: c.pros.name, member: null, seats: 1, by: 'single', term: c.pros.term, cycles: [cyc], districts: [number], np: !!c.pros.np, spring: false };
        const s: CountySeat = { state: st.idx, county: null, body, circuit: c, district: number };
        if (!o) {
          o = h.addOffice({ kind: body.kind, title: countySeatTitle(w.pack, s, number, number), stateIdx: st.idx, districtIdx: null, senateClass: null, chamberId: null,
            dept: `${circuitName(c, d)} of ${st.name}`, rank: rank++, seat: { body: `pros:${c.key}`, number, district: number, cycle: cyc, termYears: c.pros.term, county: -1 } });
        }
        install(o, s, d);
      }
    }
  }
  return made;
}

/** End the terms of county officeholders outside the scope (after the scope is narrowed). */
export function retireOutOfScope(h: CourtHost): number {
  const w = h.world; let n = 0;
  for (const o of w.offices) {
    if (!isCountyKind(o.kind) || countyOfficeInScope(w, o)) continue;
    if (w.current.has(o.id)) { h.endTerm(o.id, 'county offices no longer simulated'); n++; }
    w.vacancies.delete(o.id);
  }
  return n;
}

// ---- Vacancies ------------------------------------------------------------------------------------------------

/** How a vacancy in a county office is filled, in words. */
export function countyVacancyResolution(w: World, o: Office): string {
  const s = countySeat(w, o);
  if (s?.body.kind === 'county_board') return 'Appointment by the Governor until the next regular election';
  return 'Appointment by the county board until the next regular election';
}

/** Fill a vacant county office by appointment: the appointing body's majority (the board's, or the governor's) usually picks one of its own. */
export function fillCountySeat(h: CourtHost, o: Office, r: Rng): void {
  const w = h.world, s = countySeat(w, o); if (!s) return;
  if (!countyOfficeInScope(w, o)) return;
  const year = daysToCivil(easternDay(w.time)).y;
  const margin = countySeatMargin(w, o, year);
  const party = r.bernoulli(0.85) ? (margin > 0 ? PARTY_D : PARTY_R) : (margin > 0 ? PARTY_R : PARTY_D);
  const person = h.newPerson(r, 'C', party, s.state, { homeCounty: countySeatHomeCounty(w, o, r), ageMean: 50, prominence: 0.01, background: countyBackground(o.kind, r) });
  h.startTerm(o.id, person, s.body.kind === 'county_board' ? 'appointed by the Governor' : 'appointed by the county board');
}

