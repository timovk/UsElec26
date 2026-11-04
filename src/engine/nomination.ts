/**
 * The presidential nominating season (Phase 5): each party's primaries and caucuses on the 2016 calendar, delegate
 * allocation under each state's rules, Democratic superdelegates, momentum and withdrawals, the presumptive
 * nominee, and the convention — contested conventions go to multiple ballots.
 */
import { Rng } from '../core/rng';
import { daysToCivil, zonedToUtc, type DayNumber, type SimTime } from '../core/time';
import { fullName, PARTY_D, PARTY_R, type Person } from '../institutions/model';
import { allocateDemocratic, allocateRepublican, needed } from '../primaries/delegates';
import { NOMINATING_2016, DNC_MEMBERS } from '../rules/primaries2016';
import { ruleDay } from '../rules/elections2016';
import type { ContestResult } from '../archive/results';
import type { ContestRow } from './electionModel';
import type { ElectionEngine } from './elections';

const ET = 'America/New_York' as const;
const at = (day: DayNumber, h: number, m = 0): SimTime => { const c = daysToCivil(day); return zonedToUtc(c.y, c.m, c.d, h, m, ET); };
const PARTY_NAME: Record<number, string> = { 1: 'Democratic', 2: 'Republican' };

export class Nomination {
  constructor(private readonly E: ElectionEngine) {}
  private get w() { return this.E.w; }
  private get db() { return this.E.db; }
  private get h() { return this.E.host; }

  /**
   * An open field: create each state's primary or caucus on the party's calendar (sharing the state's primary
   * election when it falls on the same day), the national nomination record, and the superdelegates.
   */
  createSeason(year: number, party: number, field: { p: Person; q: number }[], nominationElection: number): void {
    const w = this.w, db = this.db, presOffice = w.offices.find((o) => o.kind === 'president')!;
    db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [nominationElection, presOffice.id, 'pres_nomination', party, null, null, 'delegates', `${year} ${PARTY_NAME[party]} presidential nomination`, 'set', null, null, null, null, null, null, year]);
    const nid = Number(db.value('SELECT last_insert_rowid()'));
    field.forEach((c, i) => db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [nid, c.p.id, party, i, 0, null, 'running', c.q]));
    for (const s of w.pack.states) {
      const rules = NOMINATING_2016[s.usps]?.[party === PARTY_D ? 'D' : 'R']; if (!rules) continue;
      const day = ruleDay(year, rules.date);
      let eid = db.value<number>("SELECT election_id FROM election WHERE state_idx = ? AND day = ? AND kind IN ('primary','pres_primary')", [s.idx, day]);
      if (eid === undefined) {
        db.run('INSERT INTO election(day, kind, state_idx, party_id, year, label, status) VALUES (?,?,?,?,?,?,?)', [day, 'pres_primary', s.idx, null, year, `${year} ${s.name} presidential ${rules.event === 'caucus' ? 'caucuses' : rules.event === 'convention' ? 'conventions' : 'primary'}`, 'scheduled']);
        eid = Number(db.value('SELECT last_insert_rowid()'));
        this.h.schedule(at(day, 21), 'primary', { election: eid }, 6);
      }
      db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [eid, presOffice.id, 'pres_primary', party, s.idx, null, rules.event, `${year} ${PARTY_NAME[party]} presidential ${rules.event === 'caucus' ? 'caucuses' : rules.event === 'convention' ? 'convention' : 'primary'} — ${s.name}`, 'set', null, null, null, nid, null, rules.delegates, year]);
      const cid = Number(db.value('SELECT last_insert_rowid()'));
      field.forEach((c, i) => db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [cid, c.p.id, party, i, 0, null, 'running', c.q]));
    }
    // Democratic superdelegates: the party's governors and members of Congress, plus DNC members (placeholders).
    if (party === PARTY_D) {
      for (const o of w.offices) {
        if (!['governor', 'us_senator', 'us_representative'].includes(o.kind)) continue;
        const t = w.current.get(o.id); if (!t || t.partyId !== PARTY_D) continue;
        db.run('INSERT OR IGNORE INTO superdelegate VALUES (?,?,?,?,?,?)', [year, t.personId, o.stateIdx, o.kind, null, null]);
      }
      for (const s of w.pack.states) for (let k = 0; k < DNC_MEMBERS(s.pop2016); k++) db.run('INSERT OR IGNORE INTO superdelegate VALUES (?,?,?,?,?,?)', [year, -(s.idx * 1000 + k + 1), s.idx, 'dnc', null, null]);
    }
  }

  /** Is a contest held under the nomination rules (state primaries and caucuses of the presidential season)? */
  static isNominating(c: ContestRow): boolean { return c.kind === 'pres_primary'; }

  /** Delegates and outcome of one state's contest (inside the decision transaction). */
  allocate(c: ContestRow, res: ContestResult, cands: { person: Person; cand: { candidacy_id: number; status: string } }[]): { winner: number; shares: number[]; pledged: number[]; unbound: number } {
    const w = this.w, db = this.db;
    const st = w.pack.states[c.state_idx!]!, rules = NOMINATING_2016[st.usps]![c.party_id === PARTY_D ? 'D' : 'R'];
    const K = cands.length;
    const statewide = new Array<number>(K).fill(0);
    for (const v of res.countyTotals.values()) for (let j = 0; j < K; j++) statewide[j]! += v[j]!;
    const byDistrict = [...res.cdTotals.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.slice(0, K));
    const live = cands.map((x) => x.cand.status !== 'withdrew');
    const masked = { statewide: statewide.map((v, j) => (live[j] ? v : 0)), byDistrict: byDistrict.map((v) => v.map((x, j) => (live[j] ? x : 0))) };
    const out = c.party_id === PARTY_D ? allocateDemocratic(rules.delegates, masked) : allocateRepublican(rules.delegates, rules.alloc, masked);
    cands.forEach((x, j) => { if (out.pledged[j]! > 0) db.run('INSERT OR REPLACE INTO delegate VALUES (?,?,?,?,?,?,?)', [c.year, c.party_id, c.state_idx, x.person.id, 'pledged', out.pledged[j]!, 'allocated']); });
    if (out.unbound > 0) db.run('INSERT OR REPLACE INTO delegate VALUES (?,?,?,?,?,?,?)', [c.year, c.party_id, c.state_idx, 0, 'unbound', out.unbound, 'allocated']);
    const tot = statewide.reduce((a, b) => a + b, 0);
    let win = 0; statewide.forEach((v, j) => { if (v > statewide[win]!) win = j; });
    return { winner: win, shares: statewide.map((v) => (tot > 0 ? v / tot : 0)), pledged: out.pledged, unbound: out.unbound };
  }

  /** Pledged delegates won so far by candidate (and unbound), for a party. */
  tally(year: number, party: number): Map<number, number> {
    return new Map(this.db.all<{ person_id: number; n: number }>("SELECT person_id, SUM(count) n FROM delegate WHERE year = ? AND party_id = ? GROUP BY person_id", [year, party]).map((r) => [r.person_id, r.n]));
  }
  totalDelegates(year: number, party: number): number {
    const pledged = this.w.pack.states.reduce((a, s) => a + (NOMINATING_2016[s.usps]?.[party === PARTY_D ? 'D' : 'R'].delegates ?? 0), 0);
    return pledged + (party === PARTY_D ? Number(this.db.value('SELECT COUNT(*) FROM superdelegate WHERE year = ?', [year]) ?? 0) : 0);
  }

  running(year: number, party: number): Person[] {
    return this.db.all<{ person_id: number }>("SELECT k.person_id FROM contest c JOIN candidacy k ON k.contest_id = c.contest_id WHERE c.kind = 'pres_nomination' AND c.year = ? AND c.party_id = ? AND k.status = 'running' ORDER BY k.ballot_order", [year, party])
      .map((r) => this.w.persons.get(r.person_id)!).filter(Boolean);
  }

  private withdraw(year: number, party: number, p: Person, day: DayNumber, reason: string, endorse: Person | null): void {
    // Off the ballot in the states still to vote; the national nomination record keeps the candidacy as withdrawn.
    this.db.run("DELETE FROM candidacy WHERE person_id = ? AND contest_id IN (SELECT contest_id FROM contest WHERE year = ? AND party_id = ? AND kind = 'pres_primary' AND status = 'set')", [p.id, year, party]);
    this.db.run("UPDATE candidacy SET status = 'withdrew' WHERE person_id = ? AND contest_id IN (SELECT contest_id FROM contest WHERE year = ? AND party_id = ? AND kind = 'pres_nomination')", [p.id, year, party]);
    const camp = this.E.season.st.campaigns[`NOM:${year}:${party}|${p.id}`]; if (camp) camp.withdrawn = true;
    this.h.news('withdrawal', `${fullName(p)} ends ${p.sex === 'F' ? 'her' : 'his'} presidential campaign`, `${reason}${endorse ? ` ${fullName(p)} endorsed ${fullName(endorse)}.` : ''}`, { personId: p.id }, at(day, 15));
    if (endorse) this.db.run('INSERT INTO endorsement(sim_time, endorser_person, endorser_label, person_id, race_key, kind) VALUES (?,?,?,?,?,?)', [at(day, 15), p.id, `Former candidate ${fullName(p)}`, endorse.id, `NN:${year}:${party}`, 'candidate']);
  }

  /**
   * After a day of contests: momentum from results against expectations, withdrawals, and the presumptive
   * nominee once someone holds a majority of all delegates (pledged, plus committed superdelegates) or is alone.
   */
  afterDay(year: number, party: number, day: DayNumber, outcomes: { person: number; share: number; delegates: number; expected: number | null }[]): void {
    const S = this.E.season.st, r = Rng.stream(this.w.seed, 'nomination', year, party, day);
    const dayDel = new Map<number, number>(); for (const o of outcomes) dayDel.set(o.person, (dayDel.get(o.person) ?? 0) + o.delegates);
    const topDay = [...dayDel].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    for (const o of outcomes) {
      const c = S.campaigns[`NOM:${year}:${party}|${o.person}`]; if (!c) continue;
      const surprise = o.expected !== null ? o.share * 100 - o.expected : 0;
      c.momentum += 0.004 * surprise + (topDay && topDay[0] === o.person ? 0.035 : 0);
    }
    const tally = this.tally(year, party);
    const field = this.running(year, party);
    const total = this.totalDelegates(year, party), need = needed(total);
    const supers = party === PARTY_D ? new Map(this.db.all<{ committed_to: number; n: number }>('SELECT committed_to, COUNT(*) n FROM superdelegate WHERE year = ? AND committed_to IS NOT NULL GROUP BY committed_to', [year]).map((x) => [x.committed_to, x.n])) : new Map<number, number>();
    const count = (id: number) => (tally.get(id) ?? 0) + (supers.get(id) ?? 0);
    const leader = [...field].sort((a, b) => count(b.id) - count(a.id) || a.id - b.id)[0];
    const allocated = [...tally.values()].reduce((a, b) => a + b, 0);
    const c = daysToCivil(day);
    // Withdrawals: weak delegate shares and polls once the early states have voted; never the leader.
    const avg = this.E.season.averageOf(`NN:${year}:${party}`);
    for (const p of field) {
      if (!leader || p.id === leader.id || field.length <= 1) continue;
      const share = allocated > 0 ? (tally.get(p.id) ?? 0) / allocated : 0;
      const poll = avg?.options[`p${p.id}`]?.mean ?? 100 / field.length;
      const early = c.m === 2 && c.d < 25;
      const camp = S.campaigns[`NOM:${year}:${party}|${p.id}`];
      const broke = camp ? camp.cash < 0.03 * camp.raised : false;
      const rank = [...field].sort((a, b) => count(b.id) - count(a.id) || a.id - b.id).findIndex((q) => q.id === p.id);
      let pOut = 0;
      if (early) pOut = poll < 5 ? 0.3 : rank >= 4 && poll < 10 ? 0.2 : 0;
      else if (share < 0.12 || poll < 10) pOut = 0.45;
      else if (rank >= 2 && (c.m > 3 || (c.m === 3 && c.d > 15))) pOut = 0.4;
      else if (share < 0.3 && count(leader.id) > 0.4 * total) pOut = 0.3;
      if (broke) pOut = Math.max(pOut, 0.5);
      if (S.presumptive[`${year}:${party}`] !== undefined) pOut = 0.6;
      if (pOut > 0 && r.bernoulli(pOut)) this.withdraw(year, party, p, day + 1, poll < 5 ? 'The campaign struggled to gain support.' : `${fullName(p)} trailed in delegates.`, r.bernoulli(0.6) ? leader : null);
    }
    const remaining = this.running(year, party);
    if (S.presumptive[`${year}:${party}`] === undefined && leader && (count(leader.id) >= need || remaining.length === 1)) {
      S.presumptive[`${year}:${party}`] = leader.id;
      this.h.news('nomination', `${fullName(leader)} becomes the presumptive ${PARTY_NAME[party]} nominee`, `${fullName(leader)} has ${count(leader.id)} delegates; ${need} are needed for the nomination.`, { personId: leader.id }, at(day + 1, 1));
    }
  }

  /** Superdelegates commit over the season, leaning toward the delegate leader and the experienced. */
  daily(year: number, day: DayNumber): void {
    if (!this.db.value<number>('SELECT 1 FROM superdelegate WHERE year = ? AND committed_to IS NULL LIMIT 1', [year])) return;
    const field = this.running(year, PARTY_D); if (field.length < 1) return;
    const r = Rng.stream(this.w.seed, 'superdelegates', year, day);
    const tally = this.tally(year, PARTY_D);
    const c = daysToCivil(day), progress = Math.min(1, Math.max(0, (c.m - 1) / 6));
    const presumptive = this.E.season.st.presumptive[`${year}:${PARTY_D}`];
    const rows = this.db.all<{ person_id: number; state_idx: number | null }>('SELECT person_id, state_idx FROM superdelegate WHERE year = ? AND committed_to IS NULL ORDER BY person_id', [year]);
    const weights = field.map((p) => Math.exp(2 * this.E.quality(p)) * (1 + (tally.get(p.id) ?? 0) / 100) ** 2);
    for (const x of rows) {
      if (!r.bernoulli(presumptive !== undefined ? 0.05 : 0.003 + 0.012 * progress)) continue;
      const home = this.w.persons.get(x.person_id)?.homeState;
      const pick = presumptive !== undefined ? field.find((p) => p.id === presumptive) ?? field[0]! : field[r.weighted(weights.map((wt, i) => wt * (field[i]!.homeState === home ? 3 : 1)))]!;
      this.db.run('UPDATE superdelegate SET committed_to = ?, since = ? WHERE year = ? AND person_id = ?', [pick.id, day, year, x.person_id]);
    }
  }

  /**
   * The convention: the presumptive nominee is nominated on the first ballot; otherwise ballots continue, with
   * delegates released over successive ballots drifting toward the leader, until someone has a majority.
   */
  convention(year: number, party: number, day: DayNumber): Person | null {
    const S = this.E.season.st, r = Rng.stream(this.w.seed, 'convention-ballots', year, party);
    const field = this.running(year, party);
    const all = this.db.all<{ person_id: number }>("SELECT k.person_id FROM contest c JOIN candidacy k ON k.contest_id = c.contest_id WHERE c.kind = 'pres_nomination' AND c.year = ? AND c.party_id = ? ORDER BY k.ballot_order", [year, party]).map((x) => this.w.persons.get(x.person_id)!).filter(Boolean);
    if (!all.length) return null;
    const tally = this.tally(year, party);
    const total = this.totalDelegates(year, party), need = needed(total);
    const supers = party === PARTY_D ? this.db.all<{ committed_to: number | null }>('SELECT committed_to FROM superdelegate WHERE year = ?', [year]) : [];
    let votes = new Map<number, number>();
    const live = field.length ? field : all;
    for (const p of all) votes.set(p.id, tally.get(p.id) ?? 0);
    // Delegates of withdrawn candidates and unbound delegates go to the remaining candidates (toward the leader).
    let free = (tally.get(0) ?? 0) + [...votes].filter(([id]) => !live.some((p) => p.id === id)).reduce((a, [, v]) => a + v, 0);
    for (const p of all) if (!live.some((q) => q.id === p.id)) votes.set(p.id, 0);
    for (const s of supers) { if (s.committed_to !== null && votes.has(s.committed_to) && live.some((p) => p.id === s.committed_to)) votes.set(s.committed_to, votes.get(s.committed_to)! + 1); else free++; }
    let ballot = 0, nominee: Person | null = null;
    const presumptive = S.presumptive[`${year}:${party}`];
    while (!nominee && ballot < 8) {
      ballot++;
      const lead = [...live].sort((a, b) => (votes.get(b.id) ?? 0) - (votes.get(a.id) ?? 0) || a.id - b.id)[0]!;
      // Free delegates split toward the leader (more so on later ballots).
      const tilt = Math.min(0.95, 0.45 + 0.12 * ballot);
      const next = new Map(votes);
      const share = (p: Person) => (p.id === lead.id ? tilt : (1 - tilt) / Math.max(1, live.length - 1));
      for (const p of live) next.set(p.id, (next.get(p.id) ?? 0) + Math.round(free * share(p)));
      const rows = [...next].filter(([, v]) => v > 0);
      for (const [id, v] of rows) this.db.run('INSERT OR REPLACE INTO convention_ballot VALUES (?,?,?,?,?)', [year, party, ballot, id, v]);
      const top = [...next].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
      if (top[1] >= need || (presumptive !== undefined && top[0] === presumptive) || ballot === 8) nominee = this.w.persons.get(top[0])!;
      else {
        // Released delegates: each further ballot frees a share of bound delegates, who move toward the leader.
        const release = Math.min(1, 0.35 * ballot);
        free = 0;
        for (const p of live) if (p.id !== top[0]) { const v = next.get(p.id) ?? 0; const moved = Math.round(v * release * r.range(0.3, 0.7)); next.set(p.id, v - moved); free += moved; }
        votes = next;
      }
    }
    if (nominee) {
      S.presumptive[`${year}:${party}`] = nominee.id;
      const nom = this.db.get<{ contest_id: number }>("SELECT contest_id FROM contest WHERE kind = 'pres_nomination' AND year = ? AND party_id = ?", [year, party])!;
      const cand = this.db.value<number>('SELECT candidacy_id FROM candidacy WHERE contest_id = ? AND person_id = ?', [nom.contest_id, nominee.id]);
      this.db.run("UPDATE candidacy SET status = CASE WHEN person_id = ? THEN 'won' ELSE (CASE status WHEN 'withdrew' THEN 'withdrew' ELSE 'lost' END) END WHERE contest_id = ?", [nominee.id, nom.contest_id]);
      this.db.run("UPDATE contest SET status = 'decided', winner_candidacy = ? WHERE contest_id = ?", [cand ?? null, nom.contest_id]);
      this.db.run("UPDATE contest SET status = 'decided' WHERE kind = 'pres_primary' AND year = ? AND party_id = ? AND status = 'set'", [year, party]);
      this.db.run("UPDATE election SET status = 'held', held_time = ? WHERE election_id = (SELECT election_id FROM contest WHERE contest_id = ?)", [at(day, 22), nom.contest_id]);
      this.h.news('convention', ballot > 1 ? `${fullName(nominee)} wins the ${PARTY_NAME[party]} nomination on the ${ordinal(ballot)} ballot` : `${fullName(nominee)} is nominated by the ${PARTY_NAME[party]} convention`,
        ballot > 1 ? `A contested convention: no candidate had a majority of the ${total} delegates on the first ballot.` : `${fullName(nominee)} received a majority of the ${total} delegates on the first ballot.`, { personId: nominee.id }, at(day, 23));
    }
    return nominee;
  }
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
export const NOMINATION_PARTIES = [PARTY_D, PARTY_R] as const;
