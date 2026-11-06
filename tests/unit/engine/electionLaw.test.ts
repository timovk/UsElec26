/**
 * Election law over time (Phase 7.1): the dated rules framework, and a fixture universe in which Maine adopts
 * ranked-choice voting and Alaska a top-four primary for 2018, and Colorado ranked-choice voting for 2020. Nothing
 * applies before its effective date; ranked-choice contests are tabulated round by round, every ballot accounted
 * for, and decided by the final round; Nebraska's legislature is elected on a nonpartisan ballot. The sessions'
 * decisions: a top-two state adopts ranked-choice voting as a top-four primary (a ranked count of two candidates
 * would change nothing), and repealing it restores the primary system it replaced.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { integrityReport } from '../../../src/persistence/audit';
import { enactLaw } from '../../../src/engine/lawStore';
import { decideElectionLaw, electionLawSession, primaryBeforeTopFour } from '../../../src/engine/electionReform';
import { ElectionLaw, advancingFromPrimary, generalMethod, partyPrimaryMethod, rcvGeneral } from '../../../src/rules/electionLaw';
import { civilToDays, daysToCivil, easternDay, zonedToUtc } from '../../../src/core/time';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { runQuery } from '../../../src/engine/queries';
import type { ContestDetail, ElectionLawDto } from '../../../src/engine/protocol';
import type { LawChange } from '../../../src/rules/electionLaw';

const USPS = ['AK', 'CA', 'CO', 'GA', 'LA', 'ME', 'NE', 'TX'];

describe('election law: dated rules', () => {
  it('starts from the 2016 baseline', () => {
    const law = new ElectionLaw(USPS);
    const on = (u: string) => law.on(USPS.indexOf(u), civilToDays(2016, 6, 1));
    expect(generalMethod(on('CA'), 'us_representative')).toBe('top_two_general');
    expect(generalMethod(on('GA'), 'us_senator')).toBe('majority');
    expect(generalMethod(on('LA'), 'us_senator')).toBe('jungle');
    expect(generalMethod(on('ME'), 'us_representative')).toBe('plurality');
    expect(partyPrimaryMethod(on('TX'))).toBe('runoff_0.5');
    expect(on('NE').nonpartisan).toEqual(['state_senator']);
    expect(on('ME').rcv).toEqual({ primaries: false, general: 'none' });
  });

  it('applies a change from its effective date, never before', () => {
    const me = USPS.indexOf('ME'), eff = civilToDays(2018, 1, 1);
    const law = new ElectionLaw(USPS, [{ id: 1, stateIdx: me, enacted: 0, effective: eff, source: 'scenario', change: { rcv: { primaries: true, general: 'federal' } }, summary: '' }]);
    expect(generalMethod(law.on(me, eff - 1), 'us_representative')).toBe('plurality');
    expect(generalMethod(law.on(me, eff), 'us_representative')).toBe('rcv');
    expect(generalMethod(law.on(me, eff), 'governor')).toBe('plurality'); // federal offices only
    expect(partyPrimaryMethod(law.on(me, eff))).toBe('rcv');
    expect(rcvGeneral(law.on(me, eff), 'president')).toBe(false);
    // A later change supersedes; the other states are untouched.
    law.add({ id: 2, stateIdx: me, enacted: 0, effective: civilToDays(2022, 1, 1), source: 'scenario', change: { rcv: { general: 'none', primaries: false } }, summary: '' });
    expect(generalMethod(law.on(me, civilToDays(2020, 11, 3)), 'us_senator')).toBe('rcv');
    expect(generalMethod(law.on(me, civilToDays(2022, 11, 8)), 'us_senator')).toBe('plurality');
    expect(generalMethod(law.on(USPS.indexOf('CO'), civilToDays(2020, 11, 3)), 'us_senator')).toBe('plurality');
  });

  it('a top-four primary sends four to a ranked general', () => {
    const ak = USPS.indexOf('AK'), eff = civilToDays(2022, 1, 1);
    const law = new ElectionLaw(USPS, [{ id: 1, stateIdx: ak, enacted: 0, effective: eff, source: 'scenario', change: { primaryType: 'top_four' }, summary: '' }]);
    expect(advancingFromPrimary(law.on(ak, eff))).toBe(4);
    expect(generalMethod(law.on(ak, eff), 'governor')).toBe('rcv');
    expect(generalMethod(law.on(ak, eff), 'president')).toBe('plurality');
    expect(advancingFromPrimary(law.on(USPS.indexOf('CA'), eff))).toBe(2);
  });
});

describe('election law: what a session decides', () => {
  const yes = { float: () => 0, int: () => 0 }, no = { float: () => 0.999, int: () => 0 };
  const quiet = { spoilerLosers: [], rcvReversedLeaders: [] };
  const jan2017 = civilToDays(2017, 1, 1), jan2018 = civilToDays(2018, 1, 1), jan2019 = civilToDays(2019, 1, 1);
  const enacted = (stateIdx: number, effective: number, d: { change: LawChange['change']; summary: string }, id = 1): LawChange =>
    ({ id, stateIdx, enacted: 0, effective, source: 'legislature', change: d.change, summary: d.summary });

  it('a state with party primaries ranks its primaries and general elections', () => {
    const law = new ElectionLaw(USPS);
    expect(decideElectionLaw(law.on(USPS.indexOf('ME'), jan2017), 'closed', quiet, 1, yes)!.change).toEqual({ rcv: { primaries: true, general: 'all' } });
    expect(decideElectionLaw(law.on(USPS.indexOf('ME'), jan2017), 'closed', quiet, 1, no)).toBeNull();
  });

  it('a top-two state adopts it as a top-four primary and a ranked general (the Alaska model)', () => {
    const ca = USPS.indexOf('CA');
    const d = decideElectionLaw(new ElectionLaw(USPS).on(ca, jan2017), 'top_two', quiet, 1, yes)!;
    expect(d.change).toEqual({ primaryType: 'top_four' });
    expect(d.summary).toMatch(/top-four primary \(previously top-two\)/);
    const law = new ElectionLaw(USPS, [enacted(ca, jan2018, d)]);
    const after = law.on(ca, jan2018);
    expect(advancingFromPrimary(after)).toBe(4);
    for (const k of ['us_representative', 'us_senator', 'governor', 'state_senator']) expect(generalMethod(after, k)).toBe('rcv');
    expect(generalMethod(after, 'president')).toBe('plurality');
    expect(generalMethod(law.on(ca, jan2018 - 1), 'us_representative')).toBe('top_two_general'); // not before it takes effect

    // Repealing it restores the top-two primary and its two-candidate plurality general.
    expect(primaryBeforeTopFour(law, 'CA', ca, jan2018)).toBe('top_two');
    const rep = decideElectionLaw(after, 'top_two', quiet, 1, yes)!;
    expect(rep.change).toEqual({ primaryType: 'top_two', rcv: { primaries: false, general: 'none' } });
    expect(rep.summary).toMatch(/top-two primary and plurality voting restored/);
    law.add(enacted(ca, jan2019, rep, 2));
    expect(advancingFromPrimary(law.on(ca, jan2019))).toBe(2);
    expect(generalMethod(law.on(ca, jan2019), 'us_representative')).toBe('top_two_general');
  });

  it('repealing a top-four primary restores the party primaries it replaced', () => {
    const ak = USPS.indexOf('AK');
    const law = new ElectionLaw(USPS, [enacted(ak, jan2018, { change: { primaryType: 'top_four' }, summary: '' })]);
    expect(primaryBeforeTopFour(law, 'AK', ak, jan2018)).toBe('semi');
    const rep = decideElectionLaw(law.on(ak, jan2018), 'semi', quiet, 2, yes)!;
    expect(rep.change).toEqual({ primaryType: 'semi', rcv: { primaries: false, general: 'none' } });
    law.add(enacted(ak, jan2019, rep, 2));
    expect(generalMethod(law.on(ak, jan2019), 'governor')).toBe('plurality');
    expect(partyPrimaryMethod(law.on(ak, jan2019))).toBe('plurality');
  });

  it("Louisiana's November all-candidate ballot is left alone", () => {
    const la = new ElectionLaw(USPS).on(USPS.indexOf('LA'), jan2017);
    expect(decideElectionLaw(la, 'jungle', { spoilerLosers: [1, 1], rcvReversedLeaders: [] }, 1, yes)).toBeNull();
  });
});

let sqlite3: Sqlite3Static; let files: Map<string, Uint8Array>;
beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('election law in a universe (fixture)', () => {
  it('ranked-choice voting and a top-four primary from 2018, none of it earlier', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Law', seed: 'LAW-1' }, files, fixtureNames());
    const ET = 'America/New_York';
    await u.advance({ kind: 'until', time: zonedToUtc(2017, 1, 2, 0, 0, ET) });
    const db = u.db, w = u.world;
    const idx = (s: string) => w.pack.states.find((x) => x.usps === s)!.idx;
    const [me, ak, co] = [idx('ME'), idx('AK'), idx('CO')];
    db.tx(() => {
      enactLaw(db, w.law, { stateIdx: me, enacted: w.time, effective: civilToDays(2018, 1, 1), source: 'scenario', change: { rcv: { primaries: true, general: 'federal' } }, summary: 'RCV for Congress and primaries' });
      enactLaw(db, w.law, { stateIdx: ak, enacted: w.time, effective: civilToDays(2018, 1, 1), source: 'scenario', change: { primaryType: 'top_four' }, summary: 'Top-four primary' });
      enactLaw(db, w.law, { stateIdx: co, enacted: w.time, effective: civilToDays(2020, 1, 1), source: 'scenario', change: { rcv: { general: 'all' } }, summary: 'RCV from 2020' });
    });
    await u.advance({ kind: 'until', time: zonedToUtc(2019, 1, 1, 0, 0, ET) });
    const rows = (sql: string, p: unknown[] = []) => db.all<Record<string, number | string | null>>(sql, p as never);
    const scenario = new Set([me, ak, co]);
    const otherLaw = new Set(w.law.history().filter((c) => c.source !== 'scenario').map((c) => c.stateIdx));
    console.log(`law changes enacted in the universe itself: ${w.law.history().filter((c) => c.source !== 'scenario').map((c) => `${w.pack.states[c.stateIdx]!.usps} ${c.summary}`).join('; ') || 'none'}`);

    // Nothing retroactive: 2016 contests everywhere, and every 2018 contest in a state without a change, keep 2016 methods.
    expect(rows("SELECT contest_id FROM contest WHERE year <= 2017 AND method IN ('rcv','top_four')")).toEqual([]);
    expect(rows("SELECT contest_id FROM contest WHERE year = 2018 AND state_idx = ? AND method IN ('rcv','top_four')", [co])).toEqual([]);
    const elsewhere = rows("SELECT DISTINCT state_idx FROM contest WHERE year = 2018 AND method IN ('rcv','top_four')").map((r) => Number(r.state_idx));
    for (const s of elsewhere) expect(scenario.has(s) || otherLaw.has(s)).toBe(true);

    // Maine: ranked Congress generals and primaries; the governor still by plurality.
    const meGen = rows("SELECT c.contest_id, c.method, o.kind FROM contest c JOIN office o ON o.office_id = c.office_id WHERE c.year = 2018 AND c.state_idx = ? AND c.kind = 'general'", [me]);
    expect(meGen.filter((c) => c.kind === 'us_representative' || c.kind === 'us_senator').every((c) => c.method === 'rcv')).toBe(true);
    expect(meGen.filter((c) => c.kind === 'us_representative').length).toBe(2);
    expect(meGen.filter((c) => c.kind === 'governor').every((c) => c.method === 'plurality')).toBe(true);
    expect(rows("SELECT method FROM contest WHERE year = 2018 AND state_idx = ? AND kind = 'primary'", [me]).every((c) => c.method === 'rcv')).toBe(true);

    // Alaska: an all-candidate primary where four advance, then ranked generals (no party primaries).
    expect(rows("SELECT contest_id FROM contest WHERE year = 2018 AND state_idx = ? AND kind = 'primary'", [ak])).toEqual([]);
    const akGen = rows("SELECT c.contest_id, c.method FROM contest c WHERE c.year = 2018 AND c.state_idx = ? AND c.kind = 'general' AND c.parent_contest IS NULL", [ak]);
    expect(akGen.length).toBeGreaterThan(0);
    expect(akGen.every((c) => c.method === 'rcv')).toBe(true);
    for (const p of rows("SELECT contest_id, next_contest FROM contest WHERE year = 2018 AND state_idx = ? AND kind = 'top_two'", [ak])) {
      expect(rows('SELECT method FROM contest WHERE contest_id = ?', [p.contest_id])[0]!.method).toBe('top_four');
      const adv = Number(db.value("SELECT COUNT(*) FROM candidacy WHERE contest_id = ? AND status = 'advanced'", [p.contest_id]));
      const onBallot = Number(db.value('SELECT COUNT(*) FROM candidacy WHERE contest_id = ?', [p.next_contest]));
      expect(adv).toBe(Math.min(4, Number(db.value('SELECT COUNT(*) FROM candidacy WHERE contest_id = ?', [p.contest_id]))));
      expect(onBallot).toBe(adv);
    }

    // Every decided ranked-choice contest: rounds conserve ballots, and the final round's winner is the contest's.
    const rcv = rows("SELECT contest_id, winner_candidacy, status, label FROM contest WHERE method = 'rcv' AND status IN ('decided','certified')");
    expect(rcv.length).toBeGreaterThanOrEqual(5);
    let multi = 0;
    for (const c of rcv) {
      const rr = rows('SELECT round, candidacy_id, votes, status FROM rcv_round WHERE contest_id = ? AND rev = (SELECT MAX(rev) FROM rcv_round WHERE contest_id = ?) ORDER BY round', [c.contest_id, c.contest_id]);
      expect(rr.length).toBeGreaterThan(0);
      const rounds = [...new Set(rr.map((r) => Number(r.round)))];
      const totals = rounds.map((k) => rr.filter((r) => r.round === k).reduce((a, r) => a + Number(r.votes), 0));
      expect(new Set(totals).size).toBe(1); // tallies + exhausted are the same ballots every round
      const last = rr.filter((r) => r.round === rounds[rounds.length - 1] && r.candidacy_id !== null);
      const elected = last.find((r) => r.status === 'elected');
      expect(elected?.candidacy_id).toBe(c.winner_candidacy);
      const finalVotes = last.reduce((a, r) => a + Number(r.votes), 0);
      if (rounds.length > 1) {
        multi++; expect(2 * Number(elected!.votes) > finalVotes || last.length <= 2).toBe(true);
        const party = (cid: unknown) => Number(db.value('SELECT party_id FROM candidacy WHERE candidacy_id = ?', [cid as number]));
        console.log(`${c.label}: ${rounds.map((k) => `round ${k}: ${rr.filter((r) => r.round === k).map((r) => (r.candidacy_id === null ? `exhausted ${r.votes}` : `${'?DRLGI'[party(r.candidacy_id)]} ${r.votes}${r.status === 'eliminated' ? ' (out)' : r.status === 'elected' ? ' (elected)' : ''}`)).join(', ')}`).join(' | ')}`);
      }
      // First round = the certified first choices.
      const first = rr.filter((r) => r.round === 1 && r.candidacy_id !== null);
      for (const f of first) expect(Number(f.votes)).toBe(Number(db.value('SELECT votes FROM contest_total WHERE contest_id = ? AND candidacy_id = ? AND rev = (SELECT MAX(rev) FROM contest_total WHERE contest_id = ?)', [c.contest_id, f.candidacy_id, c.contest_id])));
    }
    console.log(`${rcv.length} ranked-choice contests decided, ${multi} needing more than one round`);
    // The archive's contest page: rounds with every candidate still counted and the exhausted ballots.
    const multiId = rcv.find((c) => Number(db.value('SELECT MAX(round) FROM rcv_round WHERE contest_id = ?', [c.contest_id])) > 1)?.contest_id;
    if (multiId !== undefined) {
      const d = await runQuery(u, { kind: 'contest', id: Number(multiId) }) as ContestDetail;
      expect(d.method).toBe('rcv');
      expect(d.rcv!.length).toBeGreaterThan(1);
      expect(d.rcv![d.rcv!.length - 1]!.candidates.find((x) => x.status === 'elected')?.candidacyId).toBe(rcv.find((c) => c.contest_id === multiId)!.winner_candidacy);
      expect(d.rcv![d.rcv!.length - 1]!.exhausted).toBeGreaterThanOrEqual(d.rcv![0]!.exhausted);
    }
    const lawDto = await runQuery(u, { kind: 'electionLaw' }) as ElectionLawDto;
    expect(lawDto.changes.filter((c) => c.source === 'scenario').map((c) => c.usps).sort()).toEqual(['AK', 'CO', 'ME']);
    expect(lawDto.changes.find((c) => c.usps === 'CO')!.inForce).toBe(false);
    expect(lawDto.states.find((x) => x.usps === 'AK')!.rules.join(' ')).toMatch(/Top-four/);

    // Nebraska's legislature: a nonpartisan ballot.
    const ne = idx('NE');
    const neLeg = rows("SELECT c.nonpartisan FROM contest c JOIN office o ON o.office_id = c.office_id WHERE c.state_idx = ? AND o.kind = 'state_senator' AND c.kind = 'general'", [ne]);
    expect(neLeg.length).toBeGreaterThan(0);
    expect(neLeg.every((c) => Number(c.nonpartisan) === 1)).toBe(true);
    expect(Number(db.value("SELECT COUNT(*) FROM contest WHERE nonpartisan = 1 AND state_idx != ?", [ne]))).toBe(0);

    // The states' own sessions: a century of hypothetical sessions on this history (all far in the future).
    const before = w.law.history().length, news: string[] = [];
    const host = { world: w, db, news: (kind: string, headline: string) => { if (kind === 'election_law') news.push(headline); } };
    db.tx(() => { for (let y = 2101; y <= 2200; y++) for (const st of w.pack.states) electionLawSession(host, y, st.idx, st.idx % 3 === 0 ? 1 : st.idx % 3 === 1 ? 2 : null); });
    const made = w.law.history().slice(before);
    console.log(`a century of sessions: ${made.length} election-law changes (${made.filter((c) => c.change.primaryType === 'top_four' || (c.change.rcv?.general && c.change.rcv.general !== 'none')).length} adopting ranked-choice voting, ${made.filter((c) => c.change.rcv?.general === 'none').length} repealing it, ${made.filter((c) => c.change.primaryType && c.change.primaryType !== 'top_four' && !c.change.rcv).length} primary systems)`);
    expect(made.length).toBeGreaterThan(5);
    expect(made.length).toBeLessThan(5100 * 0.05);
    expect(news.length).toBe(made.length);
    for (const c of made) { // enacted at the December 31 session, in force from the next January 1
      const y = daysToCivil(easternDay(c.enacted));
      expect([c.source, y.m, y.d]).toEqual(['legislature', 12, 31]);
      expect(c.effective).toBe(civilToDays(y.y + 1, 1, 1));
    }
    expect(Number(db.value('SELECT COUNT(*) FROM election_law'))).toBe(w.law.history().length);

    expect(integrityReport(db).checks.filter((c) => !c.ok)).toEqual([]);
    u.close();
  }, 900_000);
});
