/**
 * Multi-member and floterial districts (Phase 7.4): the 2016 law's seats per district on the real districts,
 * district numbers and names, the schedules fixed with it (North Dakota's house, Alaska's and West Virginia's
 * senates, Minnesota's 2-4-4 senate), the "vote for N" ballot (inclusion probabilities against exact enumeration),
 * New Hampshire's floterials, and a fixture universe electing multi-member districts and statewide boards.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { isCountyKind } from '../../../src/rules/county2016';
import { Universe } from '../../../src/engine/universe';
import { integrityReport } from '../../../src/persistence/audit';
import { zonedToUtc } from '../../../src/core/time';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { loadGeoPack, SEMANTIC_FILES, type GeoPack } from '../../../src/geo/pack';
import { Districts } from '../../../src/engine/districts';
import { legislativeSeatUp } from '../../../src/engine/legislatures';
import { districtLabelOf, districtNumbers, seatsPerDistrict, websterSeats } from '../../../src/rules/legislativeSeats2016';
import { STATES_2016 } from '../../../src/rules/states2016';
import { inclusionProbs, markProbs } from '../../../src/electorate/kernel';
import { planFloterials } from '../../../src/geo/floterials';
import type { Office } from '../../../src/institutions/model';
import { Rng } from '../../../src/core/rng';

const DIR = 'public/geo-packs/2016.1/';
const real = existsSync(`${DIR}manifest.json`);
let pack: GeoPack | null = null;
const realPack = async () => pack ??= await loadGeoPack(async (f) => new Uint8Array(readFileSync(DIR + f)));

describe('state legislative seats (2016 law)', () => {
  it.runIf(real)('gives each multi-member chamber its real districts and seats', async () => {
    const p = await realPack(), D = new Districts(p);
    const chamber = (usps: string, sld: 'sldu' | 'sldl') => { const s = p.states.find((x) => x.usps === usps)!.idx; return D.table(sld).filter((d) => d.stateIdx === s); };
    const hist = (ds: { seats: number }[]) => { const h: Record<number, number> = {}; for (const d of ds) h[d.seats] = (h[d.seats] ?? 0) + 1; return h; };
    expect(hist(chamber('AZ', 'sldl'))).toEqual({ 2: 30 });
    expect(hist(chamber('NJ', 'sldl'))).toEqual({ 2: 40 });
    expect(hist(chamber('ND', 'sldl'))).toEqual({ 2: 47 });
    expect(hist(chamber('SD', 'sldl'))).toEqual({ 1: 4, 2: 33 }); // districts 26 and 28 split into A and B
    expect(hist(chamber('VT', 'sldl'))).toEqual({ 1: 58, 2: 46 });
    expect(hist(chamber('WV', 'sldl'))).toEqual({ 1: 47, 2: 11, 3: 6, 4: 2, 5: 1 });
    expect(hist(chamber('WV', 'sldu'))).toEqual({ 2: 17 });
    const vtS = Object.fromEntries(chamber('VT', 'sldu').map((d) => [d.label, d.seats]));
    expect(vtS).toMatchObject({ Chittenden: 6, Rutland: 3, Washington: 3, Windsor: 3, Addison: 2, 'Grand-Isle-Chittenden': 1, Lamoille: 1, Orange: 1 });
    // Maryland: three delegates per district, shared among its subdistricts.
    const md = chamber('MD', 'sldl'); const byNum = new Map<number, number>();
    for (const d of md) { const n = Number(/^0*(\d+)/.exec(d.code!)![1]); byNum.set(n, (byNum.get(n) ?? 0) + d.seats); }
    expect(byNum.size).toBe(47); for (const v of byNum.values()) expect(v).toBe(3);
    // Every chamber's seats add up to its size.
    for (const [usps, inst] of Object.entries(STATES_2016)) for (const [sld, ch] of [['sldu', inst.upper], ['sldl', inst.lower]] as const) {
      if (!ch || usps === 'NH' && sld === 'sldl') continue;
      expect(chamber(usps, sld).reduce((a, d) => a + d.seats, 0)).toBe(ch.seats);
    }
    // New Hampshire: whole seats per town district, the rest in floterials (stored when a universe is created).
    const nh = chamber('NH', 'sldl');
    const ensured = D.ensureFloterials();
    const flots = D.table('sldl').filter((d) => d.members);
    expect(ensured.added).toBe(flots.length);
    expect(flots.length).toBeGreaterThan(30); expect(flots.length).toBeLessThan(60);
    expect(nh.reduce((a, d) => a + d.seats, 0) + flots.reduce((a, d) => a + d.seats, 0)).toBe(400);
    for (const f of flots) {
      expect(f.members!.length).toBeGreaterThanOrEqual(2);
      const county = f.label.replace(/ \d+$/, '');
      for (const m of f.members!) expect(D.table('sldl')[m]!.label.startsWith(`${county} `)).toBe(true);
    }
    expect(new Set(D.districtsOf('sldl', nh[0]!.stateIdx, 2016).map((d) => d.number)).size).toBe(nh.length + flots.length);
  }, 120_000);

  it.runIf(real)('numbers every district uniquely and names it as the state does', async () => {
    const p = await realPack(), D = new Districts(p);
    for (const sld of ['sldu', 'sldl'] as const) for (const st of p.states) {
      const ds = D.table(sld).filter((d) => d.stateIdx === st.idx);
      expect(new Set(ds.map((d) => d.number)).size).toBe(ds.length);
    }
    const labels = (usps: string, sld: 'sldu' | 'sldl') => { const s = p.states.find((x) => x.usps === usps)!.idx; return D.table(sld).filter((d) => d.stateIdx === s).map((d) => d.label); };
    expect(labels('MN', 'sldl').slice(0, 3)).toEqual(['1A', '1B', '2A']);
    expect(labels('AK', 'sldu').slice(0, 3)).toEqual(['A', 'B', 'C']);
    expect(labels('VT', 'sldl')[0]).toBe('Addison-1');
    expect(labels('NH', 'sldl')[0]).toBe('Belknap 1');
    expect(labels('MA', 'sldl')[0]).toBe('1st Barnstable');
    expect(labels('TX', 'sldl').slice(0, 2)).toEqual(['1', '2']);
  });

  it('derives numbers, names and seat shares from the codes', () => {
    expect(districtNumbers([{ code: '01A', idx: 0, pop2010: 1 }, { code: '01B', idx: 1, pop2010: 1 }, { code: '02A', idx: 2, pop2010: 1 }])).toEqual([1, 2, 3]);
    expect(districtNumbers([{ code: '004', idx: 0, pop2010: 1 }, { code: '017', idx: 1, pop2010: 1 }])).toEqual([4, 17]);
    expect(districtLabelOf({ code: '00C', name: 'C', idx: 0, pop2010: 1 })).toBe('C');
    expect(districtLabelOf({ code: '007', name: 'District 7', idx: 0, pop2010: 1 })).toBe('7');
    expect(districtLabelOf({ code: '001', name: 'HD-001', idx: 0, pop2010: 1 })).toBe('1');
    expect(websterSeats([10, 20, 30], 6)).toEqual([1, 2, 3]);
    expect(websterSeats([1, 1, 1, 1], 4)).toEqual([1, 1, 1, 1]);
    // A rule that does not fit the districts (a synthetic geography) shares the seats by population.
    expect(seatsPerDistrict('AZ', 'lower', [{ code: '1', idx: 0, pop2010: 2 }, { code: '2', idx: 1, pop2010: 1 }], 6)).toEqual({ seats: [4, 2], mode: 'block' });
    expect(seatsPerDistrict('TX', 'lower', [{ code: '1', idx: 0, pop2010: 1 }, { code: '2', idx: 1, pop2010: 1 }], 2)).toEqual({ seats: [1, 1], mode: 'single' });
  });

  it('pools New Hampshire leftovers within a county', () => {
    const ds = [1.3, 2.4, 1.0, 3.35, 1.0, 0.95].map((q, i) => ({ label: `${i < 4 ? 'Grafton' : 'Coos'} ${i + 1}`, pop: q * 1000, x: i, y: 0 }));
    const plan = planFloterials(ds, 10);
    expect(plan.baseSeats.reduce((a, b) => a + b, 0) + plan.floterials.reduce((a, f) => a + f.seats, 0)).toBe(10);
    for (const f of plan.floterials) expect(new Set(f.members.map((m) => ds[m]!.label.split(' ')[0])).size).toBe(1);
  });

  it('elects the seats on the 2016 schedules', () => {
    const o = (kind: Office['kind']) => ({ kind }) as Office;
    // North Dakota's house: four-year terms by halves, with the district's senator (it was never elected before 7.4).
    expect([2016, 2018, 2020].map((y) => legislativeSeatUp(o('state_representative'), 3, y, 'ND'))).toEqual([true, false, true]);
    expect([2016, 2018].map((y) => legislativeSeatUp(o('state_representative'), 4, y, 'ND'))).toEqual([false, true]);
    expect([2016, 2018].map((y) => legislativeSeatUp(o('state_senator'), 3, y, 'ND'))).toEqual([true, false]);
    // Minnesota's senate on a 2-4-4 cycle: 2016, 2020, 2022, 2026.
    expect([2016, 2018, 2020, 2022, 2024, 2026].map((y) => legislativeSeatUp(o('state_senator'), 5, y, 'MN'))).toEqual([true, false, true, true, false, true]);
    // West Virginia: one of each senate district's two seats per election.
    expect([2016, 2018].map((y) => [1, 2].map((post) => legislativeSeatUp(o('state_senator'), 7, y, 'WV', post)))).toEqual([[true, false], [false, true]]);
    // Alaska's senate districts A–T (numbered 1–20) by halves.
    expect([1, 2].map((n) => legislativeSeatUp(o('state_senator'), n, 2016, 'AK'))).toEqual([true, false]);
  });
});

describe('vote for N', () => {
  // Exact inclusion probabilities of successive sampling without replacement, by enumeration.
  const exact = (w: number[], n: number): number[] => {
    const out = w.map(() => 0);
    const rec = (left: number[], k: number, p: number, chosen: number[]) => {
      if (k === 0) { for (const c of chosen) out[c]! += p; return; }
      const s = left.reduce((a, j) => a + w[j]!, 0);
      for (const j of left) rec(left.filter((x) => x !== j), k - 1, p * w[j]! / s, [...chosen, j]);
    };
    rec(w.map((_, j) => j), n, 1, []);
    return out;
  };
  it('approximates the inclusion probabilities of marking N names', () => {
    const r = Rng.stream('vote-for-n', 'cases');
    let worst = 0;
    for (let t = 0; t < 60; t++) {
      const J = 3 + r.int(4), n = 2 + r.int(Math.min(2, J - 2));
      const w = Array.from({ length: J }, () => Math.exp(r.normal(0, 1)));
      const pi = new Float64Array(J); inclusionProbs(w, n, pi);
      const ex = exact(w, n);
      expect(Math.abs([...pi].reduce((a, b) => a + b, 0) - n)).toBeLessThan(0.05);
      for (let j = 0; j < J; j++) worst = Math.max(worst, Math.abs(pi[j]! - ex[j]!));
    }
    expect(worst).toBeLessThan(0.015);
  });
  it('marks at most N names per ballot, fewer when the party runs fewer', () => {
    const out = new Float64Array(5), wb = new Float64Array(4), pb = new Float64Array(4);
    // Two Democrats and two Republicans for two seats; a Democratic-leaning voter.
    markProbs([1, 1, -1, -1, -2], [0.5, 0.5, -0.5, -0.5], 2, out, wb, pb);
    const marks = out[0]! + out[1]! + out[2]! + out[3]!;
    expect(marks).toBeLessThanOrEqual(2 * (1 - out[4]!) + 1e-9);
    expect(out[0]!).toBeGreaterThan(out[2]!);
    // One Democrat for two seats: the second mark is often withheld.
    const one = new Float64Array(4); markProbs([1, -1, -1, -2], [0.5, -0.5, -0.5], 2, one, wb, pb);
    expect(one[0]! + one[1]! + one[2]!).toBeLessThan(marks);
  });
});

let sqlite3: Sqlite3Static; let files: Map<string, Uint8Array>;
beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('multi-member districts in a universe (fixture)', () => {
  it('elects vote-for-N districts, floterials and boards, 2016 into 2017', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Multi', seed: 'MULTI-1' }, files, fixtureNames());
    const w = u.world, db = u.db;
    const usps = (s: number) => w.pack.states[s]!.usps;
    // Floterials stored at founding, with seats; every chamber's offices fill its districts' seats.
    const flots = w.districts.table('sldl').filter((d) => d.members);
    expect(flots.length).toBeGreaterThan(0);
    expect(flots.every((f) => usps(f.stateIdx) === 'NH')).toBe(true);
    expect(Number(db.value('SELECT COUNT(*) FROM district_member'))).toBe(flots.reduce((a, f) => a + f.members!.length, 0));
    for (const st of w.pack.states) for (const [kind, sld] of [['state_senator', 'sldu'], ['state_representative', 'sldl']] as const) {
      const offices = w.offices.filter((o) => o.kind === kind && o.stateIdx === st.idx);
      if (!offices.length) continue;
      const seats = w.districts.districtsOf(sld, st.idx, 2016).reduce((a, d) => a + d.seats, 0);
      expect(offices.length).toBe(seats);
    }
    await u.advance({ kind: 'until', time: zonedToUtc(2017, 1, 20, 0, 0, 'America/New_York') });
    const rows = (sql: string, p: unknown[] = []) => db.all<Record<string, number | string | null>>(sql, p as never);
    // Legislative districts and statewide boards (county boards elected at large are Phase 7.6's).
    const blocks = rows("SELECT c.contest_id, c.state_idx, c.seats, c.status, c.method, c.district_idx, o.kind FROM contest c JOIN office o ON o.office_id = c.office_id WHERE c.year = 2016 AND c.kind = 'general' AND c.seats > 1")
      .filter((b) => !isCountyKind(String(b.kind)));
    const states = new Set(blocks.filter((b) => b.kind === 'state_representative').map((b) => usps(Number(b.state_idx))));
    for (const s of ['AZ', 'NH', 'SD', 'VT', 'WV']) expect(states.has(s)).toBe(true);
    for (const b of blocks) {
      expect(b.method).toBe('block'); expect(b.status).toBe('certified');
      const n = Number(b.seats);
      const won = rows("SELECT candidacy_id, person_id FROM candidacy WHERE contest_id = ? AND status = 'won'", [b.contest_id]);
      expect(won.length).toBe(n);
      const seats = rows('SELECT office_id, candidacy_id FROM contest_seat WHERE contest_id = ?', [b.contest_id]);
      expect(seats.length).toBe(n);
      expect(new Set(seats.map((x) => x.candidacy_id))).toEqual(new Set(won.map((x) => x.candidacy_id)));
      // Each winner now holds one of the district's seats (unless they died before taking office).
      for (const x of seats) {
        const want = won.find((y) => y.candidacy_id === x.candidacy_id)!.person_id;
        if (w.persons.get(Number(want))!.deathDay === null) expect(w.current.get(Number(x.office_id))?.personId).toBe(want);
      }
      // N marks per ballot: votes and unused marks add up to N × ballots.
      const t = db.get<{ ballots: number; undervotes: number; valid: number }>('SELECT ballots, undervotes, votes AS valid FROM contest_turnout WHERE contest_id = ? AND rev = 3', [b.contest_id])!;
      expect(Math.abs(t.valid + t.undervotes - n * t.ballots)).toBeLessThanOrEqual(n);
      expect(t.valid).toBeGreaterThan(t.ballots);
    }
    // Floterial districts are elected by their member districts' voters.
    const flotContests = blocks.filter((b) => flots.some((f) => f.idx === Number(b.district_idx)));
    const flotSingles = rows('SELECT contest_id FROM contest WHERE year = 2016 AND kind = ? AND district_idx IN (' + flots.map((f) => f.idx).join(',') + ')', ['general']);
    expect(flotContests.length + flotSingles.length).toBeGreaterThan(0);
    // Statewide boards: Michigan's four boards elect two seats each in one race; Arizona's commission three.
    const boards = rows("SELECT c.label, c.seats, c.state_idx FROM contest c JOIN office o ON o.office_id = c.office_id WHERE c.year = 2016 AND c.kind = 'general' AND c.seats > 1 AND o.kind IN ('education_board', 'regent', 'commissioner')");
    expect(boards.filter((b) => usps(Number(b.state_idx)) === 'MI').map((b) => Number(b.seats))).toEqual([2, 2, 2, 2]);
    expect(boards.filter((b) => usps(Number(b.state_idx)) === 'AZ').map((b) => Number(b.seats))).toEqual([3]);
    // North Dakota's house is elected now (half its districts in 2016).
    const nd = w.pack.states.find((s) => s.usps === 'ND')!.idx;
    expect(Number(db.value("SELECT COUNT(*) FROM contest c JOIN office o ON o.office_id = c.office_id WHERE c.year = 2016 AND c.kind = 'general' AND o.kind = 'state_representative' AND c.state_idx = ?", [nd]))).toBeGreaterThan(0);
    expect(integrityReport(db).checks.filter((c) => !c.ok)).toEqual([]);
    u.close();
  }, 900_000);
});

void SEMANTIC_FILES;
