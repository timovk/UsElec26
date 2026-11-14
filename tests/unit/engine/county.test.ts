/**
 * County government (Phase 7.6) on the fixture geography: offices and officeholders at founding, the scope setting,
 * board districts, and a universe saved before Phase 7.6.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { isCountyKind } from '../../../src/rules/county2016';
import { boardPlan, countySeat, redrawCountyBoards } from '../../../src/engine/county';
import { integrityReport } from '../../../src/persistence/audit';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { zonedToUtc } from '../../../src/core/time';
import { auditElection, marksOf } from '../../../src/archive/results';
import { runQuery } from '../../../src/engine/queries';
import type { CountyGovernmentDto, CountyOverviewDto, ElectionListItem } from '../../../src/engine/protocol';
import { Playback } from '../../../src/broadcast/playback';

let sqlite3: Sqlite3Static;
let files: Map<string, Uint8Array>;
beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('county offices at founding', () => {
  it('creates and fills every county office; the scope narrows and widens', async () => {
    const storage = new MemoryStorage(sqlite3);
    const t0 = Date.now();
    const u = await Universe.create(storage, { name: 'County', seed: 'COUNTY-1' }, files, fixtureNames());
    const w = u.world;
    const offices = w.offices.filter((o) => isCountyKind(o.kind));
    const filled = offices.filter((o) => w.current.has(o.id));
    console.log(`created in ${Date.now() - t0} ms: ${offices.length} county offices, ${filled.length} filled, ${w.persons.size} persons`);
    expect(offices.length).toBeGreaterThan(500);
    expect(filled.length).toBe(offices.length);
    // Titles, seats and the district plan.
    const tx = w.pack.states.find((s) => s.usps === 'TX')!.idx;
    const judge = offices.find((o) => o.stateIdx === tx && o.kind === 'county_executive')!;
    expect(judge.title).toMatch(/^County Judge, .+ County$/);
    const comm = offices.filter((o) => o.stateIdx === tx && o.kind === 'county_board' && o.seat!.county === judge.seat!.county);
    expect(comm.map((o) => o.seat!.district).sort()).toEqual([1, 2, 3, 4]);
    const plan = boardPlan(w, 2016), c = w.pack.counties[judge.seat!.county!]!;
    const ds = new Set<number>(); for (let b = c.buStart; b < c.buStart + c.buCount; b++) ds.add(plan[b]!);
    expect([...ds].sort()).toEqual([1, 2, 3, 4]);
    // Prosecutors by generated district in Florida (the fixture's counties have no real names).
    const fl = w.pack.states.find((s) => s.usps === 'FL')!.idx;
    const sa = offices.filter((o) => o.stateIdx === fl && o.title.startsWith('State Attorney'));
    expect(sa.length).toBe(Math.min(20, w.pack.counties.filter((x) => x.stateIdx === fl).length));
    expect(countySeat(w, sa[0]!)?.circuit?.plan.source).toBe('generated');
    // None in Connecticut.
    const ct = w.pack.states.find((s) => s.usps === 'CT')!.idx;
    expect(offices.filter((o) => o.stateIdx === ct).length).toBe(0);
    // The county page and the Government screen's overview.
    const gov = await runQuery(u, { kind: 'countyGovernment', county: judge.seat!.county! }) as CountyGovernmentDto;
    expect(gov.inScope).toBe(true);
    expect(gov.bodies.find((b) => b.seats.length === 4)?.by).toBe('district');
    expect(gov.offices.some((x) => x.kind === 'sheriff' && x.holder !== null)).toBe(true);
    const ov = await runQuery(u, { kind: 'countyOverview' }) as CountyOverviewDto;
    const txo = ov.states.find((x) => x.stateIdx === tx)!;
    expect(txo.counties).toBe(w.pack.counties.filter((x) => x.stateIdx === tx).length);
    expect(txo.sheriffs.d + txo.sheriffs.r + txo.sheriffs.other).toBe(txo.counties);
    // Board districts are redrawn on new populations after a census, from the year they are first used.
    const pop = Float64Array.from(w.pack.bu.pop2010);
    for (let b = c.buStart; b < c.buStart + Math.floor(c.buCount / 3); b++) pop[b] = pop[b]! * 3;
    const before = boardPlan(w, 2021).slice();
    const s0 = w.pack.counties.find((x) => x.stateIdx === tx)!.buStart;
    const redrawn = redrawCountyBoards(w, tx, pop.subarray(s0), s0, 2022)!;
    expect(boardPlan(w, 2021)).toEqual(before);
    expect(boardPlan(w, 2022)).toBe(redrawn);
    const dPop = new Map<number, number>(); for (let b = c.buStart; b < c.buStart + c.buCount; b++) dPop.set(redrawn[b]!, (dPop.get(redrawn[b]!) ?? 0) + pop[b]!);
    expect([...dPop.keys()].sort()).toEqual([1, 2, 3, 4]);
    console.log(`redrawn board districts' populations: ${[...dPop.values()].map(Math.round).join(', ')}`);
    w.county!.plans = w.county!.plans.filter((p) => p.year !== 2022);
    // Narrow to the major counties (none in the fixture), then widen again.
    const ended = await u.setCountyScope('off');
    expect(ended).toBe(filled.length);
    expect(offices.filter((o) => w.current.has(o.id)).length).toBe(0);
    await u.setCountyScope('all');
    expect(offices.filter((o) => w.current.has(o.id)).length).toBe(offices.length);
    expect(integrityReport(u.db).ok).toBe(true);
    // Reopened: the scope, the plan and the seats come back.
    const name = u.fileName; u.close();
    const v = await Universe.open(storage, name, fixtureNames());
    expect(v.world.county?.scope).toBe('all');
    expect(v.world.offices.filter((o) => isCountyKind(o.kind)).length).toBe(offices.length);
    expect(v.world.offices.find((o) => o.id === judge.id)!.seat!.county).toBe(judge.seat!.county);
    expect(boardPlan(v.world, 2016)).toEqual(plan);
    v.close();
  }, 300_000);
});

describe('county elections', () => {
  it('files, votes and decides county races in 2016 and 2017, at November, spring and local elections', async () => {
    const storage = new MemoryStorage(sqlite3);
    const u = await Universe.create(storage, { name: 'County races', seed: 'COUNTY-2' }, files, fixtureNames());
    const w = u.world;
    const t0 = Date.now();
    await u.advance({ kind: 'until', time: zonedToUtc(2017, 12, 20, 0, 0, 'America/New_York') });
    console.log(`2016–2017 in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const kinds = "'county_board','county_executive','sheriff','prosecutor','county_clerk','court_clerk','county_treasurer','county_assessor','county_auditor','county_recorder','coroner','county_surveyor','county_official'";
    const rows = u.db.all<{ year: number; ekind: string; kind: string; status: string; n: number }>(
      `SELECT c.year, e.kind AS ekind, c.kind, c.status, COUNT(*) n FROM contest c JOIN election e ON e.election_id = c.election_id JOIN office o ON o.office_id = c.office_id WHERE o.kind IN (${kinds}) GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`);
    console.log(JSON.stringify(rows));
    const n = (y: number, ek: string) => rows.filter((r) => r.year === y && r.ekind === ek && (r.kind === 'general')).reduce((a, r) => a + r.n, 0);
    expect(n(2016, 'general')).toBeGreaterThan(300);
    expect(n(2017, 'general')).toBeGreaterThan(30);           // the odd-year states (Pennsylvania, New York, New Jersey…)
    expect(n(2016, 'spring')).toBeGreaterThan(10);            // Wisconsin's county boards
    expect(rows.some((r) => r.ekind === 'local')).toBe(true); // Tennessee's August, Alaska's October
    // Every general contest is decided, and its winners hold (or will hold) the office.
    // (A race without a majority where one is required goes to a runoff, decided later.)
    const open = rows.filter((r) => r.kind === 'general' && !['decided', 'certified', 'runoff'].includes(r.status) && r.year === 2016);
    expect(open).toEqual([]);
    const won = u.db.all<{ office_id: number; person_id: number; term_start: number }>(`SELECT c.office_id, k.person_id, c.term_start FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy JOIN office o ON o.office_id = c.office_id
      WHERE c.year = 2016 AND c.kind = 'general' AND c.seats = 1 AND o.kind IN (${kinds})`);
    const holding = won.filter((x) => x.term_start <= w.time && w.current.get(x.office_id)?.personId === x.person_id).length;
    expect(holding / won.length).toBeGreaterThan(0.95);
    // Many county races are uncontested; incumbents are usually re-elected.
    const contested = u.db.value<number>(`SELECT AVG(n > 1) FROM (SELECT COUNT(*) n FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id JOIN office o ON o.office_id = c.office_id WHERE c.year = 2016 AND c.kind = 'general' AND o.kind IN (${kinds}) GROUP BY c.contest_id)`)!;
    console.log(`contested share ${contested.toFixed(2)}`);
    expect(contested).toBeGreaterThan(0.3); expect(contested).toBeLessThan(0.85);
    // Every county race has voters (a county too small for its board's districts elects them countywide).
    expect(u.db.value<number>('SELECT COUNT(*) FROM contest c JOIN contest_turnout t ON t.contest_id = c.contest_id AND t.rev = 0 WHERE c.local = 1 AND t.eligible = 0')).toBe(0);
    // County offices' contests are flagged local (by the database), listed apart in the Results Explorer.
    expect(u.db.value<number>('SELECT COUNT(*) FROM contest c LEFT JOIN office_seat s ON s.office_id = c.office_id WHERE c.local <> (s.county_idx IS NOT NULL)')).toBe(0);
    const main = await runQuery(u, { kind: 'elections', year: 2016 }) as ElectionListItem[];
    const local = await runQuery(u, { kind: 'elections', year: 2016, county: true }) as ElectionListItem[];
    const mainContests = main.flatMap((e) => e.contests), localContests = local.flatMap((e) => e.contests);
    expect(mainContests.some((c) => isCountyKind(c.office))).toBe(false);
    expect(localContests.length).toBe(u.db.value<number>('SELECT COUNT(*) FROM contest WHERE year = 2016 AND local = 1'));
    expect(localContests.every((c) => isCountyKind(c.office))).toBe(true);
    expect(localContests.filter((c) => c.kind === 'general' && c.winner !== null).length).toBeGreaterThan(300);
    // The archive audit passes for the 2016 general election of every state.
    const pack = w.pack, starts = pack.states.map((s) => pack.counties.find((c) => c.stateIdx === s.idx)?.buStart ?? 0);
    for (const e of u.db.all<{ election_id: number }>("SELECT election_id FROM election WHERE year IN (2016, 2017) AND kind IN ('general','spring','local') ORDER BY election_id")) {
      const f = await auditElection(u.db, e.election_id, (b) => pack.counties[pack.bu.county[b]!]!.stateIdx, (s) => starts[s]!, (b) => pack.bu.county[b]!);
      expect(f.filter((x) => !x.ok), `election ${e.election_id}`).toEqual([]);
    }
    // Election night: the county races are the record's local races, counted and called, kept apart from the broadcast.
    const nightId = u.db.value<number>("SELECT n.night_id FROM night n JOIN night_election ne ON ne.night_id = n.night_id JOIN election e ON e.election_id = ne.election_id WHERE e.year = 2016 AND n.kind = 'general' LIMIT 1")!;
    const rec = (await u.elections.nightRecord(nightId))!;
    expect(rec.version).toBe(3);
    expect(rec.local!.races.length).toBeGreaterThan(300);
    expect(rec.races.every((r) => !isCountyKind(r.office))).toBe(true);
    expect(rec.local!.races.every((r) => isCountyKind(r.office))).toBe(true);
    const pb = new Playback(rec);
    const called = rec.local!.races.filter((_, i) => pb.localState(i, rec.feedEnd).status === 3).length;
    console.log(`local races ${rec.local!.races.length}, called by the end of the feed ${called}`);
    expect(called / rec.local!.races.length).toBeGreaterThan(0.8);
    // A county race's final count on the night is its canvass.
    const lr = rec.local!.races.find((r) => r.k > 2)!;
    const canvass = u.db.all<{ candidacy_id: number; votes: number }>('SELECT candidacy_id, votes FROM contest_total WHERE contest_id = ? AND rev = 2', [lr.contestId]);
    const fin = pb.localState(rec.local!.races.indexOf(lr), rec.feedEnd + 1e6);
    for (const row of canvass) expect(fin.votes[lr.candidacyIds.indexOf(row.candidacy_id)]).toBe(row.votes);
    expect(integrityReport(u.db).ok).toBe(true);
    u.close();
  }, 900_000);
});

describe('limited voting', () => {
  it("marks one fewer name than the seats elected (Pennsylvania's county commissioners)", () => {
    expect(marksOf({ seats: 3, method: 'limited' })).toBe(2);
    expect(marksOf({ seats: 3, method: 'block' })).toBe(3);
    expect(marksOf({ seats: 1, method: 'limited' })).toBe(1);
    expect(marksOf({})).toBe(1);
  });
});
