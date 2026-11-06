/**
 * Government between elections (Phase 6): Congress takes up major bills (recorded with every roll call), the
 * President signs or vetoes, Congress may override; enacted laws move national policy (the status quo) and
 * the President's standing. Minor legislation is summarized per year, and each state's legislative session
 * is summarized (laws, vetoes, a late budget). Government stays subordinate to elections: it runs monthly.
 */
import { Rng } from '../core/rng';
import { encodeBundle } from '../core/codec';
import { daysToCivil, zonedToUtc, type DayNumber, type SimTime } from '../core/time';
import { draftBill, presidentSigns, rollCall, type Bill, type Member, type Vec } from '../government/congress';
import { PARTY_D, PARTY_R, fullName, type Person } from '../institutions/model';
import type { Db } from '../persistence/db';
import { leanMargin, type World } from './world';
import { electionLawSession } from './electionReform';

export interface GovernmentState {
  /** National policy in the issue space (moves when laws are enacted). */
  statusQuo: Vec;
  /** Reconciliation bill already used this year. */
  reconciliationYear: number | null;
  year: { major: number; vetoes: number; overrides: number };
}
export const emptyGovernmentState = (platforms: { D: number[]; R: number[] }): GovernmentState => ({
  statusQuo: platforms.D.map((x, i) => (x + platforms.R[i]!) / 2) as Vec, reconciliationYear: null, year: { major: 0, vetoes: 0, overrides: 0 },
});

interface Host {
  world: World; db: Db;
  news(kind: string, headline: string, body: string, refs: Record<string, unknown>, time?: SimTime): void;
  shockPresident(x: number): void;
}

const ET = 'America/New_York';
export const congressNumber = (year: number) => Math.floor((year - 1789) / 2) + 1;

export class GovernmentEngine {
  constructor(private readonly h: Host, public st: GovernmentState) {}
  private get w() { return this.h.world; }

  private members(kind: 'us_representative' | 'us_senator'): Member[] {
    const w = this.w;
    return w.offices.filter((o) => o.kind === kind).flatMap((o) => {
      const t = w.current.get(o.id); if (!t) return [];
      const p = w.persons.get(t.personId); if (!p) return [];
      const lean = kind === 'us_representative' ? leanMargin(w.lean.cd, o.districtIdx!) : leanMargin(w.lean.state, o.stateIdx!);
      return [{ personId: p.id, party: t.partyId ?? p.partyId, ideology: p.traits.ideology, lean }];
    }).sort((a, b) => a.personId - b.personId);
  }

  private majority(ms: Member[], tiebreak: number): number {
    const d = ms.filter((m) => m.party === PARTY_D).length, r = ms.filter((m) => m.party === PARTY_R).length;
    return d > r ? PARTY_D : r > d ? PARTY_R : tiebreak;
  }

  /** Mid-month: Congress may take up a major bill. */
  async monthly(day: DayNumber): Promise<void> {
    const w = this.w, c = daysToCivil(day), db = this.h.db;
    if (c.m === 8) return;                                                // August recess
    const r = Rng.stream(w.seed, 'congress', c.y, c.m);
    const presO = w.offices.find((o) => o.kind === 'president')!, pres = w.current.get(presO.id);
    const president = pres ? w.persons.get(pres.personId) : undefined;
    const presParty = pres?.partyId ?? PARTY_D;
    const vpParty = w.current.get(w.offices.find((o) => o.kind === 'vice_president')!.id)?.partyId ?? presParty;
    const house = this.members('us_representative'), senate = this.members('us_senator');
    const hMaj = this.majority(house, PARTY_D), sMaj = this.majority(senate, vpParty);
    const unified = hMaj === sMaj && sMaj === presParty;
    const campaign = c.y % 2 === 0 && c.m >= 9 && c.m <= 11;
    if (!r.bernoulli(campaign ? 0.15 : unified ? 0.55 : 0.4)) return;
    const plat = w.electorate.params.platforms;
    const dParty = plat.D.map((x, i) => x - plat.R[i]!);
    const reconciliation = unified && this.st.reconciliationYear !== c.y && c.m >= 3 && c.m <= 9 && r.bernoulli(0.35);
    const bill: Bill = draftBill(r, hMaj === PARTY_D ? plat.D : plat.R, this.st.statusQuo, hMaj, c.y, reconciliation);
    const t0 = zonedToUtc(c.y, c.m, c.d, 15, 0, ET);
    const congress = congressNumber(c.y);
    db.run('INSERT INTO bill(congress, title, topic, introduced, sponsor_party, position_json, salience, reconciliation, status, enacted_time) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [congress, bill.title, bill.topic, t0, bill.sponsorParty, JSON.stringify(bill.position.map((x) => Math.round(1000 * x) / 1000)), bill.salience, reconciliation ? 1 : 0, 'introduced', null]);
    const billId = Number(db.value('SELECT last_insert_rowid()'));
    const record = async (chamber: string, question: string, rc: { votes: { personId: number; yea: boolean }[]; yea: number; nay: number }, passed: boolean, time: SimTime) => {
      const yea = Int32Array.from(rc.votes.filter((v) => v.yea).map((v) => v.personId)), nay = Int32Array.from(rc.votes.filter((v) => !v.yea).map((v) => v.personId));
      db.run('INSERT INTO roll_call(bill_id, chamber, sim_time, question, yea, nay, passed, votes) VALUES (?,?,?,?,?,?,?,?)', [billId, chamber, time, question, rc.yea, rc.nay, passed ? 1 : 0, await encodeBundle({ yea, nay })]);
    };
    const setStatus = (s: string) => db.run('UPDATE bill SET status = ? WHERE bill_id = ?', [s, billId]);
    const mLabel = PARTY_ABBR[hMaj]!;
    // House.
    const hv = rollCall(house, bill, this.st.statusQuo, dParty, r);
    const hPass = hv.yea > hv.nay;
    await record('house', 'On passage', hv, hPass, t0);
    if (!hPass) { setStatus('failed in the House'); this.h.news('congress', `House rejects the ${bill.title}`, `The ${mLabel} majority's bill failed ${hv.yea}–${hv.nay}.`, { billId }, t0); return; }
    // Senate: cloture at 60, except reconciliation (a simple majority; the Vice President breaks ties).
    const t1 = t0 + 9 * 1440;
    const sv = rollCall(senate, bill, this.st.statusQuo, dParty, r);
    const sPass = reconciliation ? sv.yea > sv.nay || (sv.yea === sv.nay && vpParty === bill.sponsorParty) : sv.yea >= 60;
    await record('senate', reconciliation ? 'On passage (reconciliation)' : 'On the motion to invoke cloture', sv, sPass, t1);
    if (reconciliation) this.st.reconciliationYear = c.y;
    if (!sPass) {
      setStatus(reconciliation ? 'failed in the Senate' : 'filibustered in the Senate');
      this.h.news('congress', reconciliation ? `Senate rejects the ${bill.title}` : `Senate filibuster blocks the ${bill.title}`, `The House passed it ${hv.yea}–${hv.nay}; in the Senate it got ${sv.yea} votes${reconciliation ? '' : ', short of the 60 needed to end debate'}.`, { billId }, t1);
      return;
    }
    this.h.news('congress', `Congress passes the ${bill.title}`, `House ${hv.yea}–${hv.nay}, Senate ${sv.yea}–${sv.nay}. The bill goes to the President.`, { billId }, t1);
    // The President.
    const t2 = t1 + 6 * 1440;
    const signs = president ? presidentSigns(president.traits.ideology, bill, this.st.statusQuo, presParty === bill.sponsorParty) : true;
    if (signs) { this.enact(billId, bill, t2, president, true); return; }
    this.st.year.vetoes++;
    setStatus('vetoed');
    this.h.news('congress', `President ${president ? fullName(president) : ''} vetoes the ${bill.title}`.replace('  ', ' '), 'Congress would need two-thirds of each chamber to override.', { billId }, t2);
    // Override: two-thirds of those voting in each chamber.
    const t3 = t2 + 10 * 1440;
    const ho = rollCall(house, bill, this.st.statusQuo, dParty, r), so = rollCall(senate, bill, this.st.statusQuo, dParty, r);
    const hOk = 3 * ho.yea >= 2 * (ho.yea + ho.nay), sOk = 3 * so.yea >= 2 * (so.yea + so.nay);
    await record('house', 'On overriding the veto', ho, hOk, t3);
    if (hOk) await record('senate', 'On overriding the veto', so, sOk, t3 + 1440);
    if (hOk && sOk) { this.st.year.overrides++; this.h.shockPresident(-0.05); this.enact(billId, bill, t3 + 1440, president, false); this.h.news('congress', `Congress overrides the veto of the ${bill.title}`, `House ${ho.yea}–${ho.nay}, Senate ${so.yea}–${so.nay}.`, { billId }, t3 + 1440); }
    else this.h.news('congress', `Veto of the ${bill.title} stands`, `The override failed${hOk ? ` in the Senate, ${so.yea}–${so.nay}` : ` in the House, ${ho.yea}–${ho.nay}`}.`, { billId }, t3);
  }

  private enact(billId: number, bill: Bill, time: SimTime, president: Person | undefined, signed: boolean): void {
    const db = this.h.db;
    db.run("UPDATE bill SET status = ?, enacted_time = ? WHERE bill_id = ?", [signed ? 'signed into law' : 'enacted over a veto', time, billId]);
    // Policy moves toward the new law.
    this.st.statusQuo = this.st.statusQuo.map((x, i) => x + 0.55 * (bill.position[i]! - x)) as Vec;
    this.st.year.major++;
    if (signed) {
      this.h.shockPresident(0.025 + 0.04 * bill.salience * (president && president.partyId === bill.sponsorParty ? 1 : 0.4));
      this.h.news('congress', `${president ? `President ${fullName(president)}` : 'The President'} signs the ${bill.title} into law`, `A ${bill.topic === 'budget' ? 'budget' : bill.topic} measure from the ${PARTY_ABBR[bill.sponsorParty] === 'D' ? 'Democratic' : 'Republican'} majority.`, { billId }, time);
    }
  }

  /** December 31: the year's minor legislation and each state's session, summarized. */
  yearEnd(year: number): void {
    const w = this.w, db = this.h.db;
    const r = Rng.stream(w.seed, 'legislation-year', year);
    const presO = w.offices.find((o) => o.kind === 'president')!;
    const presParty = w.current.get(presO.id)?.partyId ?? PARTY_D;
    const hMaj = this.majority(this.members('us_representative'), PARTY_D), sMaj = this.majority(this.members('us_senator'), presParty);
    const unified = hMaj === sMaj && sMaj === presParty;
    const minor = Math.max(40, Math.round(r.normal(unified ? 190 : 130, 30)));
    db.run('INSERT OR REPLACE INTO congress_year VALUES (?,?,?,?,?,?,?)', [year, congressNumber(year), minor, this.st.year.major, this.st.year.vetoes, this.st.year.overrides, JSON.stringify({ unified, houseMajority: hMaj, senateMajority: sMaj, statusQuo: this.st.statusQuo.map((x) => Math.round(1000 * x) / 1000) })]);
    this.st.year = { major: 0, vetoes: 0, overrides: 0 };
    // State legislative sessions: unified states pass more, divided ones veto more and run late budgets more often.
    for (const st of w.pack.states) {
      const gov = w.offices.find((o) => o.kind === 'governor' && o.stateIdx === st.idx);
      const govParty = gov ? w.current.get(gov.id)?.partyId ?? null : null;
      const chambers = w.chambers.filter((c) => (c.kind === 'state_upper' || c.kind === 'state_lower') && c.stateIdx === st.idx);
      const ctl = chambers.map((c) => { const d = c.composition.get(PARTY_D) ?? 0, rr = c.composition.get(PARTY_R) ?? 0; return d > rr ? PARTY_D : rr > d ? PARTY_R : 0; });
      const stateUnified = ctl.length > 0 && ctl.every((x) => x === govParty);
      const size = 120 + 260 * Math.sqrt(w.pop.stateVep[st.idx]! / 5e6);
      const laws = Math.max(20, Math.round(r.normal(size * (stateUnified ? 1.15 : 0.85), size * 0.15)));
      const vetoes = Math.round(stateUnified ? r.range(0, 6) : r.range(4, 40));
      const overridden = Math.round(vetoes * (stateUnified ? 0 : r.range(0, 0.25)));
      const late = !stateUnified && r.bernoulli(0.22);
      db.run('INSERT OR REPLACE INTO state_session VALUES (?,?,?,?,?,?,?)', [year, st.idx, laws, vetoes, overridden, late ? 1 : 0, stateUnified ? 1 : 0]);
      // Election law (Phase 7.1): the session may change how the state elects, from the next January 1.
      electionLawSession(this.h, year, st.idx, stateUnified ? govParty : null);
      if (late) this.h.news('state_government', `${st.name} misses its budget deadline`, 'The Governor and the legislature, controlled by different parties, could not agree in time.', { state: st.idx }, zonedToUtc(year, 7, 1, 12, 0, ET));
    }
  }
}

const PARTY_ABBR: Record<number, string> = { 1: 'D', 2: 'R', 3: 'L', 4: 'G', 5: 'I' };
