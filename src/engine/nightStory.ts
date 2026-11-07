/**
 * Facts for the night's alerts and commentary that the record does not carry: names, who held each seat
 * before the election, when each party last won it, eligible voters and recount thresholds — all as of the
 * ballot lock, from the archive.
 */
import { buildStory, type StoryContext, type StoryRace } from '../broadcast/story';
import { fullName, optionPerson } from '../institutions/model';
import { daysToCivil, easternDay, type SimTime } from '../core/time';
import type { NightRecord, Story } from '../counting/record';
import type { Db } from '../persistence/db';
import { COUNTING_RULES_2016 } from '../rules/counting2016';
import type { World } from './world';
import { cdCode, cdSpoken } from '../geo/pack';

const yearOf = (t: SimTime) => daysToCivil(easternDay(t)).y;
const OFF: Record<string, string> = { president: 'President', us_senator: 'Senate', us_representative: 'House', governor: 'Governor', lt_governor: 'Lt. Governor', attorney_general: 'Attorney General', secretary_of_state: 'Secretary of State',
  treasurer: 'Treasurer', auditor: 'Auditor', superintendent: 'Superintendent', insurance_commissioner: 'Insurance', agriculture_commissioner: 'Agriculture', labor_commissioner: 'Labor',
  land_commissioner: 'Land', other_statewide: 'Statewide', justice: 'Supreme Court' };

/** Short race label used on screen ("PA Senate", "NC-9", "ME President · ME-2"). */
export function raceShort(db: Db, w: World, r: NightRecord['races'][number]): string {
  const st = w.pack.states[r.stateIdx]!;
  if (r.office === 'ballot_measure') return `${st.usps} ${db.value<string>('SELECT name FROM ballot_measure WHERE contest_id = ?', [r.contestId]) ?? 'measure'}`;
  if (r.office === 'us_representative') {
    const cd = db.value<number>('SELECT district_idx FROM contest WHERE contest_id = ?', [r.contestId]);
    return cd !== undefined && cd !== null ? cdCode({ states: w.pack.states, cds: w.districts.cds }, cd) : st.usps;
  }
  return `${st.usps} ${OFF[r.office] ?? r.office}${r.cd >= 0 ? ` · ${cdCode({ states: w.pack.states, cds: w.districts.cds }, r.cd)}` : ''}`;
}

export function storyContext(db: Db, w: World, rec: Omit<NightRecord, 'story'>, eligibleByElection?: Map<number, number>): StoryContext {
  const year = yearOf(rec.lockTime);
  const races: StoryRace[] = rec.races.map((r) => {
    const st = w.pack.states[r.stateIdx]!;
    const c = db.get<{ office_id: number | null; kind: string; election_id: number; district_idx: number | null }>('SELECT office_id, kind, election_id, district_idx FROM contest WHERE contest_id = ?', [r.contestId]);
    const candidates = r.candidacyIds.map((cid, j) => {
      const pid = db.value<number>('SELECT person_id FROM candidacy WHERE candidacy_id = ?', [cid]);
      const p = pid !== undefined ? w.persons.get(pid) ?? optionPerson(pid) : undefined;
      return { name: p ? fullName(p) : 'the candidate', party: r.parties[j]! };
    });
    let prevParty: number | null = null;
    const lastWon: Record<number, number> = {};
    if (r.office === 'president') {
      // The state's previous presidential winner (none before the first simulated cycle).
      if (r.cd < 0) {
        const rows = db.all<{ year: number; party_id: number }>("SELECT c.year, k.party_id FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy WHERE c.kind = 'pres_state' AND c.state_idx = ? AND c.year < ? ORDER BY c.year", [r.stateIdx, year]);
        for (const x of rows) lastWon[x.party_id] = x.year;
        prevParty = rows.length ? rows[rows.length - 1]!.party_id : null;
      }
    } else if (c?.office_id !== null && c?.office_id !== undefined) {
      const terms = db.all<{ party_id: number | null; start_time: number; end_time: number | null }>('SELECT party_id, start_time, end_time FROM office_term WHERE office_id = ? AND start_time <= ? ORDER BY start_time', [c.office_id, rec.lockTime]);
      for (const t of terms) if (t.party_id) lastWon[t.party_id] = yearOf(t.start_time);
      const held = [...terms].reverse().find((t) => t.end_time === null || t.end_time > rec.lockTime) ?? terms[terms.length - 1];
      prevParty = held?.party_id ?? null;
    }
    const statewide = r.office !== 'us_representative' && r.cd < 0;
    const eligible = statewide && c ? (eligibleByElection?.get(c.election_id) ?? db.value<number>('SELECT eligible FROM election_turnout WHERE election_id = ? AND state_idx = ?', [c.election_id, r.stateIdx]) ?? 0) : 0;
    return {
      label: r.label.replace(/^\d{4} /, ''), short: raceShort(db, w, r), ...(r.rcv ? { rcv: true } : {}),
      district: r.office === 'us_representative' && c?.district_idx !== null && c?.district_idx !== undefined ? cdSpoken({ states: w.pack.states, cds: w.districts.cds }, c.district_idx) : r.cd >= 0 ? cdSpoken({ states: w.pack.states, cds: w.districts.cds }, r.cd) : undefined, office: r.office, state: st.usps, stateName: st.name, cd: r.cd, ev: r.ev,
      candidates, prevParty, lastWon, eligible, recount: COUNTING_RULES_2016[st.usps]?.recountAuto ?? 0,
    };
  });
  const rjNames: Record<number, string> = {};
  for (const rj of new Set(rec.parts.rj)) rjNames[rj] = w.pack.rj[rj]?.name ?? 'a county';
  return { seed: w.seed, year, races, rjNames };
}

export function nightStory(db: Db, w: World, rec: Omit<NightRecord, 'story'>, eligibleByElection?: Map<number, number>): Story {
  return buildStory(rec, storyContext(db, w, rec, eligibleByElection));
}
