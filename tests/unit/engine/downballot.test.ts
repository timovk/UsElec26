/**
 * Down-ballot offices, elected boards and state courts (Phase 7.2): the 2016 data (offices, courts, selection
 * systems, calendars), the drawing of board districts, and a fixture universe from 2016 to early 2018 — partisan,
 * nonpartisan and retention elections, nonpartisan primaries, Wisconsin's spring election, Pennsylvania's odd-year
 * judicial elections, appointments that move a seat's cycle, mandatory retirement, the queries, and integrity.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { isCountyKind } from '../../../src/rules/county2016';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { integrityReport } from '../../../src/persistence/audit';
import { ageOn, civilToDays, daysToCivil, easternDay, zonedToUtc } from '../../../src/core/time';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { runQuery } from '../../../src/engine/queries';
import type { ContestDetail, StateOfficesDto } from '../../../src/engine/protocol';
import { DOWNBALLOT_2016, elected, seatCycles, seatDistricts, seatUp } from '../../../src/rules/downballot2016';
import { STATES_2016 } from '../../../src/rules/states2016';
import { composeDistricts } from '../../../src/geo/bodyDistricts';
import { bodyDistricts, rangesOf, seatBody } from '../../../src/engine/downballot';
import { Rng } from '../../../src/core/rng';

const all = Object.entries(DOWNBALLOT_2016).flatMap(([usps, bs]) => bs.map((b) => ({ usps, b })));
const count = (pred: (b: (typeof all)[number]['b']) => boolean) => all.filter((x) => pred(x.b)).length;

describe('down-ballot data (2016)', () => {
  it('lists the elected offices and every state supreme court', () => {
    expect(count((b) => b.kind === 'treasurer')).toBe(36);
    expect(count((b) => b.kind === 'superintendent')).toBe(13);
    expect(count((b) => b.kind === 'agriculture_commissioner')).toBe(12);
    expect(count((b) => b.kind === 'insurance_commissioner')).toBe(10);
    expect(count((b) => b.kind === 'labor_commissioner')).toBe(4);
    expect(count((b) => b.kind === 'land_commissioner')).toBe(5);
    // One supreme court in every state (Texas and Oklahoma also have a Court of Criminal Appeals); none for DC.
    expect(all.filter((x) => x.b.key === 'supreme').map((x) => x.usps).sort()).toEqual(Object.keys(STATES_2016).filter((s) => s !== 'DC').sort());
    expect(all.filter((x) => x.b.key === 'cca').map((x) => x.usps).sort()).toEqual(['OK', 'TX']);
    const sc = (usps: string) => DOWNBALLOT_2016[usps]!.find((b) => b.key === 'supreme')!;
    expect([sc('TX').selection, sc('WI').selection, sc('CA').selection, sc('NY').selection, sc('SC').selection, sc('PA').selection, sc('MI').selection])
      .toEqual(['partisan', 'nonpartisan', 'retention', 'appointed', 'legislature', 'partisan_retention', 'party_np']);
    expect(sc('IL').retention).toBe(0.6);
    expect(sc('NM').retention).toBe(0.57);
    expect(sc('WI').spring).toBe(true);
    expect(sc('PA').years).toBe('odd');
    expect(sc('TX').seats + DOWNBALLOT_2016.TX!.find((b) => b.key === 'cca')!.seats).toBe(18);
  });

  it('gives every seat a cycle and a district, consistent with the body', () => {
    for (const { usps, b } of all) {
      const gov = STATES_2016[usps]!.governor!;
      const cycles = seatCycles(b, gov.lastElection), districts = seatDistricts(b);
      expect(cycles).toHaveLength(b.seats);
      expect(districts).toHaveLength(b.seats);
      for (const y of cycles) expect(y).toBeGreaterThanOrEqual(2012);
      if (b.districts) {
        const per = b.perDistrict ?? new Array<number>(b.districts).fill(1);
        expect(per).toHaveLength(b.districts);
        expect(per.reduce((a, x) => a + x, 0) + (b.atLarge ?? 0)).toBe(b.seats);
        for (let d = 1; d <= b.districts; d++) expect(districts.filter((x) => x === d)).toHaveLength(per[d - 1]!);
      }
      if (b.retention !== undefined) { expect(b.retention).toBeGreaterThanOrEqual(0.5); expect(b.retention).toBeLessThan(0.7); }
      if (b.retireAt !== undefined) { expect(b.retireAt).toBeGreaterThanOrEqual(65); expect(b.retireAt).toBeLessThanOrEqual(90); }
      if (b.years === 'gov') for (const y of cycles) expect(((y - gov.lastElection) % gov.termYears + gov.termYears) % gov.termYears).toBe(0);
      if (!elected(b)) expect(b.years).toBe('any');
    }
  });

  it('staggers seats: Wisconsin one justice a year, Pennsylvania in odd years, Michigan two seats each even year', () => {
    const b = (usps: string, key: string) => DOWNBALLOT_2016[usps]!.find((x) => x.key === key)!;
    const wi = seatCycles(b('WI', 'supreme'), 2014);
    expect(new Set(wi).size).toBe(7);
    for (const y of seatCycles(b('PA', 'supreme'), 2014)) expect(y % 2).toBe(1);
    const um = seatCycles(b('MI', 'um'), 2014);
    for (let y = 2016; y <= 2030; y += 2) expect(um.filter((c) => seatUp(c, 8, y))).toHaveLength(2);
    for (let y = 2017; y <= 2031; y += 2) expect(um.filter((c) => seatUp(c, 8, y))).toHaveLength(0);
    // A single office on the governor's cycle, and one off it.
    expect(seatCycles(b('NC', 'treasurer'), 2012)).toEqual([2012]);
    expect(seatCycles(b('PA', 'treasurer'), 2014)).toEqual([2016]);
  });
});

describe('board districts', () => {
  it('groups blocks into compact districts of nearly equal population, in proportion to seats', () => {
    const r = Rng.stream('districts-test', 'grid');
    const n = 2500, x = new Float64Array(n), y = new Float64Array(n), pop = new Float64Array(n), block = new Int32Array(n);
    for (let i = 0; i < n; i++) { x[i] = i % 50; y[i] = Math.floor(i / 50); pop[i] = 50 + r.int(400); block[i] = Math.floor((i % 50) / 5) + 10 * Math.floor(Math.floor(i / 50) / 5); }
    for (const sizes of [new Array<number>(8).fill(1), [3, 1, 1, 1, 1]]) {
      const d = composeDistricts({ block, x, y, pop }, sizes);
      expect(d).toEqual(composeDistricts({ block, x, y, pop }, sizes)); // deterministic
      const tot = new Array<number>(sizes.length).fill(0);
      for (let i = 0; i < n; i++) { expect(d[i]).toBeGreaterThanOrEqual(1); expect(d[i]).toBeLessThanOrEqual(sizes.length); tot[d[i]! - 1]! += pop[i]!; }
      const total = tot.reduce((a, b) => a + b, 0), seats = sizes.reduce((a, b) => a + b, 0);
      tot.forEach((t, k) => expect(Math.abs(t / (total * sizes[k]! / seats) - 1)).toBeLessThan(0.2));
      // Whole blocks: a block is never split.
      const of = new Map<number, number>(); for (let i = 0; i < n; i++) { const b = block[i]!; if (of.has(b)) expect(d[i]).toBe(of.get(b)); else of.set(b, d[i]!); }
    }
  });
});

let sqlite3: Sqlite3Static; let files: Map<string, Uint8Array>;
beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('down-ballot offices and courts in a universe (fixture)', () => {
  it('elects, retains, appoints and retires, 2016 to 2018', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Courts', seed: 'COURTS-1' }, files, fixtureNames());
    const db = u.db, w = u.world, ET = 'America/New_York';
    const rows = (sql: string, p: unknown[] = []) => db.all<Record<string, number | string | null>>(sql, p as never);
    const idx = (s: string) => w.pack.states.find((x) => x.usps === s)!.idx;
    // The state's seats (county offices, Phase 7.6, have seats too).
    const seats = w.offices.filter((o) => o.seat && !isCountyKind(o.kind));
    expect(seats.length).toBe(all.reduce((a, x) => a + x.b.seats, 0));
    // Every seat is held at the start, by somebody below the court's retirement age.
    const today = easternDay(w.time);
    for (const o of seats) {
      const t = w.current.get(o.id); expect(t).toBeDefined();
      const b = seatBody(w, o)!;
      if (b.retireAt) expect(ageOn(w.persons.get(t!.personId)!.birthDay, today)).toBeLessThan(b.retireAt);
    }
    // Board districts partition each state's units.
    const tx = idx('TX'), sboe = DOWNBALLOT_2016.TX!.find((b) => b.key === 'sboe')!;
    const dist = bodyDistricts(w, tx, sboe, 2016), rg = rangesOf(w)[tx]!;
    expect(dist.length).toBe(rg.buEnd - rg.buStart);
    expect(new Set(Array.from(dist).filter((d, i) => w.pop.vep[rg.buStart + i]! > 0))).toEqual(new Set(Array.from({ length: 15 }, (_, i) => i + 1)));

    // A Texas Supreme Court justice reaches the retirement age next month: the seat falls vacant and is filled.
    const txJustice = seats.find((o) => o.stateIdx === tx && o.seat!.body === 'supreme' && o.seat!.cycle !== 2016)!;
    const retiree = w.persons.get(w.current.get(txJustice.id)!.personId)!;
    retiree.birthDay = civilToDays(2016 - 75, 1, 20);
    db.run('UPDATE person SET birth_day = ? WHERE person_id = ?', [retiree.birthDay, retiree.id]);

    await u.advance({ kind: 'until', time: zonedToUtc(2018, 1, 20, 0, 0, ET) });

    const retired = rows("SELECT end_reason FROM office_term WHERE office_id = ? AND person_id = ?", [txJustice.id, retiree.id]);
    expect(retired[0]!.end_reason).toBe('reached the mandatory retirement age');
    const successor = w.current.get(txJustice.id);
    expect(successor && successor.personId !== retiree.id).toBe(true);
    expect(successor!.acquired).toMatch(/appointed by the Governor/);
    // An appointee to an elected court faces the voters at the next even-year election at least a year away.
    expect(txJustice.seat!.cycle).toBeGreaterThanOrEqual(2017);
    expect(Number(db.value('SELECT cycle_year FROM office_seat WHERE office_id = ?', [txJustice.id]))).toBe(txJustice.seat!.cycle);

    // Contests of 2016 by kind of office: partisan generals, retention votes, nonpartisan races and primaries.
    const contests = rows(`SELECT c.contest_id, c.kind, c.method, c.status, c.nonpartisan, c.year, o.kind AS office, s.body, e.kind AS ekind, e.day FROM contest c JOIN office o ON o.office_id = c.office_id JOIN office_seat s ON s.office_id = o.office_id JOIN election e ON e.election_id = c.election_id`);
    const y16 = contests.filter((c) => c.year === 2016);
    for (const k of ['treasurer', 'auditor', 'superintendent', 'justice', 'appellate_judge', 'commissioner', 'education_board', 'regent']) expect(y16.some((c) => c.office === k)).toBe(true);
    // Retention votes: two options (the judge, then "no"), decided by the required share.
    const ret = contests.filter((c) => c.kind === 'retention' && Number(c.year) <= 2017);
    expect(ret.length).toBeGreaterThan(20);
    for (const c of ret) {
      expect(c.status).toBe('certified'); expect(c.nonpartisan).toBe(1);
      const k = rows('SELECT k.candidacy_id, k.party_id, k.ballot_order, k.status, t.votes FROM candidacy k JOIN contest_total t ON t.candidacy_id = k.candidacy_id AND t.rev = 3 WHERE k.contest_id = ? ORDER BY k.ballot_order', [c.contest_id]);
      expect(k).toHaveLength(2);
      expect(k[1]!.party_id).toBe(0);
      const yes = Number(k[0]!.votes) / (Number(k[0]!.votes) + Number(k[1]!.votes));
      expect(yes).toBeGreaterThan(0.4); expect(yes).toBeLessThan(0.95);
      expect(k[0]!.status).toBe(yes >= Number(String(c.method).slice(10)) ? 'won' : 'lost');
    }
    // Nonpartisan ballots: courts of nonpartisan states, Ohio's and Michigan's party-nominated Supreme Courts; not Texas's.
    const np = (usps: string) => contests.filter((c) => c.kind === 'general' && c.body === 'supreme' && rows('SELECT state_idx FROM contest WHERE contest_id = ?', [c.contest_id])[0]!.state_idx === idx(usps));
    for (const s of ['NC', 'MN', 'OH', 'MI', 'WA']) for (const c of np(s)) expect(c.nonpartisan).toBe(1);
    for (const c of np('TX')) expect(c.nonpartisan).toBe(0);
    expect(contests.some((c) => c.kind === 'top_two' && (c.method === 'np_majority' || c.method === 'np_final' || c.method === 'top_two') && c.nonpartisan === 1)).toBe(true);
    // Wisconsin: the spring election in April, a justice taking office on August 1.
    const wi = contests.filter((c) => c.ekind === 'spring' && c.year === 2016);
    expect(wi.length).toBeGreaterThan(0);
    expect(daysToCivil(Number(wi[0]!.day)).m).toBe(4);
    const wiStart = rows("SELECT t.start_time FROM office_term t JOIN contest c ON c.office_id = t.office_id WHERE c.contest_id = ? AND t.acquired LIKE '%(2016%'", [wi[0]!.contest_id]);
    if (wiStart.length) { const c = daysToCivil(easternDay(Number(wiStart[0]!.start_time))); expect([c.m, c.d]).toEqual([8, 1]); }
    // Pennsylvania's judicial elections are in odd years.
    const pa = contests.filter((c) => c.body === 'supreme' && rows('SELECT state_idx FROM contest WHERE contest_id = ?', [c.contest_id])[0]!.state_idx === idx('PA'));
    expect(pa.length).toBeGreaterThan(0);
    for (const c of pa) expect(Number(c.year) % 2).toBe(1);
    // District seats vote only in their district: a Texas board seat's ballots are a fraction of the state's.
    const sb = contests.find((c) => c.body === 'sboe' && c.year === 2016 && c.kind === 'general' && c.status === 'certified' && rows('SELECT state_idx FROM contest WHERE contest_id = ?', [c.contest_id])[0]!.state_idx === tx)!;
    const ballots = (id: number) => Number(db.value('SELECT ballots FROM contest_turnout WHERE contest_id = ? AND rev = 3', [id]));
    const pres = Number(db.value("SELECT contest_id FROM contest WHERE kind = 'pres_state' AND year = 2016 AND state_idx = ?", [tx]));
    expect(ballots(Number(sb.contest_id)) / ballots(pres)).toBeGreaterThan(1 / 30);
    expect(ballots(Number(sb.contest_id)) / ballots(pres)).toBeLessThan(1 / 5);
    // On the broadcast night: statewide down-ballot officers and supreme court seats; not boards or retention votes.
    const offices = new Set(rows("SELECT DISTINCT o.kind FROM contest c JOIN office o ON o.office_id = c.office_id JOIN night_election ne ON ne.election_id = c.election_id WHERE c.year = 2016 AND c.kind = 'general'").map((r) => r.kind));
    expect(offices.has('treasurer')).toBe(true);

    // Queries: the state's offices, boards and courts; a retention contest.
    const so = await runQuery(u, { kind: 'stateOffices', state: tx }) as StateOfficesDto;
    expect(so.bodies.map((b) => b.name)).toContain('Texas Railroad Commission');
    const court = so.bodies.find((b) => b.key === 'supreme')!;
    expect(court.members).toHaveLength(9);
    expect(court.composition.reduce((a, x) => a + x.seats, 0)).toBe(9);
    expect(so.summary.length).toBeGreaterThan(40);
    const rd = await runQuery(u, { kind: 'contest', id: Number(ret[0]!.contest_id) }) as ContestDetail;
    expect(rd.retention).not.toBeNull();
    expect(rd.candidates.map((x) => x.name)[1]).toBe('No');
    expect(rd.candidates[0]!.name).toMatch(/^Yes: retain /);

    expect(integrityReport(db).checks.filter((c) => !c.ok)).toEqual([]);
    u.close();
  }, 900_000);
});
