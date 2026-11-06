/**
 * Careers between elections (Phase 6): scandals and the resignations they lead to, other mid-term exits,
 * cabinet turnover, rare party switches, a new cabinet for a new President, and leadership elections when
 * each Congress convenes. Runs once a month (and on the specific occasions). Hazards: `careers/model`.
 */
import { Rng } from '../core/rng';
import { ageOn, daysToCivil, easternDay, zonedToUtc, type DayNumber, type SimTime } from '../core/time';
import { otherExitHazard, scandalHazard, scandalResignHazard, scandalSeverity, switchHazard } from '../careers/model';
import { PARTY_D, PARTY_R, fullName, type Office, type Person, type Term } from '../institutions/model';
import type { Db } from '../persistence/db';
import type { World } from './world';

export interface CareersState {
  /** Open scandals by person: severity (0–1), the month it broke (months since Jan 2016) and the office then held. */
  scandals: Record<string, { severity: number; month: number; officeId: number }>;
}
export const emptyCareersState = (): CareersState => ({ scandals: {} });

interface Host {
  world: World; db: Db;
  news(kind: string, headline: string, body: string, refs: Record<string, unknown>, time?: SimTime): void;
  endTerm(officeId: number, reason: string): Term | null;
  startTerm(officeId: number, person: Person, acquired: string): Term;
  vacate(officeId: number, reason: string): void;
  succession(officeId: number, departed: Person, cause: string): void;
  shockPresident(x: number): void;
  career(personId: number, kind: string, text: string): void;
  setParty(person: Person, party: number): void;
}

const MONTH0 = (day: DayNumber) => { const c = daysToCivil(day); return (c.y - 2016) * 12 + (c.m - 1); };
const ELIGIBLE = new Set(['president', 'vice_president', 'cabinet', 'us_senator', 'us_representative', 'governor', 'lt_governor', 'attorney_general', 'secretary_of_state',
  // Phase 7.2: down-ballot officers, board members and judges.
  'treasurer', 'auditor', 'superintendent', 'insurance_commissioner', 'agriculture_commissioner', 'labor_commissioner', 'land_commissioner', 'other_statewide',
  'commissioner', 'education_board', 'regent', 'justice', 'appellate_judge']);
const ABBR: Record<number, string> = { 1: 'D', 2: 'R', 3: 'L', 4: 'G', 5: 'I' };
const SCANDAL_KINDS = ['a campaign-finance investigation', 'an ethics complaint', 'questions over stock trades', 'allegations of misconduct', 'a report on undisclosed lobbying contacts', 'an inquiry into the use of official funds'];

export class CareersEngine {
  constructor(private readonly h: Host, public st: CareersState) {}
  private get w() { return this.h.world; }

  /** Scandal severity hanging over a person (0 when none or old). Used at filing for retirement and quality. */
  scandalOf(personId: number, day: DayNumber): number {
    const s = this.st.scandals[String(personId)]; if (!s) return 0;
    const months = MONTH0(day) - s.month;
    return months > 30 ? 0 : s.severity * Math.exp(-months / 18);
  }

  /** The first of each month. */
  monthly(day: DayNumber): void {
    const w = this.w, month = MONTH0(day);
    const r = Rng.stream(w.seed, 'careers', month);
    const terms = [...w.current.values()].sort((a, b) => a.officeId - b.officeId);
    for (const t of terms) {
      const o = w.officeById.get(t.officeId)!; if (!ELIGIBLE.has(o.kind)) continue;
      const p = w.persons.get(t.personId); if (!p || p.deathDay !== null) continue;
      if (w.current.get(o.id)?.personId !== p.id) continue; // already left this month
      const key = String(p.id);
      // Scandals.
      if (!this.st.scandals[key] && r.bernoulli(scandalHazard(p, o.kind))) {
        const sev = scandalSeverity(r.float(), p.traits.integrity);
        this.st.scandals[key] = { severity: sev, month, officeId: o.id };
        const what = SCANDAL_KINDS[r.int(SCANDAL_KINDS.length)]!;
        this.h.news('scandal', `${fullName(p)} faces ${what}`, `${o.title} ${fullName(p)} (${ABBR[p.partyId] ?? '?'}) is under scrutiny${sev > 0.6 ? '; party leaders are said to be alarmed' : ''}.`, { personId: p.id, officeId: o.id });
        this.h.career(p.id, 'scandal', `Faced ${what} as ${o.title}`);
        if (o.kind === 'president') this.h.shockPresident(-0.12 - 0.35 * sev);
        else if (o.kind === 'vice_president' || o.kind === 'cabinet') this.h.shockPresident(-0.04 * sev);
      }
      // Resignations: over a scandal, or for other reasons.
      const sc = this.st.scandals[key];
      const age = ageOn(p.birthDay, day);
      let reason: string | null = null;
      if (sc && sc.officeId === o.id && r.bernoulli(scandalResignHazard(sc.severity, month - sc.month, o.kind))) reason = 'resigned amid scandal';
      else if (r.bernoulli(otherExitHazard(age, o.kind))) reason = o.kind === 'cabinet' ? 'stepped down' : r.bernoulli(0.5) ? 'resigned for health reasons' : 'resigned to take a position outside government';
      if (reason) { this.resign(o, p, reason); continue; }
      // Party switches (Congress and governors only).
      if ((o.kind === 'us_senator' || o.kind === 'us_representative' || o.kind === 'governor') && (p.partyId === PARTY_D || p.partyId === PARTY_R)) {
        const plat = w.electorate.params.platforms;
        const own = p.partyId === PARTY_D ? plat.D : plat.R, other = p.partyId === PARTY_D ? plat.R : plat.D;
        if (r.bernoulli(switchHazard(p.traits.ideology, own, other))) {
          const to = p.partyId === PARTY_D ? PARTY_R : PARTY_D;
          this.h.setParty(p, to);
          this.h.news('party_switch', `${fullName(p)} switches parties`, `${o.title} ${fullName(p)} left the ${p.partyId === PARTY_R ? 'Democratic' : 'Republican'} Party to join the ${to === PARTY_D ? 'Democrats' : 'Republicans'}.`, { personId: p.id, officeId: o.id });
          this.h.career(p.id, 'party_switch', `Switched to the ${to === PARTY_D ? 'Democratic' : 'Republican'} Party while ${o.title}`);
        }
      }
    }
    // Old scandals fade from the record of open matters.
    for (const [k, s] of Object.entries(this.st.scandals)) if (month - s.month > 36) delete this.st.scandals[k];
  }

  private resign(o: Office, p: Person, reason: string): void {
    this.h.endTerm(o.id, reason);
    this.h.news('resignation', `${fullName(p)} ${reason.startsWith('resigned') ? 'resigns' : 'steps down'} as ${o.title}`, `${fullName(p)} (${ABBR[p.partyId] ?? '?'}) ${reason}.`, { personId: p.id, officeId: o.id });
    this.h.career(p.id, 'resignation', `${reason[0]!.toUpperCase()}${reason.slice(1)} as ${o.title}`);
    if (o.kind === 'president' || o.kind === 'governor') this.h.succession(o.id, p, 'resignation');
    else this.h.vacate(o.id, `${reason} (${fullName(p)})`);
  }

  /** A new President brings a new cabinet: the outgoing secretaries leave and successors are nominated. */
  newAdministration(): void {
    const w = this.w;
    for (const o of w.offices) {
      if (o.kind !== 'cabinet') continue;
      const t = w.current.get(o.id); if (!t) continue;
      this.h.endTerm(o.id, 'left with the outgoing administration');
      this.h.vacate(o.id, 'new administration');
    }
  }

  /**
   * A new Congress convenes (January 3 of odd years): each party conference chooses its leaders. The majority
   * party holds the Speakership and the majority posts; leaders still in the chamber and still in the
   * majority's or minority's party keep their posts, others are replaced by the members with most leadership.
   */
  newCongress(state = false): void {
    const w = this.w;
    const r = Rng.stream(w.seed, 'leadership', easternDay(w.time), state ? 1 : 0);
    const chambers = state ? w.chambers.filter((c) => c.kind === 'state_upper' || c.kind === 'state_lower') : w.chambers.filter((c) => c.kind === 'us_house' || c.kind === 'us_senate');
    for (const ch of chambers) {
      const memberKind = ch.kind === 'us_house' ? 'us_representative' : ch.kind === 'us_senate' ? 'us_senator' : ch.kind === 'state_upper' ? 'state_senator' : 'state_representative';
      const members = w.offices.filter((o) => o.kind === memberKind && o.chamberId === ch.id).map((o) => w.current.get(o.id)).filter((t): t is Term => !!t);
      if (!members.length) continue;
      const d = members.filter((t) => t.partyId === PARTY_D).length, rr = members.filter((t) => t.partyId === PARTY_R).length;
      const vpParty = w.current.get(w.offices.find((o) => o.kind === 'vice_president')!.id)?.partyId ?? PARTY_D;
      const maj = d > rr ? PARTY_D : rr > d ? PARTY_R : ch.kind === 'us_senate' ? vpParty : PARTY_D;
      const posts = w.offices.filter((o) => (o.kind === 'congress_leader' || o.kind === 'state_leg_leader') && o.chamberId === ch.id && !o.title.includes('pro tempore'));
      // A change of control in a state chamber is news (the presiding officer's party is the old majority).
      if (state) {
        const presiding = posts.find((o) => !/Minority/.test(o.title)); const prev = presiding ? w.current.get(presiding.id)?.partyId : undefined;
        if (prev !== undefined && prev !== maj && (prev === PARTY_D || prev === PARTY_R)) this.h.news('legislature', `${maj === PARTY_D ? 'Democrats' : 'Republicans'} take control of the ${ch.name}`, `${maj === PARTY_D ? d : rr} of ${ch.seats} seats.`, { chamberId: ch.id, state: ch.stateIdx });
      }
      const used = new Set<number>();
      for (const o of posts) {
        const party = /Minority/.test(o.title) ? (maj === PARTY_D ? PARTY_R : PARTY_D) : maj;
        const cur = w.current.get(o.id);
        const curPerson = cur ? w.persons.get(cur.personId) : undefined;
        const stillMember = cur && members.some((t) => t.personId === cur.personId && t.partyId === party);
        if (cur && stillMember && cur.partyId === party && !used.has(cur.personId)) { used.add(cur.personId); continue; }
        if (cur) this.h.endTerm(o.id, curPerson && cur.partyId !== party ? 'party lost the majority' : 'replaced by the party conference');
        const pool = members.filter((t) => t.partyId === party && !used.has(t.personId));
        if (!pool.length) continue;
        const pick = pool[r.weighted(pool.map((t) => Math.exp(4 * w.persons.get(t.personId)!.traits.leadership + (ch.kind === 'us_senate' ? 0 : 0))))]!;
        used.add(pick.personId);
        const person = w.persons.get(pick.personId)!;
        this.h.startTerm(o.id, person, 'elected by the party conference');
        this.h.news('leadership', `${fullName(person)} chosen as ${o.title}`, `${fullName(person)} (${ABBR[person.partyId] ?? '?'}) will lead in the new Congress.`, { personId: person.id, officeId: o.id });
      }
    }
  }
}

export { zonedToUtc };
