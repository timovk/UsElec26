/**
 * Election-law reform in the states (Phase 7.1): each state's legislative session (summarized on December 31)
 * may change how the state elects. Rules change only this way — through simulated law — from the real baseline of
 * January 1, 2016; nothing from the real world's later history is imported (docs/architecture/03 §3.4). Ballot
 * initiatives join from Phase 7.3. Every change takes effect on the next January 1 and applies only to elections
 * held from then on.
 *
 * The model is deliberately sparse (a few changes per decade nationally):
 *  - **Ranked-choice voting** is adopted after "spoiler" outcomes (a winner below 50% while a minor or independent
 *    candidate took more than the winning margin), most readily when the party that lost such a race controls the
 *    state; otherwise only rarely. It applies to party primaries and to general elections for Congress or for every
 *    office. It is repealed most readily when ranked ballots overturned a first-round leader whose party now
 *    controls the state.
 *  - **Primary systems** occasionally change between open, semi-closed and closed party primaries.
 */
import { Rng } from '../core/rng';
import { civilToDays, formatDay, zonedToUtc } from '../core/time';
import { PARTY_D, PARTY_R } from '../institutions/model';
import type { Db } from '../persistence/db';
import type { LawChange, LawChangeFields } from '../rules/electionLaw';
import type { PrimaryType } from '../rules/elections2016';
import { enactLaw } from './lawStore';
import type { World } from './world';

const PARTY_NAME: Record<number, string> = { 1: 'Democrats', 2: 'Republicans' };

interface Host { world: World; db: Db; news(kind: string, headline: string, body: string, refs: Record<string, unknown>, time?: number): void }

/** Statewide and federal general elections of the last two years in a state: winners below 50% with a spoiler, and ranked-choice reversals. */
function recentOutcomes(db: Db, stateIdx: number, year: number): { spoilerLosers: number[]; rcvReversedLeaders: number[] } {
  const rows = db.all<{ contest_id: number; method: string; winner: number; winner_party: number }>(
    `SELECT c.contest_id, c.method, c.winner_candidacy AS winner, k.party_id AS winner_party FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy LEFT JOIN office o ON o.office_id = c.office_id
     WHERE c.state_idx = ? AND c.year BETWEEN ? AND ? AND c.kind IN ('general','special','pres_state') AND c.status IN ('decided','certified')
       AND (o.kind IS NULL OR o.kind NOT IN ('state_senator','state_representative')) ORDER BY c.contest_id`, [stateIdx, year - 1, year]);
  const spoilerLosers: number[] = [], rcvReversedLeaders: number[] = [];
  for (const c of rows) {
    const t = db.all<{ candidacy_id: number; votes: number; party_id: number }>('SELECT t.candidacy_id, t.votes, k.party_id FROM contest_total t JOIN candidacy k ON k.candidacy_id = t.candidacy_id WHERE t.contest_id = ? AND t.rev = (SELECT MAX(rev) FROM contest_total WHERE contest_id = ?) ORDER BY t.votes DESC', [c.contest_id, c.contest_id]);
    const valid = t.reduce((a, x) => a + x.votes, 0); if (valid <= 0 || t.length < 2) continue;
    const top = t[0]!, second = t[1]!;
    if (c.method === 'rcv') { if (top.candidacy_id !== c.winner) rcvReversedLeaders.push(top.party_id); continue; }
    const margin = (top.votes - second.votes) / valid;
    const spoiler = t.slice(2).some((x) => x.party_id !== PARTY_D && x.party_id !== PARTY_R && x.votes / valid > margin);
    if (top.votes / valid < 0.5 && spoiler && (second.party_id === PARTY_D || second.party_id === PARTY_R)) spoilerLosers.push(second.party_id);
  }
  return { spoilerLosers, rcvReversedLeaders };
}

/** The session's election-law decisions for one state (called with the state's party control). */
export function electionLawSession(h: Host, year: number, stateIdx: number, control: number | null): LawChange | null {
  const w = h.world, db = h.db;
  const st = w.pack.states[stateIdx]!;
  const effective = civilToDays(year + 1, 1, 1);
  const law = w.law.on(stateIdx, effective);
  const r = Rng.stream(w.seed, 'election-law', year, stateIdx);
  const { spoilerLosers, rcvReversedLeaders } = recentOutcomes(db, stateIdx, year);
  const ranked = law.rcv.general !== 'none' || law.rcv.primaries;
  let change: LawChangeFields | null = null, summary = '';
  if (!ranked && law.primaryType !== 'jungle' && law.primaryType !== 'top_four') {
    const harmed = spoilerLosers.filter((p) => p === control).length;
    const p = 0.003 + 0.04 * Math.min(2, spoilerLosers.length) + 0.12 * Math.min(2, harmed);
    if (r.float() < (control === null ? p * 0.5 : p)) {
      const all = r.float() < 0.3;
      change = { rcv: { primaries: true, general: all ? 'all' : 'federal' } };
      summary = `Ranked-choice voting in party primaries and in general elections for ${all ? 'every office but President' : 'Congress'}`;
    }
  } else if (ranked) {
    const p = 0.015 + (control !== null && rcvReversedLeaders.includes(control) ? 0.25 : 0);
    if (r.float() < p) { change = { rcv: { primaries: false, general: 'none' } }; summary = 'Ranked-choice voting repealed; plurality voting restored'; }
  }
  if (!change && (law.primaryType === 'open' || law.primaryType === 'semi' || law.primaryType === 'closed') && r.float() < 0.006) {
    const others = (['open', 'semi', 'closed'] as PrimaryType[]).filter((x) => x !== law.primaryType);
    const to = others[r.int(others.length)]!;
    change = { primaryType: to };
    summary = `${to === 'open' ? 'Open' : to === 'semi' ? 'Semi-closed' : 'Closed'} party primaries (previously ${law.primaryType === 'semi' ? 'semi-closed' : law.primaryType})`;
  }
  if (!change) return null;
  const enacted = zonedToUtc(year, 12, 31, 12, 0, 'America/New_York');
  const c = enactLaw(db, w.law, { stateIdx, enacted, effective, source: 'legislature', change, summary });
  const by = control !== null ? `${st.name}’s ${PARTY_NAME[control] ?? 'governing party'}` : `${st.name}’s divided government`;
  h.news('election_law', `${st.name} changes its election law: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`,
    `Enacted by ${by}; it takes effect on ${formatDay(effective, true)} and applies to elections from then on.`, { state: stateIdx }, enacted);
  return c;
}
