/**
 * Reapportionment and seats: a state that loses a seat after one census and regains it after the next gets a
 * live office for every seat (the abolished office does not count), and seat numbers stay one office each.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let sqlite3: Sqlite3Static;
let files: Map<string, Uint8Array>;
beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('reapportionment and House seats', () => {
  it('a seat lost after one census and regained after the next is elected again', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Seats', seed: 'seats-1' }, files, fixtureNames());
    const w = u.world, census = (u as unknown as { census: { redistrict(c: number, s: number): Promise<void> } }).census;
    const base = w.pack.states.map((st) => w.districts.seats(st.idx, 2016));
    const s = base.findIndex((n) => n >= 3);
    expect(s).toBeGreaterThanOrEqual(0);
    const live = (year: number) => w.offices.filter((o) => o.kind === 'us_representative' && o.stateIdx === s && !w.districts.isAbolished(o.id, year));
    const numbers = (year: number) => live(year).map((o) => w.districts.cds[o.districtIdx!]!.number).sort((a, b) => a - b);

    w.districts.setApportionment(2020, base.map((n, i) => (i === s ? n - 1 : n)));
    await census.redistrict(2020, s);
    expect(live(2022).length).toBe(base[s]! - 1);
    expect(numbers(2022)).toEqual(Array.from({ length: base[s]! - 1 }, (_, i) => i + 1));

    w.districts.setApportionment(2030, base);
    await census.redistrict(2030, s);
    expect(live(2032).length).toBe(base[s]!);                                     // the regained seat has an office
    expect(numbers(2032)).toEqual(Array.from({ length: base[s]! }, (_, i) => i + 1)); // one office per number
    u.close();
  }, 300_000);
});
