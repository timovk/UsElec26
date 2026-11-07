/**
 * Ballot measures (Phase 7.3): the 2016 law (kinds of measures, thresholds), the vote rules and the election-night
 * call weights that stand for them, how many measures states put on the ballot, the election-law changes, and a
 * fixture universe from 2016 to early 2018 — measures filed, voted, decided by their threshold, polled (the top two
 * of each state), called on the night, and election law changed by the voters.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { integrityReport } from '../../../src/persistence/audit';
import { civilToDays, zonedToUtc } from '../../../src/core/time';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { runQuery } from '../../../src/engine/queries';
import type { ContestDetail, MeasureListDto } from '../../../src/engine/protocol';
import { MEASURE_RULES_2016, TOPICS, passWeights, passes, thresholdFor, type Threshold } from '../../../src/rules/measures2016';
import { STATES_2016 } from '../../../src/rules/states2016';
import { lawChangeOf, measureCounts } from '../../../src/engine/measures';
import { baselineLaw } from '../../../src/rules/electionLaw';
import { MEASURE_NO, MEASURE_YES } from '../../../src/institutions/model';
import { decodeNightRecord } from '../../../src/counting/record';
import { ST_CALLED } from '../../../src/counting/types';
import { Rng } from '../../../src/core/rng';

describe('ballot-measure law (2016)', () => {
  it('covers every state with its kinds of measures and thresholds', () => {
    expect(Object.keys(MEASURE_RULES_2016).sort()).toEqual(Object.keys(STATES_2016).sort());
    const states = Object.entries(MEASURE_RULES_2016).filter(([u]) => u !== 'DC');
    expect(states.filter(([, r]) => r.initiative).length).toBe(24);
    expect(states.filter(([, r]) => r.vetoReferendum).length).toBe(23);
    expect(states.filter(([, r]) => !r.referrals).map(([u]) => u)).toEqual(['DE']);
    expect(thresholdFor('FL', 'initiative_amendment')).toEqual({ kind: 'votes', share: 0.6 });
    expect(thresholdFor('FL', 'bond')).toEqual({ kind: 'majority' });
    expect(thresholdFor('NH', 'legislative_amendment')).toEqual({ kind: 'votes', share: 2 / 3 });
    expect(thresholdFor('MN', 'legislative_amendment').kind).toBe('ballots');
    expect(thresholdFor('MA', 'initiative_statute')).toEqual({ kind: 'majorityAndBallots', share: 0.3 });
    expect(thresholdFor('CA', 'initiative_statute')).toEqual({ kind: 'majority' });
    for (const [, r] of states) if (r.initiative) expect(r.initiative.statute || r.initiative.amendment).toBe(true);
  });

  it('decides by the rule, and the night call weights agree with it', () => {
    expect(passes({ kind: 'majority' }, 51, 49, 120)).toBe(true);
    expect(passes({ kind: 'majority' }, 50, 50, 120)).toBe(false);
    expect(passes({ kind: 'votes', share: 0.6 }, 59, 41, 110)).toBe(false);
    expect(passes({ kind: 'votes', share: 0.6 }, 60, 40, 110)).toBe(true);
    expect(passes({ kind: 'ballots', share: 0.5 }, 55, 40, 112)).toBe(false); // blank ballots count as no (Minnesota)
    expect(passes({ kind: 'ballots', share: 0.5 }, 57, 40, 112)).toBe(true);
    expect(passes({ kind: 'majorityAndBallots', share: 0.35 }, 30, 20, 100)).toBe(false); // Nebraska: a majority, but under 35% of the ballots
    expect(passes({ kind: 'votesOrBallots', votes: 0.6, ballots: 0.5 }, 56, 40, 110)).toBe(true); // Illinois: a majority of the ballots
    expect(passes({ kind: 'votesOrBallots', votes: 0.6, ballots: 0.5 }, 54, 40, 120)).toBe(false);
    expect(passWeights({ kind: 'majority' })).toBeNull();
    const r = Rng.stream('measures-test', 'weights');
    for (const t of [{ kind: 'votes', share: 0.6 }, { kind: 'votes', share: 2 / 3 }, { kind: 'ballots', share: 0.5 }] as Threshold[]) {
      const w = passWeights(t)!;
      for (let i = 0; i < 400; i++) {
        const yes = r.int(1000) + 1, no = r.int(1000) + 1, blank = r.int(200);
        const s = w[0] * yes + w[1] * no + w[2] * blank;
        if (Math.abs(s) < 1e-9) continue;
        expect(s > 0).toBe(passes(t, yes, no, yes + no + blank));
      }
    }
  });

  it('draws plausible numbers of measures, deterministically', () => {
    const tally = (year: number, seed: string) => Object.keys(MEASURE_RULES_2016).reduce((a, u) => { const c = measureCounts(seed, year, u); return a + c.initiative + c.referral + c.veto; }, 0);
    expect(tally(2016, 'S1')).toBe(tally(2016, 'S1'));
    let even = 0, odd = 0;
    for (let i = 0; i < 20; i++) { even += tally(2016 + 2 * i, `S${i}`); odd += tally(2017 + 2 * i, `S${i}`); }
    expect(even / 20).toBeGreaterThan(90); expect(even / 20).toBeLessThan(160);
    expect(odd / 20).toBeGreaterThan(12); expect(odd / 20).toBeLessThan(45);
    // Odd years: only the states that vote on measures then.
    for (const u of Object.keys(MEASURE_RULES_2016)) {
      const c = measureCounts('S1', 2017, u);
      if (!MEASURE_RULES_2016[u]!.activity.odd) expect(c.initiative + c.referral + c.veto).toBe(0);
    }
    // No initiatives where the law allows none.
    for (const u of ['AL', 'TX', 'NY', 'GA']) for (let y = 2016; y < 2040; y++) expect(measureCounts('S1', y, u).initiative).toBe(0);
  });

  it('election-law measures change the law the way the state can', () => {
    for (const t of TOPICS) { expect(Math.hypot(...t.dir)).toBeGreaterThanOrEqual(0.3); if (t.effect && t.effect !== 'repeal_rcv') expect(t.by).toEqual(['initiative']); }
    const ca = baselineLaw('CA'), me = baselineLaw('ME');
    expect(lawChangeOf('rcv', ca, () => 'top_two').change).toEqual({ primaryType: 'top_four' }); // a top-two state goes the Alaska way
    expect(lawChangeOf('rcv', me, () => 'closed').change).toEqual({ rcv: { primaries: true, general: 'all' } });
    expect(lawChangeOf('repeal_rcv', { ...ca, primaryType: 'top_four' }, () => 'top_two').change).toEqual({ primaryType: 'top_two', rcv: { primaries: false, general: 'none' } });
    expect(lawChangeOf('open_primaries', me, () => 'closed').change).toEqual({ primaryType: 'open' });
  });
});

let sqlite3: Sqlite3Static; let files: Map<string, Uint8Array>;
beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('ballot measures in a universe (fixture)', () => {
  it('files, votes, decides, polls, calls and enacts, 2016 to 2018', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Measures', seed: 'MEAS-1' }, files, fixtureNames());
    await u.advance({ kind: 'until', time: zonedToUtc(2018, 1, 10, 0, 0, 'America/New_York') });
    const db = u.db, w = u.world;
    const rows = (sql: string, p: unknown[] = []) => db.all<Record<string, number | string | null>>(sql, p as never);
    const ms = rows("SELECT m.*, c.status, c.election_id, c.kind AS ckind, c.office_id FROM ballot_measure m JOIN contest c ON c.contest_id = m.contest_id WHERE m.year <= 2017");
    expect(ms.filter((m) => m.year === 2016).length).toBeGreaterThan(60);
    expect(ms.filter((m) => m.year === 2017).length).toBeGreaterThan(3);
    // Each is a contest of kind 'measure' under the state's ballot-measure office, with the options Yes and No.
    for (const m of ms) {
      expect(m.ckind).toBe('measure'); expect(m.status).toBe('certified');
      expect(w.officeById.get(Number(m.office_id))!.kind).toBe('ballot_measure');
      const k = rows('SELECT k.person_id, k.status, t.votes FROM candidacy k JOIN contest_total t ON t.candidacy_id = k.candidacy_id AND t.rev = 3 WHERE k.contest_id = ? ORDER BY k.ballot_order', [m.contest_id]);
      expect(k.map((x) => x.person_id)).toEqual([MEASURE_YES, MEASURE_NO]);
      const ballots = Number(db.value('SELECT ballots FROM contest_turnout WHERE contest_id = ? AND rev = 3', [m.contest_id]));
      const ok = passes(JSON.parse(String(m.threshold_json)) as Threshold, Number(k[0]!.votes), Number(k[1]!.votes), ballots);
      expect(m.outcome).toBe(ok ? 'passed' : 'failed');
      expect(k[0]!.status).toBe(ok ? 'won' : 'lost');
    }
    // Legislatures' referrals pass more often than citizens' initiatives.
    const rate = (pred: (k: string) => boolean) => { const x = ms.filter((m) => pred(String(m.kind))); return x.filter((m) => m.outcome === 'passed').length / Math.max(1, x.length); };
    const init = rate((k) => k.startsWith('initiative')), ref = rate((k) => k.startsWith('legislative') || k === 'bond');
    expect(init).toBeGreaterThan(0.1); expect(init).toBeLessThan(0.7); expect(ref).toBeGreaterThan(init);
    // At most two polled per state and election; only polled measures have polls and are on the broadcast night.
    const perState = new Map<string, number>(); for (const m of ms) if (m.polled) { const key = `${m.state_idx}:${m.year}`; perState.set(key, (perState.get(key) ?? 0) + 1); }
    for (const n of perState.values()) expect(n).toBeLessThanOrEqual(2);
    const polledKeys = new Set(ms.filter((m) => m.polled).map((m) => `C:${m.contest_id}`));
    const pollRaces = rows("SELECT DISTINCT race_key FROM poll WHERE race_key IN (SELECT 'C:' || contest_id FROM ballot_measure)").map((r) => String(r.race_key));
    expect(pollRaces.length).toBeGreaterThan(5);
    for (const k of pollRaces) expect(polledKeys.has(k)).toBe(true);
    const night = db.get<{ payload: Uint8Array }>("SELECT payload FROM night WHERE kind = 'general' AND day = ?", [civilToDays(2016, 11, 8)]);
    const rec = await decodeNightRecord(night!.payload);
    const byId = new Map(ms.map((m) => [Number(m.contest_id), m]));
    const onNight = rec.races.map((r, i) => ({ r, i })).filter(({ r }) => byId.has(r.contestId));
    expect(onNight.length).toBeGreaterThan(10);
    for (const { r } of onNight) expect(byId.get(r.contestId)!.polled).toBe(1);
    // The desk's calls agree with the certified outcomes (thresholds included).
    let calls = 0, right = 0;
    for (const { r, i } of onNight) {
      let last = -1; for (let e = 0; e < rec.events.time.length; e++) if (rec.events.race[e] === i && rec.events.status[e] === ST_CALLED) last = rec.events.option[e]!;
      if (last < 0) continue;
      calls++; if ((last === 0) === (byId.get(r.contestId)!.outcome === 'passed')) right++;
    }
    expect(calls).toBeGreaterThan(5);
    expect(right / calls).toBeGreaterThanOrEqual(0.9);
    // Election law changed by the voters, from the next January 1.
    for (const m of ms.filter((x) => x.effect && x.outcome === 'passed')) {
      const law = rows('SELECT source, effective_day FROM election_law WHERE law_id = ?', [m.law_id]);
      expect(law[0]!.source).toBe('initiative');
      expect(law[0]!.effective_day).toBe(civilToDays(Number(m.year) + 1, 1, 1));
    }
    // Queries.
    const d = await runQuery(u, { kind: 'contest', id: Number(ms[0]!.contest_id) }) as ContestDetail;
    expect(d.measure?.name).toBe(ms[0]!.name);
    expect(d.candidates.map((c) => c.name)).toEqual(['Yes', 'No']);
    const list = await runQuery(u, { kind: 'measures', year: 2016 }) as MeasureListDto;
    expect(list.rows.length).toBe(ms.filter((m) => m.year === 2016).length);
    expect(integrityReport(db).checks.filter((c) => !c.ok)).toEqual([]);
    u.close();
  }, 900_000);
});
