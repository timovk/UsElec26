/**
 * Universe genesis: the fictional United States of January 1, 2016.
 * Real geography and institutions; fictional electorate, parties' coalitions and politicians.
 * Everything is a deterministic function of (seed, geography pack, name data, engine version).
 */
import { Rng } from '../core/rng';
import { SIM_START, civilToDays, daysToCivil, nthWeekday, zonedToUtc, type SimTime } from '../core/time';
import type { GeoPack } from '../geo/pack';
import { NONE16 } from '../geo/pack';
import { MARG_STRIDE, buildPopulation } from '../population/population';
import { buLean, generateElectorate } from '../electorate/model';
import { BASE_PARTIES, PARTY_D, PARTY_R, PRE_SIM, fullName, type CareerEvent, type Chamber, type Office, type OfficeKind, type Person, type Term, type Tier } from '../institutions/model';
import { EXECUTIVE_DEPARTMENTS, SENATE_CLASS_NEXT_ELECTION, STATES_2016 } from '../rules/states2016';
import { NameGenerator, type NameData } from '../politicians/names';
import { generatePerson, preSimCareer } from '../politicians/generate';
import { aggregateLean, emptyPending, leanMargin, type World } from './world';
import { Districts } from './districts';

export interface GenesisInput { seed: string; name: string; pack: GeoPack; names: NameData }
export type Progress = (step: string, fraction: number) => void;

const SENATE_CLASS_TERM_START: Record<number, number> = { 3: 2011, 1: 2013, 2: 2015 };

export interface ScheduledAssumption { time: SimTime; officeId: number; personId: number; partyId: number; acquired: string }

export function genesis(input: GenesisInput, progress: Progress = () => {}): { world: World; careers: CareerEvent[]; scheduled: ScheduledAssumption[] } {
  const { seed, pack } = input;
  progress('Building the 2016 population', 0.05);
  const pop = buildPopulation(pack);
  progress('Generating a fictional electorate', 0.15);
  const electorate = generateElectorate(seed, pack, pop);
  progress('Computing political geography', 0.55);
  // Rounded to the stored precision (Float32) so a universe behaves identically before and after a reload.
  const raw = buLean(electorate, pack, pop);
  const bu = { dVotes: Float64Array.from(Float32Array.from(raw.dVotes)), votes: Float64Array.from(Float32Array.from(raw.votes)) };
  const lean = { bu, ...aggregateLean(bu, pack) };
  progress('Forming the government', 0.75);

  const world: World = {
    seed, name: input.name, startTime: SIM_START, time: SIM_START, pack, pop, electorate, lean,
    parties: BASE_PARTIES.map((p) => ({ ...p })), persons: new Map(), offices: [], officeById: new Map(), current: new Map(),
    vacancies: new Map(), chambers: [], districts: new Districts(pack), history: { env: {}, presidentTermNumber: 1 },
    ids: { person: 1, term: 1, career: 1, news: 1, event: 1 }, pending: emptyPending(),
  };
  const careers: CareerEvent[] = [];
  const names = new NameGenerator(input.names);
  const g = (...key: (string | number)[]) => Rng.stream(seed, 'genesis', ...key);

  // Electoral environment of the pre-simulation cycles (national swing, margin points, + = Democratic).
  const er = g('environment');
  let e = er.normal(0, 3);
  for (let y = 2006; y <= 2015; y++) { e = 0.35 * e + er.normal(0, 4.2); world.history.env[y] = Math.round(e * 10) / 10; }
  const env = (y: number) => world.history.env[y] ?? 0;
  const femaleShare = g('demographics').range(0.19, 0.3);

  // Constituency helpers ------------------------------------------------------------------------
  const S = pack.states.length;
  const stateRace = Array.from({ length: S }, () => new Float64Array(4));
  const cdRace = Array.from({ length: pack.cds.length }, () => new Float64Array(4));
  const stateBus: number[][] = Array.from({ length: S }, () => []);
  const cdBus: number[][] = Array.from({ length: pack.cds.length }, () => []);
  for (let b = 0; b < pack.bu.rows; b++) {
    const v = pop.vep[b]!; if (v <= 0) continue;
    const s = pack.counties[pack.bu.county[b]!]!.stateIdx, k = pack.bu.cd[b]!;
    stateBus[s]!.push(b); if (k !== NONE16 && k < pack.cds.length) cdBus[k]!.push(b);
    for (let r = 0; r < 4; r++) { const x = v * pop.marg[b * MARG_STRIDE + 5 + r]!; stateRace[s]![r]! += x; if (k < pack.cds.length) cdRace[k]![r]! += x; }
  }
  const homeCounty = (r: Rng, bus: number[]): number | null => {
    if (bus.length === 0) return null;
    const w = bus.map((b) => pop.vep[b]!);
    return pack.bu.county[bus[r.weighted(w)]!]!;
  };
  const platform = (party: number) => (party === PARTY_D ? electorate.params.platforms.D : electorate.params.platforms.R);
  const moderation = (party: number, margin: number, r: Rng) => {
    const hostile = (party === PARTY_D ? -margin : margin) / 100;
    return Math.min(0.75, Math.max(0, (hostile > 0 ? 0.15 + 1.3 * hostile : 0.1 - 0.4 * hostile * 0) + r.normal(0, 0.06)));
  };

  // Offices -------------------------------------------------------------------------------------
  const addOffice = (o: Omit<Office, 'id'>): Office => {
    const off = { ...o, id: world.offices.length + 1 }; world.offices.push(off); world.officeById.set(off.id, off); return off;
  };
  const addChamber = (c: Omit<Chamber, 'id' | 'composition' | 'compositionAsOf' | 'compositionProvenance'>): Chamber => {
    const ch: Chamber = { ...c, id: world.chambers.length + 1, composition: new Map(), compositionAsOf: SIM_START, compositionProvenance: PRE_SIM };
    world.chambers.push(ch); return ch;
  };
  const senate = addChamber({ kind: 'us_senate', stateIdx: null, name: 'United States Senate', seats: 100, termYears: 6 });
  const house = addChamber({ kind: 'us_house', stateIdx: null, name: 'United States House of Representatives', seats: 435, termYears: 2 });

  const install = (office: Office, spec: {
    party: number; tier: Tier; ageMean: number; ageSd: number; minAge: number; prominence: number; stateIdx: number; bus: number[];
    race: ArrayLike<number>; margin: number; since: number; start: SimTime; acquired: string;
    prior: Parameters<typeof preSimCareer>[2]['priorChances']; key: string;
  }): Person => {
    const r = g('person', spec.key);
    const total = spec.race[0]! + spec.race[1]! + spec.race[2]! + spec.race[3]! || 1;
    const person = generatePerson({
      id: world.ids.person++, tier: spec.tier, stateIdx: spec.stateIdx, homeCounty: homeCounty(r, spec.bus), partyId: spec.party,
      raceShares: Array.from(spec.race, (x) => x / total), femaleShare, ageMean: spec.ageMean, ageSd: spec.ageSd, minAge: spec.minAge,
      asOfYear: 2016, platform: platform(spec.party), moderation: moderation(spec.party, spec.margin, r), prominence: spec.prominence, createdTime: SIM_START,
    }, r, names);
    const birthYear = daysToCivil(person.birthDay).y;
    const since = Math.max(spec.since, birthYear + spec.minAge);
    for (const c of preSimCareer(person.id, r, { stateName: pack.states[spec.stateIdx]!.name, birthYear, currentTitle: office.title, currentSince: since, priorChances: spec.prior })) {
      careers.push({ ...c, id: world.ids.career++ });
    }
    world.persons.set(person.id, person);
    const term: Term = { id: world.ids.term++, officeId: office.id, personId: person.id, partyId: spec.party, start: spec.start, end: null, acquired: spec.acquired, endReason: null, provenance: PRE_SIM };
    world.current.set(office.id, term);
    person.bio = `${fullName(person)} (${person.sex === 'F' ? 'she' : 'he'}) has served as ${office.title} since ${since}.`;
    return person;
  };

  const draw = (margin: number, year: number, sd: number, r: Rng): number => (margin + env(year) + r.normal(0, sd) > 0 ? PARTY_D : PARTY_R);
  const nationalMargin = leanMargin({ dVotes: Float64Array.of(lean.national.d), votes: Float64Array.of(lean.national.t) }, 0);

  // Executive branch.
  const pr = g('presidency');
  const termNumber = pr.bernoulli(0.5) ? 2 : 1;
  world.history.presidentTermNumber = termNumber;
  const presParty = draw(nationalMargin, 2012, 2.5, pr);
  const inaug2013 = zonedToUtc(2013, 1, 20, 12, 0, 'America/New_York');
  const presHome = pr.weighted(pack.states.map((_, s) => (pack.states[s]!.usps === 'DC' ? 0 : pop.stateVep[s]!)));
  const president = addOffice({ kind: 'president', title: 'President of the United States', stateIdx: null, districtIdx: null, senateClass: null, chamberId: null, dept: null, rank: 0 });
  install(president, { party: presParty, tier: 'A', ageMean: 61, ageSd: 7, minAge: 45, prominence: 0.98, stateIdx: presHome, bus: stateBus[presHome]!, race: stateRace[presHome]!,
    margin: 0, since: termNumber === 2 ? 2009 : 2013, start: inaug2013, acquired: termNumber === 2 ? 'elected 2008; re-elected 2012' : 'elected 2012',
    prior: { governor: 0.4, senate: 0.45, house: 0.3, state_leg: 0.3 }, key: 'president' });
  const vpHome = (() => { let s = presHome; while (s === presHome || pack.states[s]!.usps === 'DC') s = pr.weighted(pack.states.map((_, i) => pop.stateVep[i]!)); return s; })();
  const vp = addOffice({ kind: 'vice_president', title: 'Vice President of the United States', stateIdx: null, districtIdx: null, senateClass: null, chamberId: null, dept: null, rank: 1 });
  install(vp, { party: presParty, tier: 'A', ageMean: 60, ageSd: 8, minAge: 40, prominence: 0.85, stateIdx: vpHome, bus: stateBus[vpHome]!, race: stateRace[vpHome]!,
    margin: 0, since: termNumber === 2 ? 2009 : 2013, start: inaug2013, acquired: termNumber === 2 ? 'elected 2008; re-elected 2012' : 'elected 2012',
    prior: { senate: 0.55, governor: 0.2, house: 0.4 }, key: 'vp' });
  EXECUTIVE_DEPARTMENTS.forEach(([dept, title], i) => {
    const o = addOffice({ kind: 'cabinet', title, stateIdx: null, districtIdx: null, senateClass: null, chamberId: null, dept, rank: 10 + i });
    const r = g('cabinet-home', dept);
    const home = r.weighted(pack.states.map((_, s) => pop.stateVep[s]!));
    const year = 2013 + r.int(3);
    install(o, { party: r.bernoulli(0.05) ? (presParty === PARTY_D ? PARTY_R : PARTY_D) : presParty, tier: 'A', ageMean: 59, ageSd: 8, minAge: 35, prominence: 0.35,
      stateIdx: home, bus: stateBus[home]!, race: stateRace[home]!, margin: 0, since: year, start: zonedToUtc(year, 1 + r.int(12), 1 + r.int(27), 12, 0, 'America/New_York'),
      acquired: 'appointed by the President; confirmed by the Senate', prior: { house: 0.2, governor: 0.1, senate: 0.1, statewide: 0.15 }, key: `cabinet-${dept}` });
  });

  // U.S. Senate and House.
  pack.states.forEach((st, s) => {
    const inst = STATES_2016[st.usps]; if (!inst) return;
    const m = leanMargin(lean.state, s);
    for (const cls of [...inst.senateClasses].sort()) {
      const r = g('senate', st.usps, cls);
      const year = SENATE_CLASS_NEXT_ELECTION[cls]! - 6;
      const party = draw(m, year, 9, r);
      const terms = 1 + Math.min(4, Math.floor(-Math.log(1 - r.float()) / 0.6));
      const o = addOffice({ kind: 'us_senator', title: `U.S. Senator from ${st.name}`, stateIdx: s, districtIdx: null, senateClass: cls, chamberId: senate.id, dept: null, rank: 100 + s * 3 + cls });
      install(o, { party, tier: 'A', ageMean: 62, ageSd: 10, minAge: 30, prominence: 0.45, stateIdx: s, bus: stateBus[s]!, race: stateRace[s]!, margin: m,
        since: SENATE_CLASS_TERM_START[cls]! - 6 * (terms - 1), start: zonedToUtc(SENATE_CLASS_TERM_START[cls]!, 1, 3, 12, 0, 'America/New_York'),
        acquired: `elected ${year}`, prior: { house: 0.45, governor: 0.1, statewide: 0.15, state_leg: 0.45, local: 0.15 }, key: `senate-${st.usps}-${cls}` });
    }
  });
  pack.cds.forEach((cd, k) => {
    if (cd.district === 98) return; // non-voting delegate districts are out of scope
    const st = pack.states[cd.stateIdx]!;
    const r = g('house', cd.geoid);
    const m = leanMargin(lean.cd, k);
    const party = draw(m, 2014, 7, r);
    const terms = 1 + Math.min(12, Math.floor(-Math.log(1 - r.float()) / 0.33));
    const label = cd.district === 0 ? 'at-large' : `${cd.district}`;
    const o = addOffice({ kind: 'us_representative', title: `U.S. Representative, ${st.usps}-${cd.district === 0 ? 'AL' : String(cd.district).padStart(2, '0')}`, stateIdx: cd.stateIdx, districtIdx: k, senateClass: null, chamberId: house.id, dept: null, rank: 1000 + k });
    install(o, { party, tier: 'B', ageMean: 57, ageSd: 10, minAge: 25, prominence: 0.15, stateIdx: cd.stateIdx, bus: cdBus[k]!, race: cdRace[k]!, margin: m,
      since: 2015 - 2 * (terms - 1), start: zonedToUtc(2015, 1, 3, 12, 0, 'America/New_York'), acquired: `elected 2014 (${st.name}'s ${label} district)`,
      prior: { state_leg: 0.55, local: 0.3 }, key: `house-${cd.geoid}` });
  });

  // State executives. States whose 2015 winners are inaugurated after January 1, 2016 (Louisiana,
  // Mississippi) start with the outgoing officeholders in place and a scheduled assumption of office.
  const scheduled: { time: SimTime; officeId: number; personId: number; partyId: number; acquired: string }[] = [];
  const inaugurationDay = (st: string, y: number): SimTime => {
    if (st === 'LA') return zonedToUtc(y, 1, nthWeekday(y, 1, 1, 2) - civilToDays(y, 1, 1) + 1, 12, 0, 'America/Chicago');
    if (st === 'MS') return zonedToUtc(y, 1, nthWeekday(y, 1, 1, 2) - civilToDays(y, 1, 1) + 2, 12, 0, 'America/Chicago');
    if (st === 'KY') return zonedToUtc(y - 1, 12, nthWeekday(y - 1, 12, 2, 2) - civilToDays(y - 1, 12, 1) + 1, 12, 0, 'America/New_York');
    return zonedToUtc(y, 1, nthWeekday(y, 1, 1, 2) - civilToDays(y, 1, 1) + 1, 12, 0, 'America/New_York');
  };
  pack.states.forEach((st, s) => {
    const inst = STATES_2016[st.usps]; if (!inst || !inst.governor) return;
    const m = leanMargin(lean.state, s);
    const r = g('state-exec', st.usps);
    const tYears = inst.governor.termYears;
    const lastYear = inst.governor.lastElection;
    const nextStart = inaugurationDay(st.usps, lastYear + 1);
    const pending = nextStart > SIM_START;                    // winners of lastYear not yet sworn in
    const year = pending ? lastYear - tYears : lastYear;       // election that produced the sitting officeholders
    const start = inaugurationDay(st.usps, year + 1);
    const govParty = draw(m, year, 11, r);
    const tl = inst.governor.termLimit;
    const second = tl.kind === 'consecutive' && tl.terms === 1 ? false : r.bernoulli(0.42);
    const execOffices: { office: Office; person: Person; party: number; separate: boolean }[] = [];
    const gov = addOffice({ kind: 'governor', title: `Governor of ${st.name}`, stateIdx: s, districtIdx: null, senateClass: null, chamberId: null, dept: null, rank: 200 + s });
    execOffices.push({ office: gov, party: govParty, separate: true, person: install(gov, { party: govParty, tier: 'A', ageMean: 59, ageSd: 8, minAge: 30, prominence: 0.45, stateIdx: s, bus: stateBus[s]!, race: stateRace[s]!, margin: m,
      since: second ? year + 1 - tYears : year + 1, start, acquired: second ? `re-elected ${year}` : `elected ${year}`,
      prior: { statewide: 0.35, house: 0.2, state_leg: 0.35, local: 0.2, senate: 0.03 }, key: `gov-${st.usps}` }) });
    const exec = (kind: OfficeKind, title: string, party: number, acquired: string, rank: number, separate: boolean) => {
      const o = addOffice({ kind, title, stateIdx: s, districtIdx: null, senateClass: null, chamberId: null, dept: null, rank });
      const person = install(o, { party, tier: 'B', ageMean: 54, ageSd: 9, minAge: 30, prominence: 0.15, stateIdx: s, bus: stateBus[s]!, race: stateRace[s]!, margin: m,
        since: year + 1 - (r.bernoulli(0.35) ? tYears : 0), start, acquired, prior: { state_leg: 0.5, local: 0.3 }, key: `${kind}-${st.usps}` });
      execOffices.push({ office: o, person, party, separate });
    };
    if (inst.ltGov === 'joint') exec('lt_governor', `Lieutenant Governor of ${st.name}`, govParty, `elected ${year} on a joint ticket`, 300 + s, false);
    else if (inst.ltGov === 'separate') exec('lt_governor', `Lieutenant Governor of ${st.name}`, draw(m, year, 8, r), `elected ${year}`, 300 + s, true);
    exec('attorney_general', `Attorney General of ${st.name}`, inst.agElected ? draw(m, year, 8, r) : govParty, inst.agElected ? `elected ${year}` : 'appointed', 400 + s, inst.agElected);
    if (inst.sos !== 'none') exec('secretary_of_state', `Secretary of State of ${st.name}`, inst.sos === 'elected' ? draw(m, year, 8, r) : govParty,
      inst.sos === 'elected' ? `elected ${year}` : inst.sos === 'appointed' ? 'appointed by the Governor' : 'elected by the legislature', 500 + s, inst.sos === 'elected');

    if (!pending) return;
    // The lastYear election (pre-simulation): incumbents continue with some probability; otherwise an officer-elect waits.
    const pr2 = g('state-exec-elect', st.usps);
    const newGovParty = draw(m, lastYear, 11, pr2);
    for (const x of execOffices) {
      const isGov = x.office.kind === 'governor';
      const party = isGov || !x.separate ? newGovParty : draw(m, lastYear, 8, pr2);
      const incumbentEligible = isGov ? !second : true;
      if (party === x.party && incumbentEligible && pr2.bernoulli(0.6)) {
        careers.push({ id: world.ids.career++, personId: x.person.id, yearFrom: lastYear, yearTo: null, simTime: null, kind: 'pre_sim_election',
          text: `Re-elected ${x.office.title} in ${lastYear}; new term begins in January ${lastYear + 1}`, provenance: PRE_SIM });
        continue;
      }
      const rr = g('person-elect', x.office.kind, st.usps);
      const elect = generatePerson({ id: world.ids.person++, tier: isGov ? 'A' : 'B', stateIdx: s, homeCounty: homeCounty(rr, stateBus[s]!), partyId: party,
        raceShares: Array.from(stateRace[s]!, (v) => v / (stateRace[s]!.reduce((a, b) => a + b, 0) || 1)), femaleShare, ageMean: isGov ? 56 : 52, ageSd: 9, minAge: 30,
        asOfYear: 2016, platform: platform(party), moderation: moderation(party, m, rr), prominence: isGov ? 0.35 : 0.12, createdTime: SIM_START }, rr, names);
      elect.bio = `${fullName(elect)} won the ${lastYear} election for ${x.office.title} and takes office in January ${lastYear + 1}.`;
      world.persons.set(elect.id, elect);
      for (const c of preSimCareer(elect.id, rr, { stateName: st.name, birthYear: daysToCivil(elect.birthDay).y, currentTitle: `${x.office.title}-elect`, currentSince: lastYear,
        priorChances: { statewide: 0.3, state_leg: 0.45, local: 0.25, house: 0.15 } })) careers.push({ ...c, id: world.ids.career++ });
      scheduled.push({ time: nextStart, officeId: x.office.id, personId: elect.id, partyId: party, acquired: `elected ${lastYear}` });
    }
  });

  // State legislatures: chamber compositions (individual legislators arrive with legislative elections in Phase 6).
  pack.states.forEach((st, s) => {
    const inst = STATES_2016[st.usps]; if (!inst) return;
    const m = leanMargin(lean.state, s);
    for (const [kind, ch] of [['state_upper', inst.upper], ['state_lower', inst.lower]] as const) {
      if (!ch) continue;
      const chamber = addChamber({ kind, stateIdx: s, name: `${st.name} ${ch.name}`, seats: ch.seats, termYears: ch.termYears });
      const r = g('legislature', st.usps, kind);
      const shareD = 1 / (1 + Math.exp(-(m + env(2014) + r.normal(0, 4)) / 8.5));
      const minor = r.bernoulli(0.08) ? 1 + r.int(2) : 0;
      const d = Math.round((ch.seats - minor) * shareD);
      chamber.composition.set(PARTY_D, d); chamber.composition.set(PARTY_R, ch.seats - minor - d);
      if (minor) chamber.composition.set(5, minor);
      const majority = d >= ch.seats - minor - d ? PARTY_D : PARTY_R, minority = majority === PARTY_D ? PARTY_R : PARTY_D;
      const lower = kind === 'state_lower';
      const presiding = lower ? (st.usps === 'NE' ? 'Speaker of the Legislature' : `Speaker of the ${st.name} ${ch.name}`) : `${st.name} Senate Majority Leader`;
      const leaders: [string, number][] = [[presiding, majority], [lower ? `${st.name} ${ch.name} Minority Leader` : `${st.name} Senate Minority Leader`, minority]];
      leaders.forEach(([title, party], i) => {
        const o = addOffice({ kind: 'state_leg_leader', title, stateIdx: s, districtIdx: null, senateClass: null, chamberId: chamber.id, dept: null, rank: 600 + s * 4 + (lower ? 2 : 0) + i });
        install(o, { party, tier: 'B', ageMean: 55, ageSd: 9, minAge: 25, prominence: 0.1, stateIdx: s, bus: stateBus[s]!, race: stateRace[s]!, margin: m,
          since: 2015 - 2 * r.int(4), start: zonedToUtc(2015, 1, 12, 12, 0, 'America/New_York'), acquired: 'elected by the chamber', prior: { local: 0.25 }, key: `${title}` });
      });
    }
  });

  // Congressional composition and leadership.
  const members = (kind: OfficeKind) => world.offices.filter((o) => o.kind === kind).map((o) => world.current.get(o.id)!);
  for (const [chamber, kind] of [[senate, 'us_senator'], [house, 'us_representative']] as const) {
    for (const t of members(kind)) chamber.composition.set(t.partyId!, (chamber.composition.get(t.partyId!) ?? 0) + 1);
  }
  const senD = senate.composition.get(PARTY_D) ?? 0, senR = senate.composition.get(PARTY_R) ?? 0;
  const senMaj = senD > senR ? PARTY_D : senR > senD ? PARTY_R : presParty;
  const houseMaj = (house.composition.get(PARTY_D) ?? 0) > (house.composition.get(PARTY_R) ?? 0) ? PARTY_D : PARTY_R;
  const pickLeader = (pool: Term[], party: number, key: string, exclude: Set<number>): Term => {
    const r = g('leader', key);
    let cands = pool.filter((t) => t.partyId === party && !exclude.has(t.personId));
    if (cands.length === 0) cands = pool.filter((t) => !exclude.has(t.personId));
    const w = cands.map((t) => { const p = world.persons.get(t.personId)!; return Math.exp(4 * p.traits.leadership + 2 * p.traits.ambition); });
    const pick = cands[r.weighted(w)]!; exclude.add(pick.personId); return pick;
  };
  const leaderPosts: [string, typeof senate, OfficeKind, number][] = [
    ['Speaker of the House', house, 'us_representative', houseMaj], ['House Majority Leader', house, 'us_representative', houseMaj],
    ['House Majority Whip', house, 'us_representative', houseMaj], ['House Minority Leader', house, 'us_representative', houseMaj === PARTY_D ? PARTY_R : PARTY_D],
    ['House Minority Whip', house, 'us_representative', houseMaj === PARTY_D ? PARTY_R : PARTY_D],
    ['Senate Majority Leader', senate, 'us_senator', senMaj], ['Senate Majority Whip', senate, 'us_senator', senMaj],
    ['Senate Minority Leader', senate, 'us_senator', senMaj === PARTY_D ? PARTY_R : PARTY_D], ['Senate Minority Whip', senate, 'us_senator', senMaj === PARTY_D ? PARTY_R : PARTY_D],
  ];
  const used = new Set<number>();
  leaderPosts.forEach(([title, chamber, kind, party], i) => {
    const t = pickLeader(members(kind), party, title, used);
    const o = addOffice({ kind: 'congress_leader', title, stateIdx: null, districtIdx: null, senateClass: null, chamberId: chamber.id, dept: null, rank: 30 + i });
    world.current.set(o.id, { id: world.ids.term++, officeId: o.id, personId: t.personId, partyId: party, start: zonedToUtc(2015, 1, 6, 12, 0, 'America/New_York'), end: null, acquired: 'elected by the party conference', endReason: null, provenance: PRE_SIM });
  });
  // President pro tempore: the longest-serving senator of the majority party.
  const careerSince = new Map<number, number>();
  for (const c of careers) if (c.kind === 'current_office' && c.yearFrom !== null) careerSince.set(c.personId, c.yearFrom);
  const ppt = members('us_senator').filter((t) => t.partyId === senMaj).sort((a, b) => (careerSince.get(a.personId)! - careerSince.get(b.personId)!) || a.personId - b.personId)[0]!;
  const pptOffice = addOffice({ kind: 'congress_leader', title: 'President pro tempore of the Senate', stateIdx: null, districtIdx: null, senateClass: null, chamberId: senate.id, dept: null, rank: 29 });
  world.current.set(pptOffice.id, { id: world.ids.term++, officeId: pptOffice.id, personId: ppt.personId, partyId: senMaj, start: zonedToUtc(2015, 1, 6, 12, 0, 'America/New_York'), end: null, acquired: 'elected by the Senate', endReason: null, provenance: PRE_SIM });

  world.pending = emptyPending();
  world.pending.news.push({ id: world.ids.news++, time: SIM_START, kind: 'universe', headline: 'A new political universe begins',
    body: `It is January 1, 2016. The ${presParty === PARTY_D ? 'Democratic' : 'Republican'} President is in the ${termNumber === 2 ? 'final year of a second' : 'fourth year of a first'} term. ` +
      `${senMaj === PARTY_D ? 'Democrats' : 'Republicans'} control the Senate ${Math.max(senD, senR)}–${Math.min(senD, senR)} and ${houseMaj === PARTY_D ? 'Democrats' : 'Republicans'} control the House.`,
    refs: {} });
  progress('Universe ready', 1);
  return { world, careers, scheduled };
}
