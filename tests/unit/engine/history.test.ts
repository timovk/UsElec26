/**
 * Election histories by area: a congressional district by its code (its House races and every statewide contest
 * within it, as drawn at the time), a state (its statewide contests, districts and counties) and a county (with
 * its districts). Fixture universe through the 2016 general election.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { zonedToUtc } from '../../../src/core/time';
import { runQuery } from '../../../src/engine/queries';
import type { CountyHistoryDto, DistrictHistoryDto, StateHistoryDto } from '../../../src/engine/protocol';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let sqlite3: Sqlite3Static; let files: Map<string, Uint8Array>;
beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('election histories by area (fixture)', () => {
  it('a district, its state and a county', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'History', seed: 'HIST-1' }, files, fixtureNames());
    await u.advance({ kind: 'until', time: zonedToUtc(2016, 12, 20, 0, 0, 'America/New_York') });
    const w = u.world, tx = w.pack.states.find((s) => s.usps === 'TX')!.idx;
    const st = await runQuery(u, { kind: 'stateHistory', state: tx }) as StateHistoryDto;
    expect(st.name).toBe('Texas');
    expect(st.rows.some((r) => r.officeKind === 'president' && r.year === 2016)).toBe(true);
    expect(st.rows.some((r) => r.officeKind === 'us_representative' || r.officeKind === 'state_representative')).toBe(false);
    expect(st.districts.length).toBe(w.districts.districtsOf('cd', tx, 2016).length);
    expect(st.counties.length).toBe(w.pack.counties.filter((c) => c.stateIdx === tx).length);
    const statePres = st.rows.find((r) => r.officeKind === 'president' && r.year === 2016)!;

    // Every district: its House race, the presidential race within it; the districts' presidential votes add up to the state's.
    let sum = 0;
    for (const d of st.districts) {
      const h = await runQuery(u, { kind: 'districtHistory', code: d.code }) as DistrictHistoryDto;
      expect(h.found).toBe(true);
      expect(h.code).toBe(d.code);
      const house = h.rows.filter((r) => r.officeKind === 'us_representative');
      expect(house.length).toBe(1);
      expect(house[0]!.label).toContain(d.code);
      const pres = h.rows.find((r) => r.officeKind === 'president' && r.year === 2016)!;
      expect(pres.total).toBeLessThan(statePres.total);
      sum += pres.total + pres.undervotes;
      expect(h.now?.counties.length).toBeGreaterThan(0);
      expect(h.now!.counties.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 6);
      // No state legislative seats, no other district's House race.
      expect(h.rows.some((r) => r.officeKind === 'state_senator' || r.officeKind === 'state_representative')).toBe(false);
    }
    // The state total here is certified; the districts' are as cast (certified = cast − rejected), so cast ≥ certified.
    expect(sum).toBeGreaterThanOrEqual(statePres.total + statePres.undervotes);
    expect(sum).toBeLessThan((statePres.total + statePres.undervotes) * 1.05);

    expect((await runQuery(u, { kind: 'districtHistory', code: 'TX-99' }) as DistrictHistoryDto).found).toBe(false);
    expect((await runQuery(u, { kind: 'districtHistory', code: 'nonsense' }) as DistrictHistoryDto).found).toBe(false);
    const wy = await runQuery(u, { kind: 'districtHistory', code: 'wy-al' }) as DistrictHistoryDto;
    expect(wy.found).toBe(true); expect(wy.code).toBe('WY-AL'); expect(wy.number).toBe(0);

    const county = w.pack.counties.find((c) => c.stateIdx === tx)!;
    const ch = await runQuery(u, { kind: 'countyHistory', county: county.idx }) as CountyHistoryDto;
    expect(ch.districts.length).toBeGreaterThan(0);
    for (const code of ch.districts) expect(code).toMatch(/^TX-\d{2}$/);
    u.close();
  }, 600_000);
});
