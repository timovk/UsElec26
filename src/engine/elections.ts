/**
 * The election engine: calendar, candidate emergence, primaries, generals, runoffs, specials, the Electoral
 * College and assumption of office. Elections exist only because office terms and the 2016 legal baseline
 * require them. Results come from the shared-electorate ballot kernel and are archived immutably.
 */
import { Rng } from '../core/rng';
import { MINUTES_PER_DAY, ageOn, civilToDays, daysToCivil, easternDay, formatDay, formatTime, generalElectionDay, weekday, zonedToUtc, type DayNumber, type SimTime } from '../core/time';
import type { Db } from '../persistence/db';
import { NONE16, cdCode } from '../geo/pack';
import { PARTY_D, PARTY_G, PARTY_L, PARTY_R, SIMULATED, fullName, type Office, type OfficeKind, type Person, type Term } from '../institutions/model';
import { SENATE_CLASS_NEXT_ELECTION, STATES_2016 } from '../rules/states2016';
import { DISTRICT_EV_STATES, ELECTION_RULES_2016, ELECTORS_MEET, electoralVotes, ruleDay } from '../rules/elections2016';
import { cohortClasses } from '../electorate/kernel';
import { buildShard, stateRanges, type StateRange } from '../electorate/shards';
import { TURNOUT_OFFSET, calibrateTurnout, drawEnvironment, stepEnvironment, type Environment } from '../electorate/environment';
import { certifiedFromCast, prepareContest, prepareDerived, prepareRejected, prepareRollup, prepareTurnout, readRollup, writeContest, writeTotalsRevision, K, totalsOf, type ContestResult } from '../archive/results';
import { crc32 } from '../core/codec';
import type { ShardRunner } from './computePool';
import type { JobInput, SealedContest } from './nightJob';
import { buildNightInput, nationalPriorError, nightRaces } from './nightSetup';
import { nightStory } from './nightStory';
import { Season, type SeasonState } from './season';
import { Nomination } from './nomination';
import { CAUCUS_TURNOUT_OFFSET } from '../rules/primaries2016';
import { buildParts } from '../counting/precincts';
import { decodeNightRecord, encodeNightRecord, mergeNights, type ChamberBase, type ControlEvent, type NightRecord, type RaceMeta } from '../counting/record';
import { MODE_PROV, ST_CALLED, ST_WITHDRAWN, type StateNight } from '../counting/types';
import { COUNTING_RULES_2016 } from '../rules/counting2016';
import { aggregate, candidateQuality, heldKinds, kernelContest, packGeo, type CandidacyRow, type ContestRow } from './electionModel';
import type { World } from './world';
import { leanMargin } from './world';

export interface PersonOptions { homeCounty?: number | null; ageMean?: number; prominence?: number; background?: { tier: number; text: string } }

export interface ElectionHost {
  readonly world: World; readonly db: Db; readonly runner: ShardRunner;
  schedule(time: SimTime, kind: string, data: Record<string, unknown>, priority?: number): void;
  news(kind: string, headline: string, body: string, refs: Record<string, unknown>, time?: SimTime): void;
  newPerson(r: Rng, tier: Person['tier'], party: number, stateIdx: number, opts?: PersonOptions): Person;
  startTerm(officeId: number, person: Person, acquired: string, provenance?: string): Term;
  endTerm(officeId: number, reason: string): Term | null;
  succession(officeId: number, departed: Person): void;
  vacate(officeId: number, reason: string, resolution?: string): void;
  commit(extra?: () => void): void;
  progress(step: string, fraction: number): void;
}

/** Persistent election-engine state (stored as a state blob). */
export interface ElectionState { tauE: number | null; turnoutTarget: number | null; env: Record<string, Environment>; plannedYears: number[]; season?: SeasonState }

const ET = 'America/New_York' as const;
const at = (day: DayNumber, h: number, m = 0): SimTime => { const c = daysToCivil(day); return zonedToUtc(c.y, c.m, c.d, h, m, ET); };
const formatTimeET = (t: SimTime) => formatTime(t, ET);
const PARTY_NAME: Record<number, string> = { 1: 'Democratic', 2: 'Republican', 3: 'Libertarian', 4: 'Green', 5: 'Independent' };
const PARTY_PLURAL: Record<number, string> = { 1: 'Democrats', 2: 'Republicans', 3: 'Libertarians', 4: 'Greens', 5: 'Independents' };
/** Ballot order on general-election ballots: Democrat, Republican, then minor parties and independents. */
const BALLOT_ORDER = (party: number) => ({ 1: 0, 2: 1, 3: 13, 4: 14, 5: 15 } as Record<number, number>)[party] ?? 20;
const STATEWIDE: OfficeKind[] = ['governor', 'lt_governor', 'attorney_general', 'secretary_of_state'];

interface Race { office: Office; special: boolean; termStart: SimTime }

export class ElectionEngine {
  readonly ranges: StateRange[];
  private classes: ReturnType<typeof cohortClasses> | null = null;
  readonly season: Season;
  readonly nomination: Nomination;
  constructor(private readonly h: ElectionHost, public state: ElectionState) { this.ranges = stateRanges(h.world.pack); this.season = new Season(this); this.nomination = new Nomination(this); }
  get host(): ElectionHost { return this.h; }

  get w(): World { return this.h.world; }
  get db(): Db { return this.h.db; }
  private rng(...key: (string | number)[]): Rng { return Rng.stream(this.w.seed, 'elections', ...key); }
  get cls() { return (this.classes ??= cohortClasses(this.w.electorate.params)); }

  // ---- Calendar --------------------------------------------------------------------------------

  /** Term start of the office's next regular term after an election in `year`. */
  termStart(o: Office, year: number): SimTime {
    if (o.kind === 'president' || o.kind === 'vice_president') return zonedToUtc(year + 1, 1, 20, 12, 0, ET);
    if (o.kind === 'us_senator' || o.kind === 'us_representative') return zonedToUtc(year + 1, 1, 3, 12, 0, ET);
    const usps = this.w.pack.states[o.stateIdx!]!.usps;
    const rule = ELECTION_RULES_2016[usps]!.inauguration;
    const y = rule.sameYear ? year : year + 1;
    const c = daysToCivil(ruleDay(y, rule));
    return zonedToUtc(c.y, c.m, c.d, 12, 0, ET);
  }

  /** Regular races in a year, from office terms and the legal schedule. */
  regularRaces(year: number): Race[] {
    const out: Race[] = [];
    for (const o of this.w.offices) {
      let up = false;
      if (o.kind === 'president') up = year % 4 === 0;
      else if (o.kind === 'us_senator') up = ((year - SENATE_CLASS_NEXT_ELECTION[o.senateClass!]!) % 6 + 6) % 6 === 0;
      else if (o.kind === 'us_representative') up = year % 2 === 0;
      else if (STATEWIDE.includes(o.kind)) {
        const inst = STATES_2016[this.w.pack.states[o.stateIdx!]!.usps];
        const g = inst?.governor; if (!g) continue;
        if (o.kind === 'lt_governor' && inst.ltGov !== 'separate') continue;
        if (o.kind === 'attorney_general' && !inst.agElected) continue;
        if (o.kind === 'secretary_of_state' && inst.sos !== 'elected') continue;
        up = ((year - g.lastElection) % g.termYears + g.termYears) % g.termYears === 0;
      }
      if (up) out.push({ office: o, special: false, termStart: this.termStart(o, year) });
    }
    return out;
  }

  private insertElection(day: DayNumber, kind: string, stateIdx: number | null, partyId: number | null, year: number, label: string): number {
    this.db.run('INSERT INTO election(day, kind, state_idx, party_id, year, label, status, held_time, env_json) VALUES (?,?,?,?,?,?,?,?,?)', [day, kind, stateIdx, partyId, year, label, 'scheduled', null, null]);
    return Number(this.db.value('SELECT last_insert_rowid()'));
  }

  private electionOf(year: number, kind: string, stateIdx: number | null, partyId: number | null = null): number | null {
    return this.db.value<number>('SELECT election_id FROM election WHERE year = ? AND kind = ? AND state_idx IS ? AND party_id IS ? ORDER BY election_id LIMIT 1', [year, kind, stateIdx, partyId]) ?? null;
  }

  /** Plan the year's elections: create election rows and schedule filing, primaries and the general. */
  planYear(year: number): void {
    if (this.state.plannedYears.includes(year)) return;
    const w = this.w, now = w.time;
    const races = this.regularRaces(year);
    const pending = this.db.all<{ office_id: number }>('SELECT office_id FROM pending_special');
    const statesWith = new Set<number>(races.filter((r) => r.office.stateIdx !== null).map((r) => r.office.stateIdx!));
    for (const p of pending) { const o = w.officeById.get(p.office_id); if (o?.stateIdx !== null && o) statesWith.add(o.stateIdx!); }
    const presYear = year % 4 === 0;
    const gDay = generalElectionDay(year);
    if (presYear) for (const s of w.pack.states) statesWith.add(s.idx);
    if (!statesWith.size) { this.state.plannedYears.push(year); this.h.schedule(at(civilToDays(year + 1, 1, 1), 0, 5), 'plan_year', { year: year + 1 }, 1); return; }
    // Environment for the year's November cycle (shared by its primaries); keep only recent cycles in state.
    this.environmentFor(year);
    for (const k of Object.keys(this.state.env)) if (Number(k) < year - 3) delete this.state.env[k];
    this.state.plannedYears = this.state.plannedYears.filter((y) => y >= year - 3);
    this.h.commit(() => {
      for (const s of [...statesWith].sort((a, b) => a - b)) {
        const st = w.pack.states[s]!, rules = ELECTION_RULES_2016[st.usps]!;
        this.insertElection(gDay, 'general', s, null, year, `${year} ${st.name} general election`);
        const jungle = rules.primaryType === 'jungle';
        const stateRaces = races.filter((r) => r.office.stateIdx === s);
        const hasRaces = stateRaces.length > 0 || pending.some((p) => w.officeById.get(p.office_id)?.stateIdx === s);
        if (!jungle && hasRaces) {
          const pDay = Math.max(ruleDay(year, rules.primary), easternDay(now) + 7);
          const pid = this.insertElection(pDay, 'primary', s, null, year, `${year} ${st.name} primary election`);
          this.h.schedule(Math.max(now, at(pDay - 75, 9)), 'filing', { year, state: s }, 5);
          this.h.schedule(at(pDay, 21), 'primary', { election: pid }, 6);
        } else if (hasRaces) this.h.schedule(Math.max(now, at(gDay - 100, 9)), 'filing', { year, state: s }, 5);
      }
      if (presYear) {
        // The nominations are decided at each party's convention (Republicans the third Monday of July, Democrats the last).
        for (const p of [PARTY_D, PARTY_R]) {
          const cDay = Math.max(ruleDay(year, { month: 7, weekday: 1, nth: p === PARTY_R ? 3 : 'last' }), easternDay(now) + 30);
          this.insertElection(cDay, 'pres_nomination', null, p, year, `${year} ${PARTY_NAME[p]} presidential nomination`);
          this.h.schedule(at(cDay, 22), 'nomination_convention', { year, party: p }, 5);
        }
        this.h.schedule(Math.max(now, at(civilToDays(year, 1, 2), 9)), 'pres_filing', { year }, 4);
        this.h.schedule(at(civilToDays(year, 7, 28), 21), 'convention', { year }, 5);
        this.h.schedule(at(ELECTORS_MEET(year), 12), 'electors', { year }, 5);
        this.h.schedule(zonedToUtc(year + 1, 1, 6, 13, 0, ET), 'ec_count', { year }, 5);
      }
      this.h.schedule(at(gDay, 6), 'general', { year, day: gDay }, 6);
      this.state.plannedYears.push(year);
    });
    this.h.schedule(at(civilToDays(year + 1, 1, 1), 0, 5), 'plan_year', { year: year + 1 }, 1);
    const n = statesWith.size;
    this.h.news('calendar', `${year} election calendar set`, `${presYear ? 'A presidential election year. ' : ''}Elections are scheduled in ${n} state${n === 1 ? '' : 's'}; the general election is ${formatDay(gDay, true)}.`, {});
  }

  /** The daily process (06:00 ET): the environment's daily step, then campaigns, polls and forecasts. */
  async daily(day: DayNumber): Promise<void> {
    const year = daysToCivil(day).y;
    const env = this.state.env[String(year)];
    if (env) stepEnvironment(this.w.seed, env, day);
    if (year % 4 === 0 && this.state.plannedYears.includes(year)) this.nomination.daily(year, day);
    await this.season.daily(day);
  }

  environmentFor(year: number): Environment {
    const key = String(year);
    if (this.state.env[key]) { stepEnvironment(this.w.seed, this.state.env[key], easternDay(this.w.time)); return this.state.env[key]; }
    const prev = this.state.env[String(year - 2)] ?? this.state.env[String(year - 1)] ?? null;
    const presTerm = this.w.current.get(this.w.offices.find((o) => o.kind === 'president')!.id);
    const presParty = presTerm?.partyId ?? PARTY_D;
    const termsHeld = this.partyWhiteHouseTerms(presParty);
    const env = drawEnvironment(this.w.seed, year, this.w.pack, prev, { presParty, termsHeld, midterm: year % 4 === 2 });
    stepEnvironment(this.w.seed, env, easternDay(this.w.time));
    this.state.env[key] = env;
    return env;
  }

  private partyWhiteHouseTerms(party: number): number {
    const pres = this.w.offices.find((o) => o.kind === 'president')!;
    const rows = this.db.all<{ party_id: number }>('SELECT party_id FROM office_term WHERE office_id = ? ORDER BY start_time DESC, term_id DESC', [pres.id]);
    let years = 0;
    const pre = this.w.history.presidentTermNumber;
    for (const r of rows) { if (r.party_id !== party) break; years++; }
    return Math.max(years, rows.length <= 1 ? pre : 0);
  }

  // ---- Candidate emergence -----------------------------------------------------------------------

  /** One candidacy per person per year, derived from the archive so it survives save and reload. */
  private runCache: { year: number; ids: Set<number> } | null = null;
  private runningIn(year: number): Set<number> {
    if (this.runCache?.year !== year) {
      const ids = new Set(this.db.all<{ person_id: number }>('SELECT DISTINCT k.person_id FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id WHERE c.year = ?', [year]).map((r) => r.person_id));
      this.runCache = { year, ids };
    }
    return this.runCache.ids;
  }

  quality(p: Person, background = 0): number { return candidateQuality(p, heldKinds(this.w.current, this.w.officeById, p.id), background); }

  /** Consecutive terms the person has served in an office (for term limits). */
  private consecutiveTerms(o: Office, p: Person, year: number): number {
    const t = this.w.current.get(o.id);
    if (o.kind === 'president') return this.w.history.presidentTermNumber > 0 && t?.provenance !== SIMULATED ? this.w.history.presidentTermNumber
      : this.db.value<number>("SELECT COUNT(*) FROM office_term WHERE office_id = ? AND person_id = ? AND acquired LIKE 'elected%'", [o.id, p.id]) ?? 1;
    const since = this.db.value<number>("SELECT year_from FROM career_event WHERE person_id = ? AND kind = 'current_office' ORDER BY event_id LIMIT 1", [p.id]);
    const first = this.db.value<number>('SELECT MIN(start_time) FROM office_term WHERE office_id = ? AND person_id = ?', [o.id, p.id]);
    const firstYear = Math.min(since ?? 9999, first !== undefined && first !== null ? daysToCivil(easternDay(first)).y : 9999);
    const termYears = STATES_2016[this.w.pack.states[o.stateIdx!]!.usps]?.governor?.termYears ?? 4;
    return Math.max(1, Math.ceil((year + 1 - firstYear) / termYears));
  }

  private termLimited(o: Office, p: Person, year: number): boolean {
    if (o.kind === 'president') return this.consecutiveTerms(o, p, year) >= 2;
    if (o.kind !== 'governor') return false;
    const tl = STATES_2016[this.w.pack.states[o.stateIdx!]!.usps]?.governor?.termLimit;
    if (!tl || tl.kind === 'none') return false;
    const n = this.consecutiveTerms(o, p, year);
    if (tl.kind === 'window') return n * 4 >= tl.years;
    return n >= tl.terms;
  }

  stateMargin(s: number, year: number): number {
    const env = this.environmentFor(year);
    return leanMargin(this.w.lean.state, s) + 100 * 0.17 * env.national * 2;
  }
  cdMargin(cd: number, year: number): number {
    const env = this.environmentFor(year);
    return leanMargin(this.w.lean.cd, cd) + 100 * 0.17 * env.national * 2;
  }
  private prospects(party: number, margin: number): number { return 1 / (1 + Math.exp(-(party === PARTY_D ? margin : -margin) / 8)); }

  private homeCountyIn(r: Rng, stateIdx: number, cd: number | null): number | null {
    const rg = this.ranges[stateIdx]!; const bus: number[] = [], wts: number[] = [];
    for (let b = rg.buStart; b < rg.buEnd; b++) { if (cd !== null && this.w.pack.bu.cd[b] !== cd) continue; const v = this.w.pop.vep[b]!; if (v > 0) { bus.push(b); wts.push(v); } }
    return bus.length ? this.w.pack.bu.county[bus[r.weighted(wts)]!]! : null;
  }

  private newCandidate(r: Rng, party: number, stateIdx: number, cd: number | null, prominence: number, year: number): { person: Person; quality: number } {
    const bgs: [number, string, number][] = [[0.47, 'state legislator', 45], [0.4, 'mayor', 12], [0.32, 'county official', 13], [0.3, 'prosecutor', 7], [0.27, 'businessperson', 15], [0.22, 'veteran and community leader', 8]];
    const bg = bgs[r.weighted(bgs.map((b) => b[2]))]!;
    const since = year - 2 - r.int(10);
    const person = this.h.newPerson(r, 'B', party, stateIdx, { homeCounty: this.homeCountyIn(r, stateIdx, cd), prominence, background: { tier: bg[0], text: `${bg[1][0]!.toUpperCase()}${bg[1].slice(1)} (${since}–${year})` } });
    return { person, quality: this.quality(person, bg[0]) };
  }

  /** Candidate emergence for a state's races of the year; creates general, primary and minor-party candidacies. */
  filing(year: number, stateIdx: number): void {
    const w = this.w; const st = w.pack.states[stateIdx]!; const rules = ELECTION_RULES_2016[st.usps]!;
    const generalId = this.electionOf(year, 'general', stateIdx);
    if (generalId === null) return;
    const primaryId = this.electionOf(year, 'primary', stateIdx);
    const races = this.regularRaces(year).filter((r) => r.office.stateIdx === stateIdx);
    for (const p of this.db.all<{ office_id: number }>('SELECT office_id FROM pending_special')) {
      const o = w.officeById.get(p.office_id);
      if (o && o.stateIdx === stateIdx && !races.some((r) => r.office.id === o.id)) races.push({ office: o, special: true, termStart: 0 });
    }
    // Higher offices first, so ambitious officeholders vacate lower seats before those races are filled.
    const order: Record<string, number> = { us_senator: 0, governor: 1, lt_governor: 2, attorney_general: 3, secretary_of_state: 4, us_representative: 5 };
    races.sort((a, b) => order[a.office.kind]! - order[b.office.kind]! || a.office.id - b.office.id);
    const contestsCreated: string[] = [];
    this.h.commit(() => {
      for (const race of races) {
        if (race.office.kind === 'president') continue;
        const o = race.office, r = this.rng('filing', year, o.id);
        const cd = o.kind === 'us_representative' ? o.districtIdx : null;
        const margin = cd !== null ? this.cdMargin(cd, year) : this.stateMargin(stateIdx, year);
        const method = rules.primaryType === 'jungle' ? 'jungle' : st.usps === 'GA' ? 'majority' : rules.primaryType === 'top_two' ? 'top_two_general' : 'plurality';
        const label = `${year}${race.special ? ' special' : ''} ${o.title.replace('U.S. Representative, ', 'U.S. House, ')}`;
        this.db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [generalId, o.id, race.special ? 'special' : 'general', null, stateIdx, cd, method, label, 'filing', null, null, race.special ? null : race.termStart, null, null, null, year]);
        const general = Number(this.db.value('SELECT last_insert_rowid()'));
        if (race.special) this.db.run('DELETE FROM pending_special WHERE office_id = ?', [o.id]);
        // Incumbent decision.
        const inc = w.current.get(o.id);
        const incP = inc ? w.persons.get(inc.personId)! : null;
        let incumbentRuns = false;
        if (incP && !this.runningIn(year).has(incP.id) && !this.termLimited(o, incP, year)) {
          const age = ageOn(incP.birthDay, easternDay(w.time));
          const hostile = Math.max(0, ((incP.partyId === PARTY_D ? -margin : margin)) / 100);
          const base = o.kind === 'us_representative' ? 0.06 : o.kind === 'us_senator' ? 0.09 : 0.1;
          const pRetire = Math.min(0.9, base + Math.max(0, age - 68) * 0.035 + hostile * 0.25 + (incP.traits.integrity < 0.15 ? 0.1 : 0));
          incumbentRuns = !r.bernoulli(pRetire);
          if (!incumbentRuns) this.h.news('retirement', `${fullName(incP)} will not seek re-election`, `${o.title} ${fullName(incP)} (${this.abbr(incP.partyId)}) announced retirement at age ${age}.`, { personId: incP.id });
        }
        const field = new Map<number, { person: Person; quality: number; incumbent: boolean }[]>([[PARTY_D, []], [PARTY_R, []]]);
        if (incP && incumbentRuns && field.has(incP.partyId)) { field.get(incP.partyId)!.push({ person: incP, quality: this.quality(incP), incumbent: true }); this.runningIn(year).add(incP.id); }
        for (const party of [PARTY_D, PARTY_R]) {
          const pr = this.prospects(party, margin);
          const hasInc = incumbentRuns && incP?.partyId === party;
          const opposingInc = incumbentRuns && incP && incP.partyId !== party;
          // Ambitious officeholders in the state (for Senate and statewide offices).
          if (o.kind !== 'us_representative') {
            for (const off of w.offices) {
              if (off.stateIdx !== stateIdx || off.id === o.id) continue;
              if (!['us_representative', 'lt_governor', 'attorney_general', 'secretary_of_state', 'governor', 'state_leg_leader', 'us_senator'].includes(off.kind)) continue;
              if (o.kind !== 'us_senator' && o.kind !== 'governor' && off.kind !== 'state_leg_leader') continue;
              const t = w.current.get(off.id); if (!t || t.partyId !== party) continue;
              const p = w.persons.get(t.personId)!; if (this.runningIn(year).has(p.id) || p.deathDay !== null) continue;
              let pRun = 0.015 + 0.4 * p.traits.ambition * (hasInc ? 0.08 : opposingInc ? 0.35 : 1) * pr;
              if (off.kind === 'governor' || off.kind === 'us_senator') pRun *= 0.35;
              if (off.kind === 'us_representative' && o.kind === 'governor') pRun *= 0.6;
              if (ageOn(p.birthDay, easternDay(w.time)) > 74) pRun *= 0.2;
              if (r.bernoulli(Math.min(0.85, pRun))) { field.get(party)!.push({ person: p, quality: this.quality(p), incumbent: false }); this.runningIn(year).add(p.id); }
            }
          }
          // Newcomers to fill out the field.
          const want = hasInc ? (r.bernoulli(0.12) ? 1 : 0)
            : opposingInc ? (r.bernoulli(o.kind === 'us_representative' ? 0.8 + 0.2 * Math.min(1, pr * 3) : 0.98) ? 1 + Math.floor(r.float() * (1 + 2.5 * pr)) : 0)
            : (r.bernoulli(o.kind === 'us_representative' ? 0.86 + 0.14 * Math.min(1, pr * 3) : 0.99) ? 1 + Math.floor(r.float() * (1.5 + 3 * pr)) : 0);
          const have = field.get(party)!.filter((x) => !x.incumbent).length;
          for (let i = have; i < want; i++) {
            const c = this.newCandidate(r, party, stateIdx, cd, 0.08 + 0.1 * r.float(), year);
            field.get(party)!.push({ ...c, incumbent: false });
            this.runningIn(year).add(c.person.id);
          }
        }
        // Minor parties and independents go straight to the general ballot.
        const minors: { person: Person; quality: number; party: number }[] = [];
        const pMinor = o.kind === 'us_representative' ? [0.3, 0.08, 0.04] : o.kind === 'us_senator' || o.kind === 'governor' ? [0.55, 0.2, 0.06] : [0.35, 0.1, 0.02];
        [PARTY_L, PARTY_G, 5].forEach((party, i) => {
          if (!r.bernoulli(pMinor[i]!)) return;
          const c = this.newCandidate(r, party, stateIdx, cd, 0.03, year);
          minors.push({ ...c, party });
        });
        // Nomination: top-two and jungle put every candidate on one ballot.
        const insertCand = (contest: number, p: Person, party: number, order: number, incumbent: boolean, quality: number, status: string) =>
          this.db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [contest, p.id, party, order, incumbent ? 1 : 0, null, status, quality]);
        const everyone = [...field.get(PARTY_D)!.map((x) => ({ ...x, party: PARTY_D })), ...field.get(PARTY_R)!.map((x) => ({ ...x, party: PARTY_R }))];
        if (method === 'jungle' || race.special && method !== 'top_two_general') {
          // Jungle (Louisiana) and special elections: no separate primary in Phase 2 — every candidate on the general ballot.
          const all = method === 'jungle' ? [...everyone, ...minors.map((m) => ({ ...m, incumbent: false }))] : [...this.trimForSpecial(everyone), ...minors.map((m) => ({ ...m, incumbent: false }))];
          all.forEach((c, i) => insertCand(general, c.person, c.party, i, c.incumbent, c.quality, 'running'));
          this.db.run("UPDATE contest SET status = 'set' WHERE contest_id = ?", [general]);
        } else if (method === 'top_two_general' && primaryId !== null) {
          const all = [...everyone, ...minors.map((m) => ({ ...m, incumbent: false }))];
          if (all.length <= 2) { all.forEach((c, i) => insertCand(general, c.person, c.party, i, c.incumbent, c.quality, 'running')); this.db.run("UPDATE contest SET status = 'set' WHERE contest_id = ?", [general]); }
          else {
            this.db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              [primaryId, o.id, 'top_two', null, stateIdx, cd, 'top_two', `${label} top-two primary`, 'set', null, null, null, null, general, null, year]);
            const prim = Number(this.db.value('SELECT last_insert_rowid()'));
            all.forEach((c, i) => insertCand(prim, c.person, c.party, i, c.incumbent, c.quality, 'running'));
          }
        } else {
          for (const party of [PARTY_D, PARTY_R]) {
            const f = field.get(party)!;
            if (f.length === 1) { insertCand(general, f[0]!.person, party, BALLOT_ORDER(party), f[0]!.incumbent, f[0]!.quality, 'running'); if (o.kind === 'governor') this.pickRunningMate(general, f[0]!.person, stateIdx, year); }
            else if (f.length > 1 && primaryId !== null) {
              const runoff = rules.primaryRunoff;
              this.db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [primaryId, o.id, 'primary', party, stateIdx, cd, runoff ? `runoff_${runoff.threshold}` : 'plurality', `${label} ${PARTY_NAME[party]} primary`, 'set', null, null, null, null, general, null, year]);
              const prim = Number(this.db.value('SELECT last_insert_rowid()'));
              f.forEach((c, i) => insertCand(prim, c.person, party, i, c.incumbent, c.quality, 'running'));
            }
          }
          minors.forEach((m) => insertCand(general, m.person, m.party, BALLOT_ORDER(m.party), false, m.quality, 'running'));
        }
        contestsCreated.push(label);
      }
    });
    if (contestsCreated.length) this.h.news('filing', `Candidate filing closes in ${st.name}`, `${contestsCreated.length} race${contestsCreated.length === 1 ? '' : 's'} on the ${year} ballot.`, { state: stateIdx });
  }

  private trimForSpecial<T extends { party: number; quality: number; incumbent: boolean }>(xs: T[]): T[] {
    // Special elections without primaries: each party's strongest candidate is nominated by the party.
    return [PARTY_D, PARTY_R].flatMap((p) => xs.filter((x) => x.party === p).sort((a, b) => Number(b.incumbent) - Number(a.incumbent) || b.quality - a.quality).slice(0, 1));
  }

  private abbr(p: number): string { return ({ 1: 'D', 2: 'R', 3: 'L', 4: 'G', 5: 'I' } as Record<number, string>)[p] ?? '?'; }

  /** Governor nominees in joint-ticket states choose a lieutenant-governor running mate. */
  private pickRunningMate(generalContest: number, nominee: Person, stateIdx: number, year: number): void {
    const inst = STATES_2016[this.w.pack.states[stateIdx]!.usps];
    if (inst?.ltGov !== 'joint') return;
    const r = this.rng('lg-mate', year, nominee.id);
    const mate = this.newCandidate(r, nominee.partyId, stateIdx, null, 0.1, year).person;
    this.db.run('UPDATE candidacy SET running_mate = ? WHERE contest_id = ? AND person_id = ?', [mate.id, generalContest, nominee.id]);
  }

  // ---- Presidential nomination ---------------------------------------------------------------------

  presFiling(year: number): void {
    const w = this.w;
    const presOffice = w.offices.find((o) => o.kind === 'president')!;
    const inc = w.current.get(presOffice.id); const incP = inc ? w.persons.get(inc.personId)! : null;
    const r = this.rng('pres-filing', year);
    this.h.commit(() => {
      for (const party of [PARTY_D, PARTY_R]) {
        const eid = this.electionOf(year, 'pres_nomination', null, party);
        if (eid === null) continue;
        if (incP && incP.partyId === party && !this.termLimited(presOffice, incP, year) && ageOn(incP.birthDay, easternDay(w.time)) < 80 && r.bernoulli(0.92)) {
          this.db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [eid, presOffice.id, 'pres_nomination', party, null, null, 'unopposed', `${year} ${PARTY_NAME[party]} presidential nomination`, 'decided', null, null, null, null, null, null, year]);
          const cid = Number(this.db.value('SELECT last_insert_rowid()'));
          this.db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [cid, incP.id, party, 0, 1, null, 'won', this.quality(incP)]);
          this.db.run('UPDATE contest SET winner_candidacy = last_insert_rowid() WHERE contest_id = ?', [cid]);
          this.db.run("UPDATE election SET status = 'held' WHERE election_id = ?", [eid]);
          this.runningIn(year).add(incP.id);
          this.season.st.presumptive[`${year}:${party}`] = incP.id;
          this.h.news('nomination', `President ${fullName(incP)} will seek a second term`, `The ${PARTY_NAME[party]} nomination is effectively uncontested.`, { personId: incP.id });
          continue;
        }
        // An open field: national figures of the party, weighted by prominence and ambition.
        const pool: { p: Person; q: number }[] = [];
        for (const o of w.offices) {
          if (!['vice_president', 'us_senator', 'governor', 'us_representative', 'cabinet'].includes(o.kind)) continue;
          const t = w.current.get(o.id); if (!t || t.partyId !== party) continue;
          const p = w.persons.get(t.personId)!; if (p.deathDay !== null || this.runningIn(year).has(p.id)) continue;
          const age = ageOn(p.birthDay, easternDay(w.time)); if (age < 35 || age > 78) continue;
          const weight = (o.kind === 'vice_president' ? 6 : o.kind === 'governor' ? 1.4 : o.kind === 'us_senator' ? 1.2 : o.kind === 'cabinet' ? 0.5 : 0.12) * p.traits.ambition * (0.3 + p.traits.recognition);
          if (r.bernoulli(Math.min(0.9, 0.06 * weight))) pool.push({ p, q: this.quality(p) });
        }
        pool.sort((a, b) => b.q - a.q || a.p.id - b.p.id);
        const field = pool.slice(0, 4 + r.int(6));
        while (field.length < 3) { const c = this.newCandidate(r, party, r.weighted(w.pack.states.map((_, s) => w.pop.stateVep[s]!)), null, 0.35, year); field.push({ p: c.person, q: Math.max(c.quality, 0.55) }); }
        // An outsider or two (business figures, activists) often join an open field.
        for (let k = r.bernoulli(0.5) ? 1 : 0; k > 0; k--) { const c = this.newCandidate(r, party, r.weighted(w.pack.states.map((_, s) => w.pop.stateVep[s]!)), null, 0.6, year); field.push({ p: c.person, q: Math.max(c.quality, 0.45) }); }
        this.nomination.createSeason(year, party, field, eid);
        field.forEach((c) => this.runningIn(year).add(c.p.id));
        this.h.news('nomination', `${field.length} candidates seek the ${PARTY_NAME[party]} presidential nomination`, field.map((c) => fullName(c.p)).join(', ') + '.', {});
      }
    });
  }

  /** A party's nominating convention (Phase 5 seasons): the nominee is chosen by the delegates. */
  nominationConvention(year: number, party: number): void {
    const day = easternDay(this.w.time);
    if (!this.db.value<number>("SELECT 1 FROM contest WHERE kind = 'pres_nomination' AND year = ? AND party_id = ? AND method = 'delegates' AND status = 'set'", [year, party])) return;
    this.h.commit(() => { this.nomination.convention(year, party, day); });
  }

  /** Party conventions: nominees choose running mates; the general-election presidential contests are created. */
  convention(year: number): void {
    const w = this.w; const r = this.rng('convention', year);
    const presOffice = w.offices.find((o) => o.kind === 'president')!;
    const tickets: { party: number; nominee: Person; mate: Person }[] = [];
    for (const party of [PARTY_D, PARTY_R]) {
      const row = this.db.get<{ person_id: number }>("SELECT k.person_id FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy WHERE c.kind = 'pres_nomination' AND c.party_id = ? AND c.year = ?", [party, year]);
      if (!row) continue;
      const nominee = w.persons.get(row.person_id)!;
      let mate: Person | null = null;
      const vpOffice = w.offices.find((o) => o.kind === 'vice_president')!;
      const vpTerm = w.current.get(vpOffice.id);
      if (vpTerm && w.current.get(presOffice.id)?.personId === nominee.id && vpTerm.partyId === party) mate = w.persons.get(vpTerm.personId)!;
      if (!mate) {
        const pool = w.offices.filter((o) => ['us_senator', 'governor', 'us_representative'].includes(o.kind)).map((o) => w.current.get(o.id)).filter((t): t is Term => !!t && t.partyId === party && t.personId !== nominee.id)
          .map((t) => w.persons.get(t.personId)!).filter((p) => p.deathDay === null && ageOn(p.birthDay, easternDay(w.time)) >= 35);
        mate = pool.length ? pool[r.weighted(pool.map((p) => Math.exp(3 * p.traits.recognition + 2 * p.traits.leadership) * (p.homeState === nominee.homeState ? 0.05 : 1)))]! : this.newCandidate(r, party, 0, null, 0.3, year).person;
      }
      tickets.push({ party, nominee, mate });
      this.h.news('convention', `${fullName(nominee)} accepts the ${PARTY_NAME[party]} nomination`, `${fullName(nominee)} chose ${fullName(mate)} as running mate.`, { personId: nominee.id });
    }
    for (const party of [PARTY_L, PARTY_G]) {
      const nominee = this.newCandidate(r, party, r.weighted(w.pack.states.map((_, s) => w.pop.stateVep[s]!)), null, 0.12, year).person;
      const mate = this.newCandidate(r, party, r.weighted(w.pack.states.map((_, s) => w.pop.stateVep[s]!)), null, 0.05, year).person;
      tickets.push({ party, nominee, mate });
    }
    this.h.commit(() => {
      for (const s of w.pack.states) {
        const gid = this.electionOf(year, 'general', s.idx); if (gid === null) continue;
        const ev = electoralVotes(s.usps, w.pack.cds.filter((c) => c.stateIdx === s.idx).length);
        this.db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [gid, presOffice.id, 'pres_state', null, s.idx, null, DISTRICT_EV_STATES.has(s.usps) ? 'district_ev' : 'plurality', `${year} President — ${s.name}`, 'set', null, null, null, null, null, ev, year]);
        const cid = Number(this.db.value('SELECT last_insert_rowid()'));
        const rules = ELECTION_RULES_2016[s.usps]!;
        for (const t of tickets) {
          if ((t.party === PARTY_L && !rules.ballot.L) || (t.party === PARTY_G && !rules.ballot.G)) continue;
          this.db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)',
            [cid, t.nominee.id, t.party, BALLOT_ORDER(t.party), w.current.get(presOffice.id)?.personId === t.nominee.id ? 1 : 0, t.mate.id, 'running', this.quality(t.nominee, t.party > 2 ? 0.3 : 0.75)]);
        }
      }
    });
  }

  // ---- Holding elections --------------------------------------------------------------------------

  cands(contestId: number): { cand: CandidacyRow; person: Person }[] {
    return this.db.all<CandidacyRow>("SELECT * FROM candidacy WHERE contest_id = ? AND status NOT IN ('withdrew') ORDER BY ballot_order, candidacy_id", [contestId])
      .map((cand) => ({ cand, person: this.w.persons.get(cand.person_id)! })).filter((x) => x.person);
  }

  ensureTurnout(): number {
    if (this.state.tauE === null) {
      const cal = calibrateTurnout(this.w.seed, this.w.electorate, this.w.pop);
      this.state.tauE = cal.tauE; this.state.turnoutTarget = cal.target;
    }
    return this.state.tauE;
  }

  /** Run contests of one or more elections through the kernel and return per-contest results. */
  private async realize(key: string, groups: { stateIdx: number; kind: 'general' | 'primary' | 'allparty'; party: number; contests: { row: ContestRow; cands: { cand: CandidacyRow; person: Person }[]; officeKind: string }[]; turnout?: number }[], turnoutOffset: number, year: number, night?: { day: DayNumber }): Promise<Map<number, ContestResult>> {
    const tauE = this.ensureTurnout() + turnoutOffset;
    const env = this.state.env[String(year)] ? this.environmentFor(year) : null;
    const ctx = { seed: this.w.seed, electionKey: key, pack: this.w.pack, pop: this.w.pop, electorate: this.w.electorate, env, tauE, ranges: this.ranges };
    const kctx = { classCentroids: this.cls.centroids, platforms: this.w.electorate.params.platforms };
    this.h.progress('Preparing the electorate', 0);
    const inputs = groups.filter((g) => g.contests.length).map((g) => {
      const kcs = g.contests.map((c) => kernelContest(this.w.seed, c.row, c.cands, c.officeKind, g.stateIdx, g.kind === 'primary', { ...kctx, campaign: this.season.campaignFn(c.row) }));
      const comp = Math.exp(-Math.abs(this.stateMargin(g.stateIdx, year) + this.rng('perceived', key, g.stateIdx).normal(0, 4)) / 8);
      const inp: JobInput = buildShard(g.turnout ? { ...ctx, tauE: ctx.tauE + g.turnout } : ctx, g.stateIdx, g.kind, g.party, kcs, g.kind === 'general' ? comp : 0);
      if (night && g.kind === 'general') {
        // Counted election: the job also builds this state's night (count plan, wire, survey, desk).
        const parts = buildParts(inp.bus.rj, inp.bus.cd);
        inp.parts = { of: parts.of, count: parts.count };
        const races = nightRaces(this.w.pack, g.stateIdx, g.contests.map((c, i) => ({ contestIndex: i, office: c.officeKind, method: c.row.method, parties: c.cands.map((x) => x.cand.party_id), districtEv: c.row.method === 'district_ev' })));
        // The desks' priors: the last public forecast of each race (statewide two-party races), when one exists.
        for (const race of races) {
          const row = g.contests[race.contest]!.row;
          if (race.cd >= 0) continue;
          const key = row.kind === 'pres_state' ? `PS:${year}:${this.w.pack.states[g.stateIdx]!.usps}` : `C:${row.contest_id}`;
          const parties = g.contests[race.contest]!.cands.map((x) => x.cand.party_id);
          const plus = race.axis.indexOf(1), minus = race.axis.indexOf(-1);
          const f = this.season.forecastFor(key);
          if (f && plus >= 0 && minus >= 0 && parties[plus] === PARTY_D && parties[minus] === PARTY_R) race.forecast = f;
        }
        let vep = 0; for (let i = 0; i < inp.bus.count; i++) vep += inp.bus.vep[i]!;
        inp.night = buildNightInput({ seed: this.w.seed, key, pack: this.w.pack, rg: this.ranges[g.stateIdx]!, stateIdx: g.stateIdx, day: night.day, year, coverageStart: at(night.day, 17), races, national: nationalPriorError(this.w.seed, key), expectedBallots: vep * 0.55 });
        inp.stateIdx = g.stateIdx;
        // The worker also seals this state's results (encoding and hashing off the engine thread).
        inp.seal = { contests: g.contests.map((c) => ({ id: c.row.contest_id, candidacyIds: c.cands.map((x) => x.cand.candidacy_id) })) };
      }
      return inp;
    });
    const outputs = await this.h.runner.run(inputs, (d, t) => this.h.progress('Counting ballots', d / t));
    this.lastNights = new Map();
    outputs.forEach((o) => { if (o.night) this.lastNights.set(o.night.stateIdx, o.night); });
    const meta = new Map<number, { candidacyIds: number[]; grain: 'bu' | 'cpart' }>();
    for (const g of groups) for (const c of g.contests) meta.set(c.row.contest_id, { candidacyIds: c.cands.map((x) => x.cand.candidacy_id), grain: g.kind === 'general' ? 'bu' : 'cpart' });
    this.h.progress('Tallying results', 1);
    const res = aggregate(packGeo(this.w.pack), inputs.map((input, i) => ({ input, output: outputs[i]! })), meta);
    // Blobs sealed in the compute workers (general shards): the engine only writes them.
    this.lastSealed = new Map(); this.lastSealedTurnout = new Map(); this.lastSealedRejected = new Map();
    outputs.forEach((o, i) => {
      if (!o.sealed) return;
      for (const c of o.sealed.contests) this.lastSealed.set(c.id, c);
      this.lastSealedTurnout.set(inputs[i]!.stateIdx ?? -1, o.sealed.turnout);
      for (const r of o.sealed.rejected) this.lastSealedRejected.set(r.contestId, r.payload);
    });
    // Per-unit turnout for general shards (needed by the archive audit).
    this.lastTurnout = inputs.map((inp, i) => ({ stateIdx: groups.filter((g) => g.contests.length)[i]!.stateIdx, kind: groups.filter((g) => g.contests.length)[i]!.kind, start: inp.bus.start, out: outputs[i]! }));
    return res;
  }
  private lastTurnout: { stateIdx: number; kind: string; start: number; out: import('../electorate/kernel').ShardOutput }[] = [];
  private lastSealed = new Map<number, SealedContest>();
  private lastSealedTurnout = new Map<number, Uint8Array>();
  private lastSealedRejected = new Map<number, Uint8Array>();
  private lastNights = new Map<number, StateNight>();

  officeKindOf(c: ContestRow): string { return c.office_id !== null ? this.w.officeById.get(c.office_id)!.kind : 'president'; }

  /** Order candidates by votes; returns [winnerIdx, runnerUpIdx, topShare]. */
  private rank(r: ContestResult, rng: Rng): { order: number[]; share: number[] } {
    const t = totalsOf(r).slice(0, K(r) - 1), valid = t.reduce((a, b) => a + b, 0);
    const tie = t.map(() => rng.float());
    const order = t.map((_, j) => j).sort((a, b) => t[b]! - t[a]! || tie[b]! - tie[a]!);
    return { order, share: t.map((v) => (valid > 0 ? v / valid : 0)) };
  }

  /** Hold a state primary (all parties) on its day. */
  async primary(electionId: number): Promise<void> {
    const e = this.db.get<{ year: number; state_idx: number; day: number }>('SELECT year, state_idx, day FROM election WHERE election_id = ?', [electionId])!;
    const rows = this.db.all<ContestRow>("SELECT * FROM contest WHERE election_id = ? AND status = 'set' ORDER BY contest_id", [electionId]);
    if (!rows.length) { this.h.commit(() => this.db.run("UPDATE election SET status = 'held', held_time = ? WHERE election_id = ?", [this.w.time, electionId])); return; }
    // Party primaries (including presidential primaries and caucuses on that day), then the all-party top-two ballot.
    // Caucuses and party conventions draw a much smaller, more engaged electorate.
    const groups = [PARTY_D, PARTY_R].map((party) => {
      const cs = rows.filter((c) => (c.kind === 'primary' || c.kind === 'pres_primary') && c.party_id === party);
      return { stateIdx: e.state_idx, kind: 'primary' as const, party, contests: cs.map((row) => ({ row, cands: this.cands(row.contest_id), officeKind: this.officeKindOf(row) })),
        turnout: cs.some((c) => c.kind === 'pres_primary' && c.method !== 'primary') && !cs.some((c) => c.kind === 'primary') ? CAUCUS_TURNOUT_OFFSET : 0 };
    });
    groups.push({ stateIdx: e.state_idx, kind: 'allparty' as never, party: 0, contests: rows.filter((c) => c.kind === 'top_two').map((row) => ({ row, cands: this.cands(row.contest_id), officeKind: this.officeKindOf(row) })), turnout: 0 });
    const results = await this.realize(`primary|${electionId}`, groups, TURNOUT_OFFSET.primary + (e.year % 4 === 0 ? 0 : -0.2), e.year);
    await this.decideAndWrite(electionId, rows, results, 'primary');
  }

  async presNomination(electionId: number): Promise<void> {
    const e = this.db.get<{ year: number; party_id: number }>('SELECT year, party_id FROM election WHERE election_id = ?', [electionId])!;
    const row = this.db.get<ContestRow>("SELECT * FROM contest WHERE election_id = ? AND status = 'set'", [electionId]);
    if (!row) return;
    const cands = this.cands(row.contest_id);
    const groups = this.w.pack.states.map((s) => ({ stateIdx: s.idx, kind: 'primary' as const, party: e.party_id, contests: [{ row, cands, officeKind: 'president' }] }));
    this.h.progress(`Voting in the ${PARTY_NAME[e.party_id]} presidential primaries`, 0);
    const results = await this.realize(`presnom|${electionId}`, groups, TURNOUT_OFFSET.primary, e.year);
    await this.decideAndWrite(electionId, [row], results, 'nomination');
  }

  /**
   * Election Day, at the ballot lock (06:00 ET): every state's general election — with any special elections
   * held the same day, on the same ballots — is realized, sealed as cast, and its night is counted.
   */
  async general(year: number, day: DayNumber): Promise<void> {
    const elections = this.db.all<{ election_id: number; state_idx: number; kind: string }>("SELECT election_id, state_idx, kind FROM election WHERE kind IN ('general','special') AND day = ? AND status = 'scheduled' ORDER BY state_idx, election_id", [day]);
    const all: ContestRow[] = [];
    const states = [...new Set(elections.map((e) => e.state_idx))];
    const groups = states.map((s) => {
      const rows = elections.filter((e) => e.state_idx === s).flatMap((el) => this.db.all<ContestRow>("SELECT * FROM contest WHERE election_id = ? AND status IN ('set','filing') ORDER BY contest_id", [el.election_id])).filter((c) => this.cands(c.contest_id).length > 0);
      all.push(...rows);
      return { stateIdx: s, kind: 'general' as const, party: 0, contests: rows.map((row) => ({ row, cands: this.cands(row.contest_id), officeKind: this.officeKindOf(row) })) };
    });
    const offset = year % 4 === 0 ? TURNOUT_OFFSET.presidential : year % 2 === 0 ? TURNOUT_OFFSET.midterm : TURNOUT_OFFSET.offyear;
    await this.season.ensure(year);
    this.h.progress('Voters go to the polls', 0);
    const results = await this.realize(`general|${year}|${day}`, groups, offset, year, { day });
    await this.lockCount(day, 'general', `${year} general election`, elections.filter((e) => all.some((c) => c.election_id === e.election_id)), all, results);
  }

  async runoff(electionId: number): Promise<void> {
    const e = this.db.get<{ year: number; state_idx: number; kind: string }>('SELECT year, state_idx, kind FROM election WHERE election_id = ?', [electionId])!;
    const rows = this.db.all<ContestRow>("SELECT * FROM contest WHERE election_id = ? AND status = 'set' ORDER BY contest_id", [electionId]);
    const isPrimary = e.kind === 'primary_runoff';
    const groups = isPrimary
      ? [PARTY_D, PARTY_R].map((party) => ({ stateIdx: e.state_idx, kind: 'primary' as const, party, contests: rows.filter((c) => c.party_id === party).map((row) => ({ row, cands: this.cands(row.contest_id), officeKind: this.officeKindOf(row) })) }))
      : [{ stateIdx: e.state_idx, kind: 'general' as const, party: 0, contests: rows.map((row) => ({ row, cands: this.cands(row.contest_id), officeKind: this.officeKindOf(row) })) }];
    if (isPrimary) {
      const results = await this.realize(`runoff|${electionId}`, groups, TURNOUT_OFFSET.runoff, e.year);
      await this.decideAndWrite(electionId, rows, results, 'primary');
      return;
    }
    const day = this.db.value<number>('SELECT day FROM election WHERE election_id = ?', [electionId])!;
    const results = await this.realize(`runoff|${electionId}`, groups, TURNOUT_OFFSET.runoff, e.year, { day });
    await this.lockCount(day, 'runoff', `${e.year} ${this.w.pack.states[e.state_idx]!.name} runoff`, [{ election_id: electionId, state_idx: e.state_idx }], rows, results);
  }

  /**
   * Test harness (no database writes): realize a general election day again under a different random key and
   * return its merged night record. Used to measure decision-desk accuracy over many simulated nights.
   */
  async simulateNight(year: number, day: DayNumber, variant: string): Promise<{ rec: Omit<NightRecord, 'control' | 'chambers' | 'story'>; finals: number[][] }> {
    const elections = this.db.all<{ election_id: number; state_idx: number }>("SELECT election_id, state_idx FROM election WHERE kind IN ('general','special') AND day = ? ORDER BY state_idx, election_id", [day]);
    const states = [...new Set(elections.map((e) => e.state_idx))];
    const groups = states.map((s) => {
      const rows = elections.filter((e) => e.state_idx === s).flatMap((el) => this.db.all<ContestRow>('SELECT * FROM contest WHERE election_id = ? AND parent_contest IS NULL ORDER BY contest_id', [el.election_id])).filter((c) => this.cands(c.contest_id).length > 0 && c.kind !== 'top_two' && c.kind !== 'primary');
      return { stateIdx: s, kind: 'general' as const, party: 0, contests: rows.map((row) => ({ row, cands: this.cands(row.contest_id), officeKind: this.officeKindOf(row) })) };
    }).filter((g) => g.contests.length);
    const offset = year % 4 === 0 ? TURNOUT_OFFSET.presidential : year % 2 === 0 ? TURNOUT_OFFSET.midterm : TURNOUT_OFFSET.offyear;
    await this.realize(`general|${year}|${day}|${variant}`, groups, offset, year, { day });
    const st = [...this.lastNights.keys()].sort((a, b) => a - b);
    const nights = st.map((s) => this.lastNights.get(s)!);
    const meta = nights.map((n) => n.races.map((r) => this.raceMeta(r.contestId, r.cd)));
    const rec = mergeNights(nights, meta, st.map(() => 0), { day, lockTime: at(day, 6), coverageStart: at(day, 17), nightEnd: at(day + 1, 6) }, st.map(() => ({ canvass: 0, certify: 0 })));
    const finals = rec.races.map((r) => new Array<number>(r.k).fill(0));
    for (let i = 0; i < rec.raceRows.race.length; i++) { const r = rec.raceRows.race[i]!; for (let j = 0; j < rec.races[r]!.k; j++) finals[r]![j]! += rec.raceRows.votes[rec.raceRows.off[i]! + j]!; }
    return { rec, finals };
  }

  // ---- Counted elections: ballot lock, election night, certification ----------------------------------

  private raceMeta(contestId: number, cd: number): RaceMeta {
    const row = this.db.get<ContestRow>('SELECT * FROM contest WHERE contest_id = ?', [contestId])!;
    const cands = this.cands(contestId);
    const ev = row.kind === 'pres_state' ? (cd >= 0 ? 1 : row.method === 'district_ev' ? 2 : row.ev ?? 0) : 0;
    const label = cd >= 0 ? `${row.label} — ${cdCode(this.w.pack, cd)}` : row.label;
    return { candidacyIds: cands.map((x) => x.cand.candidacy_id), parties: cands.map((x) => x.cand.party_id), office: this.officeKindOf(row), ev, label };
  }

  /** Seats of each chamber not up in this election, by the current holder's party (0 = vacant). */
  private chamberBase(rec: Omit<NightRecord, 'control' | 'chambers' | 'story'>): { senate: ChamberBase; house: ChamberBase } {
    const up = new Set(rec.races.filter((r) => r.cd < 0).map((r) => this.db.value<number>('SELECT office_id FROM contest WHERE contest_id = ?', [r.contestId])).filter((x): x is number => x !== undefined && x !== null));
    const base = (kind: string, seats: number, majority: number): ChamberBase => {
      const holdovers: Record<number, number> = {};
      for (const o of this.w.offices) {
        if (o.kind !== kind || up.has(o.id)) continue;
        const p = this.w.current.get(o.id)?.partyId ?? 0;
        holdovers[p] = (holdovers[p] ?? 0) + 1;
      }
      return { holdovers, seats, majority };
    };
    return { senate: base('us_senator', 100, 51), house: base('us_representative', 435, 218) };
  }

  /** Presidency and chamber-control projections, from the desk's calls in time order. */
  private controlProjections(rec: Omit<NightRecord, 'control' | 'chambers' | 'story'>, ch: { senate: ChamberBase; house: ChamberBase }): ControlEvent[] {
    const out: ControlEvent[] = [];
    const called = new Map<number, number>(); // race → option
    const personOf = (cid: number) => this.db.value<number>('SELECT person_id FROM candidacy WHERE candidacy_id = ?', [cid]) ?? null;
    let pres: { party: number; person: number | null } | null = null;
    const nominee = new Map<number, number>();
    // Control is projected only when a chamber is at stake: at least 10 of its seats are on this night's ballots.
    const atStake = { senate: rec.races.filter((r) => r.office === 'us_senator' && r.cd < 0).length >= 10, house: rec.races.filter((r) => r.office === 'us_representative').length >= 10 };
    const ctl: Record<string, number> = { senate: 0, house: 0 };
    const ev = rec.events;
    for (let i = 0; i < ev.time.length; i++) {
      const r = ev.race[i]!, st = ev.status[i]!;
      if (st === ST_CALLED) called.set(r, ev.option[i]!); else if (st === ST_WITHDRAWN) called.delete(r); else continue;
      const t = ev.time[i]!;
      // President: called electoral votes by nominee (each state contest has its own candidacies).
      const evs = new Map<number, { ev: number; party: number }>();
      for (const [race, opt] of called) {
        const rc = rec.races[race]!; if (rc.office !== 'president' || !rc.ev) continue;
        const cid = rc.candidacyIds[opt]!; let pid = nominee.get(cid); if (pid === undefined) { pid = personOf(cid) ?? -cid; nominee.set(cid, pid); }
        const e = evs.get(pid) ?? { ev: 0, party: rc.parties[opt]! }; e.ev += rc.ev; evs.set(pid, e);
      }
      const top = [...evs].sort((a, b) => b[1].ev - a[1].ev || a[0] - b[0])[0];
      if (!pres && top && top[1].ev >= 270) {
        pres = { party: top[1].party, person: top[0] >= 0 ? top[0] : null };
        out.push({ time: t, kind: 'president', party: pres.party, person: pres.person, status: 1, detail: `${top[1].ev} electoral votes projected` });
      } else if (pres && (!top || top[1].ev < 270)) { out.push({ time: t, kind: 'president', party: pres.party, person: pres.person, status: 0, detail: 'Projection withdrawn' }); pres = null; }
      for (const [kind, office] of [['senate', 'us_senator'], ['house', 'us_representative']] as const) {
        if (!atStake[kind]) continue; // a special election for one seat does not put control on the ballot
        const base = ch[kind], seats: Record<number, number> = { ...base.holdovers };
        for (const [race, opt] of called) { const rc = rec.races[race]!; if (rc.office !== office || rc.cd >= 0 && office !== 'us_representative') continue; const p = rc.parties[opt]!; seats[p] = (seats[p] ?? 0) + 1; }
        let winner = 0;
        for (const p of [PARTY_D, PARTY_R]) {
          const n = seats[p] ?? 0;
          if (n >= base.majority || (kind === 'senate' && n === base.seats / 2 && pres?.party === p)) winner = p;
        }
        if (winner && ctl[kind] !== winner) { out.push({ time: t, kind, party: winner, person: null, status: 1, detail: `${seats[winner]} seats projected` }); ctl[kind] = winner; }
        else if (!winner && ctl[kind]) { out.push({ time: t, kind, party: ctl[kind]!, person: null, status: 0, detail: 'Projection withdrawn' }); ctl[kind] = 0; }
      }
    }
    return out;
  }

  private recCache = new Map<number, NightRecord>();
  async nightRecord(nightId: number): Promise<NightRecord | null> {
    const hit = this.recCache.get(nightId); if (hit) return hit;
    const row = this.db.get<{ payload: Uint8Array }>('SELECT payload FROM night WHERE night_id = ?', [nightId]);
    if (!row) return null;
    const rec = await decodeNightRecord(row.payload);
    // Records sealed before Phase 4 carry no story: it is written from the record now (deterministically).
    if (!rec.story) rec.story = nightStory(this.db, this.w, rec);
    if (this.recCache.size > 2) this.recCache.clear();
    this.recCache.set(nightId, rec);
    return rec;
  }

  /**
   * The ballot lock: the cast ballots are sealed as revision 0 (simulation truth, revealed only by the count),
   * the night record is built and sealed, and counting news and each state's certification are scheduled.
   */
  private async lockCount(day: DayNumber, kind: string, label: string, elections: { election_id: number; state_idx: number }[], rows: ContestRow[], results: Map<number, ContestResult>): Promise<void> {
    const w = this.w, now = w.time;
    this.h.progress('Sealing the ballots cast', 1);
    const preps: { el: { election_id: number; state_idx: number }; eRows: ContestRow[]; prepared: Awaited<ReturnType<typeof prepareContest>>[]; rollup: Uint8Array | null; turnoutBlob: Uint8Array | null; ballots: number; eligible: number; rejected: { contestId: number; payload: Uint8Array }[] }[] = [];
    const prepOne = async (el: { election_id: number; state_idx: number }) => {
      const eRows = rows.filter((c) => c.election_id === el.election_id && results.has(c.contest_id));
      const prepared = await Promise.all(eRows.map((c) => {
        const r = results.get(c.contest_id)!, sealed = this.lastSealed.get(c.contest_id);
        return sealed ? { result: r, totals: sealed.totals, blobs: sealed.blobs, sha256: sealed.sha256 } : prepareContest(r);
      }));
      const stateResults = eRows.map((c) => results.get(c.contest_id)!).filter((x) => x.grain === 'bu');
      const rollup = stateResults.length ? await prepareRollup(stateResults) : null;
      const turnout = this.lastTurnout.find((t) => t.stateIdx === el.state_idx && t.kind === 'general');
      const turnoutBlob = turnout ? this.lastSealedTurnout.get(el.state_idx) ?? await prepareTurnout(turnout.start, turnout.out.eligible, turnout.out.ballots, turnout.out.ballotsByMode) : null;
      const night = this.lastNights.get(el.state_idx);
      const rejected = night ? await Promise.all(night.races.map((r, ri) => ({ r, ri })).filter(({ r }) => r.cd < 0 && eRows.some((c) => c.contest_id === r.contestId))
        .map(async ({ r, ri }) => { const ru = night.rejectedUnits[ri]!; return { contestId: r.contestId, payload: this.lastSealedRejected.get(r.contestId) ?? await prepareRejected(ru.units, ru.modes, ru.votes, r.k) }; })) : [];
      return { el, eRows, prepared, rollup, turnoutBlob, rejected,
        ballots: turnout ? turnout.out.ballots.reduce((a, x) => a + x, 0) : 0, eligible: turnout ? turnout.out.eligible.reduce((a, x) => a + x, 0) : 0 };
    };
    // Every election's blobs are encoded and sealed concurrently (compression is asynchronous in the browser).
    preps.push(...await Promise.all(elections.map(prepOne)));
    // The night record: every state's count merged, with presidency and chamber-control projections.
    this.h.progress('Sealing the night record', 1);
    const states = [...new Set(elections.map((e) => e.state_idx))].sort((a, b) => a - b).filter((s) => this.lastNights.has(s));
    const nights = states.map((s) => this.lastNights.get(s)!);
    const meta = nights.map((n) => n.races.map((r) => this.raceMeta(r.contestId, r.cd)));
    const cc = states.map((s) => { const R = COUNTING_RULES_2016[w.pack.states[s]!.usps]!; return { canvass: at(day + R.canvassDays, 17), certify: at(day + R.certifyDays, 17) }; });
    const merged = mergeNights(nights, meta, states.map((s) => elections.find((e) => e.state_idx === s)!.election_id), { day, lockTime: now, coverageStart: at(day, 17), nightEnd: at(day + 1, 6) }, cc);
    const chambers = this.chamberBase(merged);
    const base = { ...merged, chambers, control: this.controlProjections(merged, chambers) };
    // Alerts and commentary are written once, at the lock, from the record and the archive as it stands.
    const rec: NightRecord = { ...base, story: nightStory(this.db, w, base, new Map(preps.map((p) => [p.el.election_id, p.eligible]))) };
    const { payload, sha256 } = await encodeNightRecord(rec);
    const env = this.state.env[String(rows[0]?.year ?? 0)];
    let nightId = 0;
    this.h.progress('Writing the archive', 1);
    this.h.commit(() => {
      for (const p of preps) {
        for (const pc of p.prepared) writeContest(this.db, pc, now, 'cast', 'Ballots cast, sealed at the ballot lock; revealed by the count', 0);
        if (p.rollup) this.db.run('INSERT OR REPLACE INTO county_rollup VALUES (?,?,?)', [p.el.election_id, p.el.state_idx, p.rollup]);
        if (p.turnoutBlob) this.db.run('INSERT OR REPLACE INTO election_turnout VALUES (?,?,?,?,?)', [p.el.election_id, p.el.state_idx, p.ballots, p.eligible, p.turnoutBlob]);
        for (const r of p.rejected) this.db.run('INSERT INTO result_blob VALUES (?,?,?,?,?)', [r.contestId, 0, 'rejected', r.payload, crc32(r.payload)]);
        for (const c of p.eRows) this.db.run("UPDATE contest SET status = 'counting' WHERE contest_id = ?", [c.contest_id]);
        this.db.run("UPDATE election SET status = 'counting', held_time = ?, env_json = ? WHERE election_id = ?", [now, env ? JSON.stringify({ national: env.national, fundamentals: env.fundamentals, classSwing: env.classSwing, enthusiasm: env.enthusiasm }) : null, p.el.election_id]);
      }
      this.db.run('INSERT INTO night(day, kind, label, lock_time, coverage_start, night_end, feed_end, created_time, sha256, payload) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [day, kind, label, now, rec.coverageStart, rec.nightEnd, rec.feedEnd, now, sha256, payload]);
      nightId = Number(this.db.value('SELECT last_insert_rowid()'));
      for (const p of preps) this.db.run('INSERT OR IGNORE INTO night_election VALUES (?,?)', [nightId, p.el.election_id]);
    });
    this.recCache.set(nightId, rec);
    // Certification per state; news as the count proceeds (computed from the record when each moment arrives).
    for (const p of preps) {
      const i = states.indexOf(p.el.state_idx);
      if (i >= 0) this.h.schedule(cc[i]!.certify, 'certify_state', { election: p.el.election_id, night: nightId }, 5);
    }
    const marks: SimTime[] = [];
    for (let t = at(day, 19); t <= at(day + 1, 3); t += 30) marks.push(t);
    marks.push(rec.nightEnd);
    const lastDay = Math.ceil((rec.feedEnd - rec.nightEnd) / MINUTES_PER_DAY) + 1;
    for (let d = 1; d <= Math.min(45, lastDay); d++) marks.push(at(day + d, 12));
    let prev = rec.coverageStart;
    for (const t of marks) { if (t <= now) continue; this.h.schedule(t, 'night_news', { night: nightId, from: prev, to: t, summary: t === rec.nightEnd ? 1 : 0 }, 7); prev = t; }
    this.h.news('election_day', `Polls open: ${label}`, `${elections.length} election${elections.length === 1 ? '' : 's'} today. Polls close from ${formatTimeET(Math.min(...nights.map((n) => n.closeFirst)))}; coverage begins at 5:00 pm ET. Watch it on the Election Night screen.`, { night: nightId });
  }

  /** News of the count: projections and control calls between two moments, from the sealed record. */
  async nightNews(nightId: number, from: SimTime, to: SimTime, summary: boolean): Promise<void> {
    const rec = await this.nightRecord(nightId); if (!rec) return;
    const ev = rec.events;
    const name = (race: number, opt: number) => { const cid = rec.races[race]!.candidacyIds[opt]; const pid = cid !== undefined ? this.db.value<number>('SELECT person_id FROM candidacy WHERE candidacy_id = ?', [cid]) : undefined; const p = pid !== undefined ? this.w.persons.get(pid) : undefined; return p ? fullName(p) : 'the leading candidate'; };
    const abbr = (p: number) => this.abbr(p);
    const presCalls: Record<number, string[]> = {}; let house: Record<number, number> = {}; let last = from;
    for (let i = 0; i < ev.time.length; i++) {
      const t = ev.time[i]!; if (t <= from || t > to) continue;
      const race = rec.races[ev.race[i]!]!, st = ev.status[i]!, opt = ev.option[i]!;
      if (st === ST_WITHDRAWN) { this.h.news('projection', `MNN withdraws its projection in ${race.label.replace(/^\d{4} /, '')}`, 'The race returns to too close to call as more votes are counted.', { contestId: race.contestId }, t); continue; }
      if (st !== ST_CALLED) continue;
      last = t;
      const party = race.parties[opt]!;
      if (race.office === 'president') { if (race.cd < 0) (presCalls[party] ??= []).push(this.w.pack.states[race.stateIdx]!.usps); continue; }
      if (race.office === 'us_representative') { house[party] = (house[party] ?? 0) + 1; continue; }
      if (race.office === 'us_senator' || race.office === 'governor') this.h.news('projection', `MNN projects ${name(ev.race[i]!, opt)} (${abbr(party)}) wins the race for ${race.label.replace(/^\d{4} (special )?/, '')}`, (ev.flags[i]! & 1) ? 'Projected as polls closed, from the voter survey and the pre-election picture.' : `With about ${Math.round(100 * (ev.prob[i]! / 10000))}% confidence from the votes counted so far.`, { contestId: race.contestId }, t);
    }
    const parts = Object.entries(presCalls).map(([p, us]) => `${abbr(Number(p))}: ${us.join(', ')}`);
    if (parts.length) this.h.news('projection', `MNN presidential projections: ${parts.join(' · ')}`, 'State results as projected by the MNN decision desk.', {}, last);
    house = Object.fromEntries(Object.entries(house));
    const hp = Object.entries(house);
    if (hp.length) this.h.news('projection', `MNN projects ${hp.reduce((a, [, n]) => a + n, 0)} more House races`, hp.map(([p, n]) => `${abbr(Number(p))} ${n}`).join(', '), {}, last);
    // Records sealed before control required a chamber at stake may carry control lines for one-seat specials.
    const stake = (k: string) => k === 'president' || rec.races.filter((r) => r.office === (k === 'senate' ? 'us_senator' : 'us_representative') && r.cd < 0).length >= 10;
    for (const c of rec.control) {
      if (c.time <= from || c.time > to || !stake(c.kind)) continue;
      const pn = PARTY_NAME[c.party] ?? 'Independent', plural = PARTY_PLURAL[c.party] ?? 'Independents';
      const person = c.person !== null ? this.w.persons.get(c.person) : undefined;
      if (c.kind === 'president') this.h.news('results', c.status ? `MNN projects ${person ? fullName(person) : `the ${pn} ticket`} will win the presidency` : 'MNN withdraws its presidential projection', c.status ? `${c.detail}. Electors meet in December; Congress counts the votes on January 6.` : c.detail, person ? { personId: person.id } : {}, c.time);
      else this.h.news('results', c.status ? `MNN projects ${plural} will control the ${c.kind === 'senate' ? 'Senate' : 'House'}` : `MNN withdraws its ${c.kind === 'senate' ? 'Senate' : 'House'} control projection`, c.detail, {}, c.time);
    }
    if (summary) {
      const open = new Map<number, number>(); for (let i = 0; i < ev.time.length; i++) { if (ev.time[i]! > to) break; open.set(ev.race[i]!, ev.status[i]!); }
      const uncalled = rec.races.map((r, i) => ({ r, st: open.get(i) })).filter((x) => x.st !== ST_CALLED && x.st !== 5 && x.r.cd < 0);
      const key = uncalled.filter((x) => ['president', 'us_senator', 'governor'].includes(x.r.office)).map((x) => x.r.label.replace(/^\d{4} /, ''));
      this.h.news('results', `Morning after: ${uncalled.length} race${uncalled.length === 1 ? '' : 's'} not yet projected`, key.length ? `Still uncalled: ${key.slice(0, 8).join('; ')}${key.length > 8 ? '…' : ''}. Counting continues; states certify over the coming weeks.` : 'Every major race has been projected. Counting continues until each state certifies.', {}, to);
    }
  }

  /** A state certifies: revisions 1 (unofficial), 2 (canvass) and 3 (certified); winners are decided. */
  async certifyState(electionId: number, nightId: number): Promise<void> {
    const e = this.db.get<{ state_idx: number; day: number }>('SELECT state_idx, day FROM election WHERE election_id = ?', [electionId]);
    if (!e) return;
    const rows = this.db.all<ContestRow>("SELECT * FROM contest WHERE election_id = ? AND status = 'counting' ORDER BY contest_id", [electionId]);
    if (!rows.length) return;
    const rec = await this.nightRecord(nightId);
    const pack = this.w.pack, now = this.w.time;
    const certified = new Map<number, ContestResult>();
    const extra: (() => void)[] = [];
    // Contests are prepared concurrently; their writes are applied in contest order.
    const prepared = await Promise.all(rows.map(async (c) => {
      const out: (() => void)[] = [];
      const ids = this.cands(c.contest_id).map((x) => x.cand.candidacy_id);
      const r = await certifiedFromCast(this.db, c.contest_id, ids, (b) => pack.bu.rj[b]!, (b) => pack.bu.county[b]!, (b) => pack.bu.cd[b]!);
      if (!r) return null;
      if (rec) {
        const ri = rec.races.findIndex((x) => x.contestId === c.contest_id && x.cd < 0);
        if (ri >= 0) {
          const k = rec.races[ri]!.k, rev1 = new Array<number>(k).fill(0), rev2 = new Array<number>(k).fill(0);
          let t1 = 0;
          for (let i = 0; i < rec.raceRows.race.length; i++) {
            if (rec.raceRows.race[i] !== ri) continue;
            const b = rec.raceRows.batch[i]!, prov = rec.batches.mode[b] === MODE_PROV;
            for (let j = 0; j < k; j++) { const v = rec.raceRows.votes[rec.raceRows.off[i]! + j]!; rev2[j]! += v; if (!prov) rev1[j]! += v; }
            if (!prov) t1 = Math.max(t1, rec.batches.time[b]!);
          }
          const st = rec.states.find((x) => x.electionId === electionId) ?? rec.states.find((x) => x.stateIdx === e.state_idx);
          out.push(await writeTotalsRevision(this.db, c.contest_id, ids, rev1, r.eligible, 1, 'unofficial', t1 || now, 'Unofficial count: every ballot counted before provisional adjudication'));
          out.push(await writeTotalsRevision(this.db, c.contest_id, ids, rev2, r.eligible, 2, 'canvass', st?.canvass ?? now, 'Canvass: provisional ballots adjudicated, every count final'));
        }
      }
      return { id: c.contest_id, r, out };
    }));
    for (const p of prepared) { if (!p) continue; certified.set(p.id, p.r); extra.push(...p.out); }
    const d = await this.prepareDecision(electionId, rows, certified, 'general', e.state_idx, { rev: 3, kind: 'certified', reason: 'Certified by the state canvassing board', pre: extra, electionDay: e.day });
    this.h.commit(d.apply);
    for (const f of d.followUps) f();
    this.h.news('certification', `${pack.states[e.state_idx]!.name} certifies its results`, `${rows.length} contest${rows.length === 1 ? '' : 's'} certified.`, {});
  }

  /** Decide winners, write the archive, and schedule what follows (runoffs, nominations, assumption of office). */
  private async decideAndWrite(electionId: number, rows: ContestRow[], results: Map<number, ContestResult>, phase: 'primary' | 'general' | 'nomination', stateIdx?: number): Promise<void> {
    this.h.progress('Sealing and archiving results', 1);
    const d = await this.prepareDecision(electionId, rows, results, phase, stateIdx);
    this.h.commit(d.apply);
    for (const f of d.followUps) f();
  }

  /**
   * Seal the results (async hashing and encoding) and return the synchronous database work that decides winners
   * and archives them, so several elections can be written in one transaction (each OPFS commit costs a sync).
   */
  private async prepareDecision(electionId: number, rows: ContestRow[], results: Map<number, ContestResult>, phase: 'primary' | 'general' | 'nomination', stateIdx?: number,
    opts: { rev: number; kind: string; reason: string; pre?: (() => void)[]; electionDay?: DayNumber } = { rev: 0, kind: '', reason: '' }): Promise<{ apply: () => void; followUps: (() => void)[] }> {
    const certifying = opts.rev > 0;
    const prepared = await Promise.all(rows.filter((c) => results.has(c.contest_id)).map((c) => certifying
      ? prepareDerived(results.get(c.contest_id)!, opts.rev, this.db.value<string>('SELECT sha256 FROM result_revision WHERE contest_id = ? AND rev = 0', [c.contest_id]) ?? '')
      : prepareContest(results.get(c.contest_id)!)));
    const stateResults = stateIdx !== undefined ? rows.map((c) => results.get(c.contest_id)).filter((x): x is ContestResult => !!x && x.grain === 'bu') : [];
    const rollup = stateResults.length ? await prepareRollup(stateResults) : null;
    const turnout = stateIdx !== undefined && !certifying ? this.lastTurnout.find((t) => t.stateIdx === stateIdx && t.kind === 'general') : undefined;
    const turnoutBlob = turnout ? await prepareTurnout(turnout.start, turnout.out.eligible, turnout.out.ballots, turnout.out.ballotsByMode) : null;
    const w = this.w; const now = w.time;
    const followUps: (() => void)[] = [];
    const apply = () => {
      for (const f of opts.pre ?? []) f();
      for (const p of prepared) writeContest(this.db, p, now, certifying ? opts.kind : phase === 'general' ? 'certified-as-cast' : 'official', certifying ? opts.reason : 'Realized and archived at the close of voting', opts.rev);
      if (rollup && stateIdx !== undefined) {
        if (certifying) this.db.run('INSERT OR REPLACE INTO county_rollup_rev VALUES (?,?,?,?)', [electionId, stateIdx, opts.rev, rollup]);
        else this.db.run('INSERT OR REPLACE INTO county_rollup VALUES (?,?,?)', [electionId, stateIdx, rollup]);
      }
      if (turnoutBlob && turnout && stateIdx !== undefined) {
        const b = turnout.out.ballots.reduce((a, x) => a + x, 0), el = turnout.out.eligible.reduce((a, x) => a + x, 0);
        this.db.run('INSERT OR REPLACE INTO election_turnout VALUES (?,?,?,?,?)', [electionId, stateIdx, b, el, turnoutBlob]);
      }
      const env = this.state.env[String(rows[0]?.year ?? 0)];
      if (certifying) this.db.run("UPDATE election SET status = 'certified' WHERE election_id = ?", [electionId]);
      else this.db.run("UPDATE election SET status = 'held', held_time = ?, env_json = ? WHERE election_id = ?", [now, env ? JSON.stringify({ national: env.national, fundamentals: env.fundamentals, classSwing: env.classSwing, enthusiasm: env.enthusiasm }) : null, electionId]);
      const nomOutcomes = new Map<number, { person: number; share: number; delegates: number; expected: number | null }[]>();
      for (const c of rows) {
        const res = results.get(c.contest_id); if (!res) continue;
        const cands = this.cands(c.contest_id);
        // A state's presidential primary or caucus: delegates, not a nominee.
        if (c.kind === 'pres_primary') {
          const out = this.nomination.allocate(c, res, cands);
          const win = cands[out.winner]!;
          this.db.run("UPDATE contest SET status = 'decided', winner_candidacy = ? WHERE contest_id = ?", [win.cand.candidacy_id, c.contest_id]);
          const avg = this.season.averageOf(`C:${c.contest_id}`);
          const list = nomOutcomes.get(c.party_id!) ?? [];
          cands.forEach((x, j) => list.push({ person: x.person.id, share: out.shares[j]!, delegates: out.pledged[j]!, expected: avg?.options[`p${x.person.id}`]?.mean ?? null }));
          nomOutcomes.set(c.party_id!, list);
          const st = w.pack.states[c.state_idx!]!;
          this.h.news('primary', `${fullName(win.person)} wins the ${st.name} ${PARTY_NAME[c.party_id!]} ${c.method === 'caucus' ? 'caucuses' : c.method === 'convention' ? 'convention' : 'primary'}`,
            `${fullName(win.person)} ${(100 * out.shares[out.winner]!).toFixed(1)}%${cands.length > 1 ? `; ${cands.map((x, j) => ({ x, j })).filter(({ j }) => j !== out.winner).sort((a, b) => out.shares[b.j]! - out.shares[a.j]!).slice(0, 2).map(({ x, j }) => `${fullName(x.person)} ${(100 * out.shares[j]!).toFixed(1)}%`).join(', ')}` : ''}. Delegates: ${cands.map((x, j) => ({ x, j })).filter(({ j }) => out.pledged[j]! > 0).map(({ x, j }) => `${x.person.surname} ${out.pledged[j]}`).join(', ') || 'none bound'}${out.unbound ? `, ${out.unbound} unbound` : ''}.`, { contestId: c.contest_id });
          continue;
        }
        const { order, share } = this.rank(res, this.rng('tiebreak', c.contest_id));
        const win = cands[order[0]!]!, second = order.length > 1 ? cands[order[1]!]! : null;
        const top = share[order[0]!]!;
        const setStatus = (cand: CandidacyRow, s: string) => this.db.run('UPDATE candidacy SET status = ? WHERE candidacy_id = ?', [s, cand.candidacy_id]);
        const needRunoff = (c.method.startsWith('runoff_') && top < Number(c.method.slice(7))) || ((c.method === 'majority' || c.method === 'jungle') && top < 0.5);
        if (needRunoff && second) {
          const st = w.pack.states[c.state_idx!]!; const rules = ELECTION_RULES_2016[st.usps]!;
          const isPrim = c.kind === 'primary';
          const days = isPrim ? rules.primaryRunoff!.daysAfter : (['us_senator', 'us_representative'].includes(this.officeKindOf(c)) ? rules.generalRunoff?.federalDaysAfter ?? 32 : rules.generalRunoff?.daysAfter ?? 28);
          let rd = (opts.electionDay ?? easternDay(now)) + days; while (weekday(rd) !== (st.usps === 'LA' ? 6 : 2)) rd++;
          const kind = isPrim ? 'primary_runoff' : 'general_runoff';
          let rid = this.db.value<number>('SELECT election_id FROM election WHERE kind = ? AND state_idx = ? AND day = ?', [kind, c.state_idx, rd]);
          if (rid === undefined) { rid = this.insertElection(rd, kind, c.state_idx, null, c.year, `${c.year} ${st.name} ${isPrim ? 'primary runoff' : 'runoff election'}`); followUps.push(() => this.h.schedule(at(rd, isPrim ? 21 : 6), 'runoff', { election: rid! }, 6)); }
          this.db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [rid, c.office_id, isPrim ? 'primary' : c.kind, c.party_id, c.state_idx, c.district_idx, 'plurality', `${c.label} (runoff)`, 'set', null, null, c.term_start, c.contest_id, c.next_contest, null, c.year]);
          const rcid = Number(this.db.value('SELECT last_insert_rowid()'));
          [win, second].forEach((x, i) => this.db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [rcid, x.person.id, x.cand.party_id, i, x.cand.incumbent, x.cand.running_mate, 'running', x.cand.quality]));
          cands.forEach((x) => setStatus(x.cand, x === win || x === second ? 'advanced' : 'eliminated'));
          this.db.run("UPDATE contest SET status = 'runoff', next_contest = ? WHERE contest_id = ?", [rcid, c.contest_id]);
          this.h.news('runoff', `${c.label}: runoff required`, `${fullName(win.person)} (${(100 * top).toFixed(1)}%) and ${fullName(second.person)} advance to a runoff on ${formatDay(rd, true)}.`, { contestId: c.contest_id });
          continue;
        }
        if (c.kind === 'top_two') {
          const adv = [win, second].filter((x): x is NonNullable<typeof x> => !!x);
          adv.forEach((x, i) => this.db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [c.next_contest, x.person.id, x.cand.party_id, i, x.cand.incumbent, null, 'running', x.cand.quality]));
          cands.forEach((x) => setStatus(x.cand, adv.includes(x) ? 'advanced' : 'eliminated'));
          this.db.run("UPDATE contest SET status = 'decided', winner_candidacy = ?, runner_up_candidacy = ? WHERE contest_id = ?", [win.cand.candidacy_id, second?.cand.candidacy_id ?? null, c.contest_id]);
          this.db.run("UPDATE contest SET status = 'set' WHERE contest_id = ?", [c.next_contest]);
          continue;
        }
        cands.forEach((x) => setStatus(x.cand, x === win ? 'won' : 'lost'));
        this.db.run('UPDATE contest SET status = ?, winner_candidacy = ?, runner_up_candidacy = ? WHERE contest_id = ?', [certifying ? 'certified' : 'decided', win.cand.candidacy_id, second?.cand.candidacy_id ?? null, c.contest_id]);
        if (c.kind === 'primary' || c.kind === 'pres_nomination') {
          if (c.next_contest !== null) {
            this.db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [c.next_contest, win.person.id, win.cand.party_id, BALLOT_ORDER(win.cand.party_id), win.cand.incumbent, null, 'running', win.cand.quality]);
            if (this.officeKindOf(c) === 'governor') this.pickRunningMate(c.next_contest, win.person, c.state_idx!, c.year);
          }
          if (c.kind === 'pres_nomination') {
            this.season.st.presumptive[`${c.year}:${c.party_id}`] = win.person.id;
            this.h.news('nomination', `${fullName(win.person)} wins the ${PARTY_NAME[c.party_id!]} presidential nomination`, `${fullName(win.person)} won ${(100 * top).toFixed(1)}% of the national primary vote.`, { personId: win.person.id });
          }
          else if (cands.length > 1 && (win.cand.incumbent && top < 0.6 || !win.cand.incumbent)) { /* routine primary outcome — no headline */ }
          if (win.cand.incumbent === 0 && cands.some((x) => x.cand.incumbent)) {
            const loser = cands.find((x) => x.cand.incumbent)!;
            this.h.news('upset', `${fullName(loser.person)} loses ${PARTY_NAME[c.party_id!]} primary`, `${fullName(win.person)} defeated the incumbent, ${(100 * top).toFixed(1)}% of the vote.`, { personId: loser.person.id });
          }
          continue;
        }
        // General (or general runoff / special): schedule the assumption of office.
        if (c.kind === 'pres_state') continue;
        const office = w.officeById.get(c.office_id!)!;
        const start = c.term_start !== null ? Math.max(c.term_start, now + 60) : now + (certifying ? 7 : 14) * MINUTES_PER_DAY;
        followUps.push(() => {
          this.h.schedule(start, 'take_office', { office: office.id, person: win.person.id, contest: c.contest_id }, 3);
          if (win.cand.running_mate) {
            const lg = w.offices.find((o) => o.kind === 'lt_governor' && o.stateIdx === office.stateIdx);
            if (lg) this.h.schedule(start, 'take_office', { office: lg.id, person: win.cand.running_mate, contest: c.contest_id }, 3);
          }
        });
        const incumbentLost = cands.find((x) => x.cand.incumbent && x !== win);
        if (incumbentLost) this.h.news('defeat', `${fullName(incumbentLost.person)} defeated`, `${fullName(win.person)} (${this.abbr(win.cand.party_id)}) unseated ${office.title} ${fullName(incumbentLost.person)} with ${(100 * top).toFixed(1)}% of the vote.`, { personId: win.person.id });
      }
      // The nominating season after the day's contests: momentum, withdrawals, the presumptive nominee.
      for (const [party, list] of nomOutcomes) this.nomination.afterDay(rows[0]!.year, party, easternDay(now), list);
    };
    return { apply, followUps };
  }

  /** Phase 2 saves only: national certification of results decided at the close of voting. */
  certify(year: number, day: DayNumber): void {
    this.h.commit(() => {
      this.db.run("UPDATE contest SET status = 'certified' WHERE year = ? AND status = 'decided' AND election_id IN (SELECT election_id FROM election WHERE day <= ?)", [year, day + 1]);
      this.db.run("UPDATE election SET status = 'certified' WHERE year = ? AND status = 'held' AND day <= ?", [year, day + 1]);
    });
    this.h.news('certification', `${year} general election results certified`, 'State canvassing boards certified the results.', {});
  }

  // ---- Electoral College ---------------------------------------------------------------------------

  /** Electoral votes from the archived state results: winner-take-all, Maine and Nebraska by district. */
  async electoralCount(year: number): Promise<{ person: number; party: number; candidacy: number; ev: number; mate: number | null }[]> {
    const rows = this.db.all<{ contest_id: number; election_id: number; state_idx: number; ev: number; method: string }>("SELECT contest_id, election_id, state_idx, ev, method FROM contest WHERE year = ? AND kind = 'pres_state' AND status IN ('decided','certified')", [year]);
    const tally = new Map<number, { person: number; party: number; candidacy: number; ev: number; mate: number | null }>();
    const add = (cand: CandidacyRow, n: number) => { const t = tally.get(cand.person_id) ?? { person: cand.person_id, party: cand.party_id, candidacy: cand.candidacy_id, ev: 0, mate: cand.running_mate }; t.ev += n; tally.set(cand.person_id, t); };
    for (const r of rows) {
      const cands = this.cands(r.contest_id).map((x) => x.cand);
      const totals = this.db.all<{ candidacy_id: number; votes: number }>('SELECT candidacy_id, votes FROM contest_total WHERE contest_id = ? AND rev = (SELECT MAX(rev) FROM result_revision WHERE contest_id = ?)', [r.contest_id, r.contest_id]);
      const sw = [...totals].sort((a, b) => b.votes - a.votes || a.candidacy_id - b.candidacy_id)[0]!.candidacy_id;
      if (r.method !== 'district_ev') { add(cands.find((c) => c.candidacy_id === sw)!, r.ev); continue; }
      add(cands.find((c) => c.candidacy_id === sw)!, 2);
      // One elector per congressional district, from the archived district totals.
      const roll = await readRollup(this.db, r.election_id, r.state_idx);
      const entry = roll?.contests.find((x) => x.id === r.contest_id);
      for (const [cd, v] of entry?.cds ?? []) {
        if (this.w.pack.cds[cd]?.stateIdx !== r.state_idx) continue;
        const best = v.slice(0, cands.length).map((x, j) => [x, j] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])[0]![1];
        add(cands[best]!, 1);
      }
    }
    return [...tally.values()].sort((a, b) => b.ev - a.ev || a.person - b.person);
  }

  async electors(year: number): Promise<void> {
    const tally = await this.electoralCount(year);
    const eid = this.db.value<number>("SELECT election_id FROM election WHERE year = ? AND kind = 'general' ORDER BY election_id LIMIT 1", [year]) ?? 0;
    this.h.commit(() => {
      this.db.run('DELETE FROM electoral_vote WHERE election_id = ?', [eid]);
      for (const t of tally) this.db.run('INSERT INTO electoral_vote VALUES (?,?,?,?,?,?,?)', [eid, -1, t.candidacy, t.person, t.party, t.ev, 'national']);
    });
    const total = tally.reduce((a, t) => a + t.ev, 0);
    this.h.news('electoral_college', 'The Electoral College votes', tally.map((t) => `${fullName(this.w.persons.get(t.person)!)} ${t.ev}`).join(', ') + ` (of ${total}).`, {});
  }

  /** Congress counts the electoral votes; a contingent election follows if nobody has a majority. */
  async ecCount(year: number): Promise<void> {
    const w = this.w;
    const tally = await this.electoralCount(year);
    const total = tally.reduce((a, t) => a + t.ev, 0);
    const need = Math.floor(total / 2) + 1;
    const pres = w.offices.find((o) => o.kind === 'president')!, vp = w.offices.find((o) => o.kind === 'vice_president')!;
    const inaug = zonedToUtc(year + 1, 1, 20, 12, 0, ET);
    let presWinner: number | null, vpWinner: number | null, how = 'elected by the Electoral College';
    if (tally[0] && tally[0].ev >= need) { presWinner = tally[0].person; vpWinner = tally[0].mate; }
    else {
      // 12th Amendment: the House chooses among the top three, one vote per state delegation; the Senate chooses the VP.
      const top3 = tally.slice(0, 3);
      const byState = new Map<number, Map<number, number>>();
      for (const o of w.offices) if (o.kind === 'us_representative') { const t = w.current.get(o.id); if (!t) continue; const m = byState.get(o.stateIdx!) ?? new Map(); m.set(t.partyId!, (m.get(t.partyId!) ?? 0) + 1); byState.set(o.stateIdx!, m); }
      const votes = new Map<number, number>();
      for (const [, m] of byState) {
        const sorted = [...m].sort((a, b) => b[1] - a[1]);
        if (sorted.length > 1 && sorted[0]![1] === sorted[1]![1]) continue; // divided delegation casts no vote
        const cand = top3.find((t) => t.party === sorted[0]![0]); if (cand) votes.set(cand.person, (votes.get(cand.person) ?? 0) + 1);
      }
      const best = [...votes].sort((a, b) => b[1] - a[1])[0];
      const senD = w.chambers.find((c) => c.kind === 'us_senate')!.composition;
      const senMajority = (senD.get(PARTY_D) ?? 0) >= 51 ? PARTY_D : (senD.get(PARTY_R) ?? 0) >= 51 ? PARTY_R : null;
      const vpPick = tally.slice(0, 2).find((t) => t.party === senMajority);
      vpWinner = vpPick?.mate ?? null;
      if (best && best[1] >= 26) { presWinner = best[0]; how = 'chosen by the House of Representatives (12th Amendment)'; }
      else { presWinner = null; }
      this.h.news('contingent', 'No electoral majority: Congress decides', best && best[1] >= 26 ? `The House elected ${fullName(w.persons.get(best[0])!)} with ${best[1]} state delegations.` : 'The House could not reach a majority of state delegations; the Vice President-elect will act as President.', {});
    }
    if (presWinner !== null) this.h.schedule(inaug, 'take_office', { office: pres.id, person: presWinner, how }, 2);
    else if (vpWinner !== null) this.h.schedule(inaug, 'take_office', { office: pres.id, person: vpWinner, how: 'acting as President under the 20th Amendment (House deadlocked)' }, 2);
    if (vpWinner !== null) this.h.schedule(inaug, 'take_office', { office: vp.id, person: vpWinner, how: 'elected with the President' }, 2);
    if (tally[0] && tally[0].ev >= need) this.h.news('electoral_college', `Congress certifies ${fullName(w.persons.get(tally[0].person)!)}'s election`, `${tally[0].ev} electoral votes of ${total}; ${need} needed.`, { personId: tally[0].person });
  }

  // ---- Assumption of office and specials --------------------------------------------------------------

  takeOffice(officeId: number, personId: number, how: string | null, contestId: number | null): void {
    const w = this.w; const office = w.officeById.get(officeId)!; const person = w.persons.get(personId);
    const cur = w.current.get(officeId);
    if (!person || person.deathDay !== null) {
      // The outgoing term still expires on schedule; the office then falls vacant.
      if (cur) this.h.endTerm(officeId, 'term ended');
      this.h.vacate(officeId, 'officer-elect died before taking office');
      return;
    }
    if (cur?.personId === personId) {
      // Re-elected: the term continues under a new mandate (recorded as a new term).
      this.h.endTerm(officeId, 'term ended (re-elected)');
    } else if (cur) this.h.endTerm(officeId, 'term ended');
    // A person can hold only one elective office: leaving the old one may create a vacancy.
    for (const [oid, t] of [...w.current]) {
      if (t.personId !== personId || oid === officeId) continue;
      const o = w.officeById.get(oid)!;
      if (o.kind === 'congress_leader') { this.h.endTerm(oid, `left the chamber to become ${office.title}`); this.h.vacate(oid, `${fullName(person)} left the chamber`); continue; }
      const sameTime = this.db.value<number>("SELECT COUNT(*) FROM scheduled_event WHERE kind = 'take_office' AND sim_time = ? AND data_json LIKE ?", [w.time, `%"office":${oid},%`]) ?? 0;
      this.h.endTerm(oid, `resigned to become ${office.title}`);
      if (!sameTime) this.h.succession(oid, person);
    }
    const contest = contestId !== null ? this.db.get<{ label: string; kind: string }>('SELECT label, kind FROM contest WHERE contest_id = ?', [contestId]) : null;
    this.h.startTerm(officeId, person, how ?? (contest ? `elected (${contest.label})` : 'elected'));
    this.h.commit(() => this.db.run('DELETE FROM pending_special WHERE office_id = ?', [officeId]));
    if (office.kind === 'president' || office.kind === 'governor' || office.kind === 'us_senator') this.h.news('inauguration', `${fullName(person)} takes office as ${office.title}`, `${fullName(person)} (${this.abbr(person.partyId)}) was sworn in.`, { personId });
  }

  /** A House vacancy triggers a special election (party-nominated candidates; no primary in Phase 2). */
  houseSpecial(officeId: number): void {
    const w = this.w; const o = w.officeById.get(officeId)!; const st = w.pack.states[o.stateIdx!]!;
    const today = easternDay(w.time);
    const y = daysToCivil(today).y;
    const nextGeneral = [y, y + 1].map(generalElectionDay).find((d) => d > today + 40)!;
    const nextRegular = [y, y + 1, y + 2].find((yy) => yy % 2 === 0 && generalElectionDay(yy) > today)!;
    // Skip specials when the regular election fills the seat soon anyway (the seat stays vacant until then).
    if (generalElectionDay(nextRegular) - today < 120 && this.state.plannedYears.includes(nextRegular)) return;
    let day = today + 95; while (weekday(day) !== 2) day++;
    if (nextGeneral - today < 160) day = nextGeneral;
    this.h.commit(() => {
      const eid = this.insertElection(day, 'special', o.stateIdx, null, daysToCivil(day).y, `${daysToCivil(day).y} ${st.name} special election (${o.title})`);
      this.db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [eid, o.id, 'special', null, o.stateIdx, o.districtIdx, 'plurality', `${daysToCivil(day).y} special ${o.title.replace('U.S. Representative, ', 'U.S. House, ')}`, 'set', null, null, null, null, null, null, daysToCivil(day).y]);
      const cid = Number(this.db.value('SELECT last_insert_rowid()'));
      const r = this.rng('house-special', o.id, day);
      [PARTY_D, PARTY_R].forEach((party, i) => {
        const pr = this.prospects(party, this.cdMargin(o.districtIdx!, daysToCivil(day).y));
        if (pr < 0.08 && r.bernoulli(0.5)) return;
        const c = this.newCandidate(r, party, o.stateIdx!, o.districtIdx, 0.1, daysToCivil(day).y);
        this.db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [cid, c.person.id, party, i, 0, null, 'running', c.quality]);
      });
      this.h.schedule(at(day, 6), 'special', { election: eid }, 6);
    });
    this.h.news('special', `Special election set for ${o.title}`, `Voters will fill the vacancy on ${formatDay(day, true)}.`, { officeId });
  }

  async special(electionId: number): Promise<void> {
    const e = this.db.get<{ year: number; state_idx: number; day: number }>('SELECT year, state_idx, day FROM election WHERE election_id = ?', [electionId])!;
    const rows = this.db.all<ContestRow>("SELECT * FROM contest WHERE election_id = ? AND status = 'set'", [electionId]).filter((c) => this.cands(c.contest_id).length > 0);
    if (!rows.length) return;
    const concurrent = e.day === generalElectionDay(e.year);
    const groups = [{ stateIdx: e.state_idx, kind: 'general' as const, party: 0, contests: rows.map((row) => ({ row, cands: this.cands(row.contest_id), officeKind: this.officeKindOf(row) })) }];
    const results = await this.realize(`special|${electionId}`, groups, concurrent ? (e.year % 4 === 0 ? 0 : TURNOUT_OFFSET.midterm) : TURNOUT_OFFSET.special, e.year, { day: e.day });
    await this.lockCount(e.day, 'special', `${e.year} ${this.w.pack.states[e.state_idx]!.name} special election`, [{ election_id: electionId, state_idx: e.state_idx }], rows, results);
  }

  /** Called when a Senate vacancy is filled by appointment or left open: the seat is filled at a special election. */
  senateSpecialNeeded(officeId: number, reason: string): void {
    this.db.run('INSERT OR REPLACE INTO pending_special VALUES (?,?,?)', [officeId, this.w.time, reason]);
  }
}

export function emptyElectionState(): ElectionState { return { tauE: null, turnoutTarget: null, env: {}, plannedYears: [] }; }
export { NONE16 };
