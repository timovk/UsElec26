import { beforeAll, describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { runQuery } from '../../../src/engine/queries';
import type { BillDto, CensusDto, CongressDto, DistrictMapDto, EconomyDto, ElectorateSummary, LegislaturesDto } from '../../../src/engine/protocol';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let sqlite3: Sqlite3Static;
let files: Map<string, Uint8Array>;

beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('Government queries', () => {
  it('report the economy, Congress, legislatures, census and district maps from the record', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Q', seed: 'gov-q-1' }, files, fixtureNames());
    await u.advance({ kind: 'days', days: 120 });
    const q = <T,>(x: Parameters<typeof runQuery>[1]) => Promise.resolve(runQuery(u, x)) as Promise<T>;

    const e = await q<EconomyDto>({ kind: 'economy' });
    expect(e.president).not.toBeNull();
    expect(e.releases.some((r) => r.kind === 'unemployment')).toBe(true);           // jobs reports from February
    expect(e.releases.every((r) => r.time <= u.world.time)).toBe(true);              // nothing unpublished
    expect(e.truth.length).toBeGreaterThanOrEqual(4);
    for (const p of e.approvalPolls) { expect(p.approve).toBeGreaterThan(0); expect(p.approve + p.disapprove).toBeLessThanOrEqual(100); }

    const c = await q<CongressDto>({ kind: 'congress' });
    expect(c.congress).toBe(114);
    expect(c.chambers.map((x) => x.seats).sort()).toEqual([100, 435]);
    for (const b of c.bills) {
      const d = (await q<BillDto>({ kind: 'bill', id: b.id }))!;
      expect(d.rollCalls.length).toBeGreaterThan(0);
      // Party breakdowns add up to each roll call's tally.
      for (const r of d.rollCalls) { expect(r.byParty.reduce((a, p) => a + p.yea, 0)).toBe(r.yea); expect(r.byParty.reduce((a, p) => a + p.nay, 0)).toBe(r.nay); }
    }

    const l = await q<LegislaturesDto>({ kind: 'legislatures' });
    expect(l.states.length).toBeGreaterThan(0);
    expect(l.states.every((s) => s.chambers.length >= 1 && s.chambers.length <= 2)).toBe(true);
    const seats = l.states.reduce((a, s) => a + s.chambers.reduce((b, ch) => b + ch.seats, 0), 0);
    expect(l.totals.dLegislators + l.totals.rLegislators + l.totals.others).toBe(seats);

    const cen = await q<CensusDto>({ kind: 'census' });
    expect(cen.censuses).toEqual([]);                                                // the first census is in 2020
    expect(cen.demography.map((d) => d.year)).toEqual([2016]);

    const st = u.world.pack.states.find((s) => u.world.pack.cds.filter((d) => d.stateIdx === s.idx).length > 1)!;
    const m = (await q<DistrictMapDto>({ kind: 'districtMap', state: st.idx, plan: 'cd', year: 2016 }))!;
    expect(m.districts.length).toBe(u.world.pack.cds.filter((d) => d.stateIdx === st.idx).length);
    expect(m.x.length).toBe(m.district.length);
    expect(new Set(m.district).size).toBe(m.districts.length);                       // every district has units
    expect(m.districts.every((d) => d.holderParty !== null)).toBe(true);

    const el = await q<ElectorateSummary>({ kind: 'electorate' });
    expect(el.history.map((h) => h.year)).toEqual([2016]);
    u.close();
  }, 300_000);
});
