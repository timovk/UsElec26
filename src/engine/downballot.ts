/**
 * Down-ballot offices, elected boards and state courts (Phase 7.2): their seats and first officeholders, the
 * districts of district-elected bodies, and which seats are up in a year.
 *
 * - **Seats** follow each state's 2016 law (rules/downballot2016): one office per seat, held by a person, with a
 *   cycle (an election year, or on appointed courts the year a term ends) and a term length.
 * - **First officeholders** are created once — at founding, or when a universe saved before Phase 7.2 is first
 *   opened. Partisan seats follow the state's (or district's) lean; judges and nonpartisan officers belong to a
 *   party too (the one their appointing governor or their voters leaned to), which the ballot may not show.
 * - **Districts** of boards, commissions and district-elected courts are drawn by the simulation from the
 *   year's state house districts (geo/bodyDistricts) and redrawn with them.
 */
import { Rng } from '../core/rng';
import { ageOn, civilToDays, daysToCivil, easternDay, zonedToUtc, type SimTime } from '../core/time';
import { NONE16 } from '../geo/pack';
import { composeDistricts } from '../geo/bodyDistricts';
import { PARTY_D, PARTY_R, type Office, type Person, type Term } from '../institutions/model';
import { DOWNBALLOT_2016, bodyDef, bodyName, elected, isDownballot, seatCycles, seatDistricts, seatUp, type BodyDef } from '../rules/downballot2016';
import { STATES_2016 } from '../rules/states2016';
import { stateRanges, type StateRange } from '../electorate/shards';
import type { PersonOptions } from './elections';
import { leanMargin, type World } from './world';

export interface DownballotHost {
  world: World;
  newPerson(r: Rng, tier: Person['tier'], party: number, stateIdx: number, opts?: PersonOptions): Person;
  addOffice(o: Omit<Office, 'id'>): Office;
  installTerm(officeId: number, person: Person, start: SimTime, acquired: string): Term;
}

/** The body a seat belongs to. */
export function seatBody(w: World, o: Office): BodyDef | undefined {
  if (!o.seat || o.stateIdx === null) return undefined;
  return bodyDef(w.pack.states[o.stateIdx]!.usps, o.seat.body);
}

/** Title of one seat ("Ohio Treasurer"; "Justice, Ohio Supreme Court, seat 3"; "Member, Texas State Board of Education, District 7"). */
export function seatTitle(b: BodyDef, stateName: string, number: number, district: number, sameDistrict: number): string {
  if (b.seats === 1) return b.full ?? `${stateName} ${b.name}`;
  const where = b.districts ? (district > 0 ? `, District ${district}` : ', at large') : '';
  const seat = sameDistrict > 1 ? `, seat ${number}` : '';
  return `${b.member ?? 'Member'}, ${bodyName(b, stateName)}${where}${seat}`;
}

const ranges = new WeakMap<object, StateRange[]>();
export function rangesOf(w: World): StateRange[] { let r = ranges.get(w.pack); if (!r) { r = stateRanges(w.pack); ranges.set(w.pack, r); } return r; }

/** Who appoints to a body, in words. */
export function appointerText(b: BodyDef, legislature: string): string {
  switch (b.appointer) {
    case 'commission': return "the Governor from a nominating commission's list";
    case 'legislature': return `the ${legislature}`;
    case 'governor_council': return "the Governor with the consent of the Governor's Council";
    default: return 'the Governor';
  }
}
export function legislatureName(usps: string): string { return usps === 'SC' ? 'General Assembly' : usps === 'VA' ? 'General Assembly' : 'Legislature'; }

// ---- Districts ---------------------------------------------------------------------------------------

const districtCache = new WeakMap<Uint16Array, Map<string, Uint16Array>>();

/**
 * District (1-based) of every Base Unit of a state (indexed from the state's first BU) for a district-elected
 * body in a year: the year's state house districts (Nebraska: its legislative districts) grouped by population.
 */
export function bodyDistricts(w: World, stateIdx: number, b: BodyDef, year: number): Uint16Array {
  const st = w.pack.states[stateIdx]!;
  const lower = STATES_2016[st.usps]?.lower ? 'sldl' : 'sldu';
  const assign = w.districts.assignment(lower, year);
  let m = districtCache.get(assign); if (!m) { m = new Map(); districtCache.set(assign, m); }
  const key = `${stateIdx}|${b.key}`;
  const hit = m.get(key); if (hit) return hit;
  const rg = rangesOf(w)[stateIdx]!;
  const n = rg.buEnd - rg.buStart;
  const block = new Int32Array(n);
  for (let i = 0; i < n; i++) { const v = assign[rg.buStart + i]!; block[i] = v === NONE16 ? -1 : v; }
  // Block ids are global district indices: renumber densely.
  const dense = new Map<number, number>(); for (let i = 0; i < n; i++) { const v = block[i]!; if (v >= 0) { let d = dense.get(v); if (d === undefined) { d = dense.size; dense.set(v, d); } block[i] = d; } }
  const sizes = b.perDistrict ?? Array.from({ length: b.districts ?? 1 }, () => 1);
  const out = composeDistricts({ block, x: w.pack.bu.x.subarray(rg.buStart, rg.buEnd), y: w.pack.bu.y.subarray(rg.buStart, rg.buEnd), pop: w.pop.vep.subarray(rg.buStart, rg.buEnd) }, sizes);
  m.set(key, out);
  return out;
}

/** Lean (D margin, points) of a body district, or of the state for statewide seats. */
export function seatMargin(w: World, o: Office, year: number): number {
  const s = o.stateIdx!;
  const b = seatBody(w, o);
  if (!b || !o.seat || !o.seat.district || !b.districts) return leanMargin(w.lean.state, s);
  const dist = bodyDistricts(w, s, b, year), rg = rangesOf(w)[s]!;
  let d = 0, t = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] === o.seat.district) { d += w.lean.bu.dVotes[rg.buStart + i]!; t += w.lean.bu.votes[rg.buStart + i]!; }
  return t > 0 ? 100 * (2 * d / t - 1) : leanMargin(w.lean.state, s);
}

/** A home county for a seat's officeholder or candidate: weighted by eligible voters in the seat's district. */
export function seatHomeCounty(w: World, o: Office, year: number, r: Rng): number | null {
  const s = o.stateIdx!, rg = rangesOf(w)[s]!, b = seatBody(w, o);
  const dist = b && b.districts && o.seat?.district ? bodyDistricts(w, s, b, year) : null;
  const bus: number[] = [], wts: number[] = [];
  for (let i = 0; i < rg.buEnd - rg.buStart; i++) {
    if (dist && dist[i] !== o.seat!.district) continue;
    const v = w.pop.vep[rg.buStart + i]!; if (v > 0) { bus.push(rg.buStart + i); wts.push(v); }
  }
  return bus.length ? w.pack.bu.county[bus[r.weighted(wts)]!]! : null;
}

// ---- Schedules -----------------------------------------------------------------------------------------

/** Whether a seat's regular election (or retention vote) is held in `year`. */
export function seatElectionIn(w: World, o: Office, year: number): boolean {
  const b = seatBody(w, o);
  if (!b || !o.seat || !elected(b)) return false;
  return seatUp(o.seat.cycle, o.seat.termYears, year);
}

/** Whether an appointed seat's term ends in `year` (reappointment or a successor). */
export function seatTermEndsIn(w: World, o: Office, year: number): boolean {
  const b = seatBody(w, o);
  if (!b || !o.seat || elected(b)) return false;
  return seatUp(o.seat.cycle, o.seat.termYears, year);
}

/**
 * The first election year of a seat after an appointment on `day`: the first year of the body's calendar at
 * least a year away (the general election in it); the seat's cycle moves there.
 */
export function firstElectionAfter(b: BodyDef, day: number, govCycle: (y: number) => boolean): number {
  const c = daysToCivil(day);
  for (let y = c.y + 1; y < c.y + 12; y++) {
    if (b.years === 'even' && y % 2 !== 0) continue;
    if (b.years === 'odd' && y % 2 !== 1) continue;
    if (b.years === 'gov' && !govCycle(y)) continue;
    return y;
  }
  return c.y + 2;
}

// ---- First officeholders --------------------------------------------------------------------------------

const BACKGROUND = {
  judge: [[0.42, 'judge of a state trial court', 5], [0.36, 'attorney in private practice', 3], [0.38, 'prosecutor', 2], [0.35, 'law professor', 1]] as [number, string, number][],
  exec: [[0.47, 'state legislator', 4], [0.32, 'county official', 3], [0.27, 'businessperson', 3], [0.3, 'deputy in the office', 2]] as [number, string, number][],
  board: [[0.3, 'teacher and school administrator', 3], [0.27, 'businessperson', 3], [0.32, 'county official', 2], [0.25, 'attorney', 2]] as [number, string, number][],
};
export function backgroundFor(kind: string, r: Rng): { tier: number; text: string } {
  const list = kind === 'justice' || kind === 'appellate_judge' ? BACKGROUND.judge : kind === 'commissioner' || kind === 'education_board' || kind === 'regent' ? BACKGROUND.board : BACKGROUND.exec;
  const bg = list[r.weighted(list.map((x) => x[2]))]!;
  return { tier: bg[0], text: bg[1] };
}

/** Mean age of a body's officeholders when created. */
const AGE_MEAN = (kind: string) => (kind === 'justice' ? 60 : kind === 'appellate_judge' ? 57 : kind === 'commissioner' || kind === 'education_board' || kind === 'regent' ? 56 : 53);

/**
 * Create every state's down-ballot seats and their officeholders (once). Returns the number of seats created.
 * Seats are created in state order and body order, so office ids are the same in every universe of a pack.
 */
export function materializeDownballot(h: DownballotHost): number {
  const w = h.world;
  if (w.offices.some((o) => isDownballot(o.kind))) return 0;
  const now = w.time, today = easternDay(now), year = daysToCivil(today).y;
  const env = (y: number) => w.history.env[y] ?? 0;
  let created = 0;
  for (const st of w.pack.states) {
    const bodies = DOWNBALLOT_2016[st.usps]; if (!bodies) continue;
    const gov = STATES_2016[st.usps]?.governor;
    const govLast = gov?.lastElection ?? 2014;
    const stateMargin = leanMargin(w.lean.state, st.idx);
    for (const b of bodies) {
      const cycles = seatCycles(b, govLast);
      const districts = seatDistricts(b);
      const perDistrict = new Map<number, number>(); for (const d of districts) perDistrict.set(d, (perDistrict.get(d) ?? 0) + 1);
      const counter = new Map<number, number>();
      for (let k = 0; k < b.seats; k++) {
        const district = districts[k]!;
        const nth = (counter.get(district) ?? 0) + 1; counter.set(district, nth);
        const number = b.districts ? nth : k + 1;
        const term = b.termYears > 0 ? b.termYears : 0;
        const o = h.addOffice({ kind: b.kind, title: seatTitle(b, st.name, number, district, perDistrict.get(district)!), stateIdx: st.idx, districtIdx: null, senateClass: null,
          chamberId: null, dept: bodyName(b, st.name), rank: 7000 + created, seat: { body: b.key, number, district, cycle: cycles[k]!, termYears: term } });
        const r = Rng.stream(w.seed, 'downballot', st.usps, b.key, k);
        // The seat's last regular election (or appointment) before now.
        let last = year - 1 - r.int(Math.max(1, Math.min(10, term || 10)));
        if (term > 0) { last = cycles[k]!; while (last > year - 1) last -= term; while (last + term <= year - 1) last += term; }
        const margin = (b.districts && district > 0 ? seatMargin(w, o, year) : stateMargin) + env(Math.max(2006, Math.min(2015, last)));
        const partisanSeat = b.selection === 'partisan' || b.selection === 'party_np' || b.selection === 'partisan_retention';
        const party = margin + r.normal(0, partisanSeat ? 8 : 12) > 0 ? PARTY_D : PARTY_R;
        const bg = backgroundFor(b.kind, r);
        const person = h.newPerson(r, 'B', party, st.idx, { homeCounty: seatHomeCounty(w, o, year, r), ageMean: AGE_MEAN(b.kind), prominence: 0.04, background: bg });
        // Nobody starts past the retirement age.
        if (b.retireAt) {
          const age = ageOn(person.birthDay, today);
          if (age >= b.retireAt - 1) person.birthDay += (age - (b.retireAt - 2 - r.int(10))) * 365;
        }
        const firstYear = term > 0 ? last + (b.start ? 0 : 1) : last;
        const startDay = b.start ? civilToDays(firstYear, b.start[0], b.start[1]) : civilToDays(firstYear, 1, 5);
        const c = daysToCivil(Math.min(startDay, today));
        const start = Math.min(now, zonedToUtc(c.y, c.m, c.d, 12, 0, 'America/New_York'));
        const leg = legislatureName(st.usps);
        const acquired = b.selection === 'appointed' ? `appointed by ${appointerText(b, leg)}`
          : b.selection === 'legislature' ? `elected by the ${leg}`
          : b.selection === 'retention' ? `appointed by ${appointerText(b, leg)}; retained ${last}`
          : b.selection === 'partisan_retention' && r.bernoulli(0.5) ? `elected ${last - term}; retained ${last}`
          : `elected ${last}`;
        h.installTerm(o.id, person, start, acquired);
        created++;
      }
    }
  }
  return created;
}

// ---- Appointments, retirement and reappointment ----------------------------------------------------------

export interface CourtHost {
  world: World;
  newPerson(r: Rng, tier: Person['tier'], party: number, stateIdx: number, opts?: PersonOptions): Person;
  startTerm(officeId: number, person: Person, acquired: string): Term;
  endTerm(officeId: number, reason: string): Term | null;
  vacate(officeId: number, reason: string, resolution?: string): void;
  news(kind: string, headline: string, body: string, refs: Record<string, unknown>): void;
  deferSql(sql: string, params: (string | number | null)[]): void;
  career(personId: number, kind: string, text: string): void;
}

const governorParty = (w: World, s: number): number => { const g = w.offices.find((x) => x.kind === 'governor' && x.stateIdx === s); return (g && w.current.get(g.id)?.partyId) || PARTY_D; };
/** The majority party of a state's legislature (its larger chamber's majority; the governor's party when tied). */
export function legislatureParty(w: World, s: number): number {
  const ch = w.chambers.filter((c) => c.stateIdx === s && (c.kind === 'state_upper' || c.kind === 'state_lower')).sort((a, b) => b.seats - a.seats)[0];
  if (!ch) return governorParty(w, s);
  const d = ch.composition.get(PARTY_D) ?? 0, r = ch.composition.get(PARTY_R) ?? 0;
  return d > r ? PARTY_D : r > d ? PARTY_R : governorParty(w, s);
}
const govCycleOf = (usps: string) => { const g = STATES_2016[usps]?.governor; return (y: number) => !g || ((y - g.lastElection) % g.termYears + g.termYears) % g.termYears === 0; };

/** How a vacancy in a down-ballot seat is resolved, in words. */
export function seatVacancyResolution(w: World, o: Office): string {
  const b = seatBody(w, o); if (!b) return 'Appointment by the Governor';
  const usps = w.pack.states[o.stateIdx!]!.usps;
  const by = `Appointment by ${appointerText(b, legislatureName(usps))}`;
  if (b.kind === 'justice' || b.kind === 'appellate_judge') {
    if (b.selection === 'retention') return `${by}; the appointee then faces a retention vote`;
    if (b.selection === 'appointed' || b.selection === 'legislature') return by;
    return `${by}; the appointee faces voters at the next judicial election`;
  }
  return `${by} until the next regular election`;
}

/** Move a seat's cycle (persisted with the next commit). */
function setCycle(h: CourtHost, o: Office, cycle: number): void {
  if (!o.seat || o.seat.cycle === cycle) return;
  o.seat.cycle = cycle;
  h.deferSql('UPDATE office_seat SET cycle_year = ? WHERE office_id = ?', [cycle, o.id]);
}

/**
 * Fill a vacant down-ballot seat by appointment. The appointing authority's party usually prevails (less often on
 * merit-selection courts); a supreme court vacancy goes to a judge of the state's appellate courts about a third of
 * the time. A judicial appointee's seat moves to its first election (or, on appointed courts, to a full term).
 */
export function fillSeat(h: CourtHost, o: Office, r: Rng): void {
  const w = h.world, s = o.stateIdx!, st = w.pack.states[s]!;
  const b = seatBody(w, o); if (!b) return;
  const leg = legislatureName(st.usps);
  const appointerParty = b.appointer === 'legislature' ? legislatureParty(w, s) : governorParty(w, s);
  const cross = b.appointer === 'commission' ? 0.25 : b.appointer === 'legislature' ? 0.05 : 0.1;
  const party = r.bernoulli(cross) ? (appointerParty === PARTY_D ? PARTY_R : PARTY_D) : appointerParty;
  const how = `appointed by ${appointerText(b, leg)}`;
  const today = easternDay(w.time), year = daysToCivil(today).y;
  let person: Person | null = null;
  if (b.kind === 'justice' && r.bernoulli(0.35)) {
    const pool = w.offices.filter((x) => x.kind === 'appellate_judge' && x.stateIdx === s).map((x) => ({ x, t: w.current.get(x.id) }))
      .filter((p) => p.t && p.t.partyId === party).map((p) => ({ x: p.x, p: w.persons.get(p.t!.personId)! })).filter((p) => p.p.deathDay === null && (!b.retireAt || ageOn(p.p.birthDay, today) < b.retireAt - 2));
    if (pool.length) {
      const pick = pool[r.weighted(pool.map((p) => Math.exp(2 * p.p.traits.recognition + p.p.traits.leadership)))]!;
      h.endTerm(pick.x.id, `elevated to the ${bodyName(b, st.name)}`);
      person = pick.p;
      h.vacate(pick.x.id, `${pick.p.given} ${pick.p.surname} was elevated to the ${bodyName(b, st.name)}`);
    }
  }
  if (!person) {
    const bg = backgroundFor(b.kind, r);
    person = h.newPerson(r, 'B', party, s, { homeCounty: seatHomeCounty(w, o, year, r), ageMean: AGE_MEAN(b.kind) - 4, prominence: 0.04, background: bg });
    if (b.retireAt) { const age = ageOn(person.birthDay, today); if (age >= b.retireAt - 4) person.birthDay += (age - (b.retireAt - 6 - r.int(12))) * 365; }
  }
  h.startTerm(o.id, person, how);
  const judicial = b.kind === 'justice' || b.kind === 'appellate_judge';
  if (judicial && o.seat) {
    if (elected(b)) setCycle(h, o, firstElectionAfter(b, today, govCycleOf(st.usps)));
    else if (b.termYears > 0) setCycle(h, o, year + b.termYears);
  }
  h.news('appointment', `${person.given} ${person.surname} named to the ${judicial || b.seats > 1 ? bodyName(b, st.name) : o.title}`,
    `${person.given} ${person.surname} (${party === PARTY_D ? 'D' : party === PARTY_R ? 'R' : 'I'}) was ${how}${judicial && elected(b) && o.seat ? `; the seat is next on the ballot in ${o.seat.cycle}` : ''}.`, { personId: person.id, officeId: o.id });
}

/** The first of each month: judges at the mandatory retirement age leave the bench. */
export function courtsMonthly(h: CourtHost, day: number): void {
  const w = h.world;
  for (const o of w.offices) {
    if (o.kind !== 'justice' && o.kind !== 'appellate_judge') continue;
    const b = seatBody(w, o); if (!b?.retireAt) continue;
    const t = w.current.get(o.id); if (!t) continue;
    const p = w.persons.get(t.personId); if (!p || p.deathDay !== null) continue;
    if (ageOn(p.birthDay, day) < b.retireAt) continue;
    h.endTerm(o.id, 'reached the mandatory retirement age');
    h.career(p.id, 'retirement', `Retired from the ${bodyName(b, w.pack.states[o.stateIdx!]!.name)} at the mandatory retirement age of ${b.retireAt}`);
    h.news('retirement', `${p.given} ${p.surname} retires from the ${bodyName(b, w.pack.states[o.stateIdx!]!.name)}`, `${o.title} ${p.given} ${p.surname} reached the mandatory retirement age of ${b.retireAt}.`, { personId: p.id, officeId: o.id });
    h.vacate(o.id, 'mandatory retirement');
  }
}

/**
 * January 1: on appointed courts, terms ending this year are renewed (the usual outcome) or the judge steps down;
 * a judge appointed by the other party, or near the retirement age, is less often renewed.
 */
export function courtsYearStart(h: CourtHost, year: number): void {
  const w = h.world;
  for (const o of w.offices) {
    if ((o.kind !== 'justice' && o.kind !== 'appellate_judge') || !seatTermEndsIn(w, o, year)) continue;
    const b = seatBody(w, o)!; const t = w.current.get(o.id);
    const r = Rng.stream(w.seed, 'reappoint', o.id, year);
    if (!t) { setCycle(h, o, year + b.termYears); continue; }
    const p = w.persons.get(t.personId)!;
    const s = o.stateIdx!, party = b.appointer === 'legislature' ? legislatureParty(w, s) : governorParty(w, s);
    const age = ageOn(p.birthDay, easternDay(w.time));
    const pRenew = 0.88 * (t.partyId === party ? 1 : 0.7) * (b.retireAt && age > b.retireAt - 4 ? 0.4 : age > 72 ? 0.5 : 1);
    if (r.bernoulli(pRenew)) {
      setCycle(h, o, year + b.termYears);
      h.career(p.id, 'reappointed', `Reappointed to the ${bodyName(b, w.pack.states[s]!.name)} for a ${b.termYears}-year term`);
      continue;
    }
    h.endTerm(o.id, 'term ended; not reappointed');
    h.news('retirement', `${p.given} ${p.surname} leaves the ${bodyName(b, w.pack.states[s]!.name)}`, `${o.title} ${p.given} ${p.surname} was not reappointed when the term ended.`, { personId: p.id, officeId: o.id });
    setCycle(h, o, year + b.termYears);
    h.vacate(o.id, 'term ended');
  }
}
