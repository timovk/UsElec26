/** A universe saved by the Phase 1 release (engine 0.1.0, schema 1) opens, migrates and runs the 2016 elections. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fixtureNames } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { integrityReport } from '../../../src/persistence/audit';
import { zonedToUtc } from '../../../src/core/time';

describe('Phase 1 save compatibility', () => {
  it('opens a Phase 1 universe and simulates its 2016 elections', async () => {
    const sqlite3 = await initSqlite();
    const storage = new MemoryStorage(sqlite3);
    const name = '/universes/u-phase1.sqlite3';
    await storage.importFile(name, new Uint8Array(gunzipSync(readFileSync('tests/fixtures/phase1-universe.sqlite3.gz'))));
    const u = await Universe.open(storage, name, fixtureNames());
    expect(Number(u.db.value('PRAGMA user_version'))).toBeGreaterThanOrEqual(2);
    expect(u.world.time).toBe(zonedToUtc(2016, 2, 15, 0, 0, 'America/New_York'));
    await u.advance({ kind: 'until', time: zonedToUtc(2017, 1, 25, 0, 0, 'America/New_York') });
    expect(Number(u.db.value("SELECT COUNT(*) FROM contest WHERE kind = 'pres_state' AND status IN ('decided','certified')"))).toBe(51);
    expect(Number(u.db.value('SELECT SUM(ev) FROM electoral_vote'))).toBe(538);
    expect(Number(u.db.value("SELECT COUNT(*) FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = 'president' AND t.end_time IS NULL AND t.start_time = ?", [zonedToUtc(2017, 1, 20, 12, 0, 'America/New_York')]))).toBe(1);
    expect(integrityReport(u.db).checks.filter((c) => !c.ok)).toEqual([]);
  }, 300_000);
});
