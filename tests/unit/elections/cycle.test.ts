/** A full 2016 election cycle on the fixture geography. */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { integrityReport } from '../../../src/persistence/audit';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { zonedToUtc } from '../../../src/core/time';

let sqlite3: Sqlite3Static; let files: Map<string, Uint8Array>;
beforeAll(async () => { sqlite3 = await initSqlite(); files = await packToFiles(makeFixturePack()); });

describe('2016 election cycle (fixture)', () => {
  it('runs primaries, the general, the Electoral College and inaugurations', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Cycle', seed: 'CYCLE-1' }, files, fixtureNames());
    const news = await u.advance({ kind: 'until', time: zonedToUtc(2017, 2, 1, 0, 0, 'America/New_York') });
    const db = u.db;
    const count = (sql: string) => Number(db.value(sql));
    console.log(news.filter((n) => ['results', 'electoral_college', 'nomination', 'contingent', 'inauguration'].includes(n.kind)).map((n) => `${n.headline} — ${n.body}`).slice(0, 12).join('\n'));
    // Every headline produced during the advance is returned, including those flushed mid-event by election commits.
    expect(news.some((n) => n.kind === 'results' && /win the presidency/.test(n.headline))).toBe(true);
    expect(news.length).toBe(count('SELECT COUNT(*) FROM news') - 1);
    expect(count("SELECT COUNT(*) FROM contest WHERE kind = 'pres_state'")).toBe(51);
    expect(count("SELECT COUNT(*) FROM contest WHERE kind IN ('general') AND year = 2016 AND parent_contest IS NULL AND office_id IN (SELECT office_id FROM office WHERE kind = 'us_representative')")).toBe(435);
    expect(count("SELECT COUNT(*) FROM contest WHERE year = 2016 AND kind IN ('general','pres_state') AND status NOT IN ('decided','certified','runoff')")).toBe(0);
    expect(count('SELECT COUNT(*) FROM result_revision')).toBeGreaterThan(500);
    const ev = db.all<{ ev: number }>('SELECT ev FROM electoral_vote');
    expect(ev.reduce((a, x) => a + x.ev, 0)).toBe(538);
    // A new Congress and President took office.
    const terms2017 = count("SELECT COUNT(*) FROM office_term WHERE start_time >= " + zonedToUtc(2017, 1, 3, 0, 0, 'America/New_York'));
    expect(terms2017).toBeGreaterThan(500);
    const pres = db.get<{ start_time: number }>("SELECT t.start_time FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = 'president' AND t.end_time IS NULL");
    expect(pres!.start_time).toBe(zonedToUtc(2017, 1, 20, 12, 0, 'America/New_York'));
    expect(integrityReport(db).checks.filter((c) => !c.ok)).toEqual([]);
    // Election night: sealed record, no desk event before polls close, replay ends exactly at the certified count.
    const { sha256Hex } = await import('../../../src/core/codec');
    const { Playback } = await import('../../../src/broadcast/playback');
    const night = db.get<{ night_id: number; payload: Uint8Array; sha256: string }>("SELECT night_id, payload, sha256 FROM night WHERE kind = 'general'")!;
    expect(await sha256Hex(night.payload)).toBe(night.sha256);
    const rec = (await u.elections.nightRecord(night.night_id))!;
    for (let i = 0; i < rec.events.time.length; i++) expect(rec.events.time[i]!).toBeGreaterThanOrEqual(rec.races[rec.events.race[i]!]!.close);
    const pb = new Playback(rec), end = pb.at(rec.feedEnd), again = new Playback(rec).at(rec.feedEnd);
    let checked = 0;
    rec.races.forEach((race, r) => {
      if (race.cd >= 0) return;
      const totals = race.candidacyIds.map((cid) => Number(db.value('SELECT votes FROM contest_total WHERE contest_id = ? AND rev = 3 AND candidacy_id = ?', [race.contestId, cid])));
      expect(Array.from(end.races[r]!.votes).slice(0, race.k - 1)).toEqual(totals);
      expect(Array.from(again.races[r]!.votes)).toEqual(Array.from(end.races[r]!.votes));
      checked++;
    });
    expect(checked).toBeGreaterThan(500);
    // Before the first poll closes the count shows nothing.
    expect(pb.at(rec.coverageStart).races.every((x) => x.ballots === 0 || x.status === 0)).toBe(true);
  }, 300_000);
});

describe('election determinism and continuity (fixture)', () => {
  it('advancing through an election in one go equals advancing with a save/reload mid-campaign', async () => {
    const { contentHash } = await import('../../../src/persistence/audit');
    const target = zonedToUtc(2016, 12, 1, 0, 0, 'America/New_York');
    const a = await Universe.create(new MemoryStorage(sqlite3), { name: 'F', seed: 'FORK-E' }, files, fixtureNames());
    await a.advance({ kind: 'until', time: target });
    const sb = new MemoryStorage(sqlite3);
    const b = await Universe.create(sb, { name: 'F', seed: 'FORK-E' }, files, fixtureNames());
    await b.advance({ kind: 'until', time: zonedToUtc(2016, 4, 15, 0, 0, 'America/New_York') });
    const name = b.fileName; b.close();
    const b2 = await Universe.open(sb, name, fixtureNames());
    await b2.advance({ kind: 'until', time: target });
    const strip = async (u: Universe) => { u.db.exec('DELETE FROM command_log'); return contentHash(u.db); };
    expect(await strip(b2)).toBe(await strip(a));
  }, 300_000);

  it('archive audit passes for every 2016 election', async () => {
    const { auditElection } = await import('../../../src/archive/results');
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'A', seed: 'AUDIT-1' }, files, fixtureNames());
    await u.advance({ kind: 'until', time: zonedToUtc(2017, 1, 1, 0, 0, 'America/New_York') });
    const pack = u.world.pack; const starts = pack.states.map((s) => pack.counties.find((c) => c.stateIdx === s.idx)!.buStart);
    const els = u.db.all<{ election_id: number }>("SELECT election_id FROM election WHERE status <> 'scheduled'");
    expect(els.length).toBeGreaterThan(60);
    for (const e of els) {
      const f = await auditElection(u.db, e.election_id, (b) => pack.counties[pack.bu.county[b]!]!.stateIdx, (s) => starts[s]!, (b) => pack.bu.county[b]!);
      expect(f.filter((x) => !x.ok)).toEqual([]);
    }
    // Tamper with one stored result and the audit must catch it.
    const cid = Number(u.db.value("SELECT contest_id FROM contest WHERE kind = 'pres_state' LIMIT 1"));
    u.db.run('UPDATE contest_total SET votes = votes + 1 WHERE contest_id = ? AND rank = 1', [cid]);
    const eid = Number(u.db.value('SELECT election_id FROM contest WHERE contest_id = ?', [cid]));
    const f = await auditElection(u.db, eid, (b) => pack.counties[pack.bu.county[b]!]!.stateIdx, (s) => starts[s]!, (b) => pack.bu.county[b]!);
    expect(f.some((x) => !x.ok)).toBe(true);
  }, 300_000);
});

describe('compute pool (fixture)', () => {
  it('1 worker, 4 workers and inline execution give an identical universe', async () => {
    const { WorkerPoolRunner } = await import('../../../src/engine/computePool');
    const { runJob } = await import('../../../src/engine/nightJob');
    const { contentHash } = await import('../../../src/persistence/audit');
    const { Rng } = await import('../../../src/core/rng');
    // A stand-in for a Compute Worker: structured-clones the input (as postMessage does) and replies after a
    // random delay, so shards complete out of order across the pool.
    const jitter = Rng.stream('pool-test');
    const fakeWorker = () => {
      const w = {
        onmessage: null as ((ev: MessageEvent) => void) | null, onerror: null as ((ev: ErrorEvent) => void) | null,
        postMessage(inp: unknown) {
          const copy = structuredClone(inp) as Parameters<typeof runJob>[0];
          setTimeout(() => w.onmessage?.({ data: { ok: true, out: runJob(copy) } } as MessageEvent), Math.floor(jitter.float() * 4));
        },
        terminate() {},
      };
      return w as unknown as Worker;
    };
    const target = zonedToUtc(2016, 11, 20, 0, 0, 'America/New_York');
    const hashes: string[] = [];
    for (const workers of [0, 1, 4]) {
      const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'P', seed: 'POOL-1' }, files, fixtureNames());
      if (workers) u.runner = new WorkerPoolRunner(fakeWorker, workers);
      await u.advance({ kind: 'until', time: target });
      u.db.exec('DELETE FROM command_log');
      hashes.push(await contentHash(u.db));
    }
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).toBe(hashes[0]);
  }, 600_000);
});

describe('Next election (fixture)', () => {
  it('stops after the first election day, holding every contest scheduled at that moment', async () => {
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'N', seed: 'NEXT-1' }, files, fixtureNames());
    await u.advance({ kind: 'nextElection' });
    const held = u.db.all<{ day: number }>("SELECT DISTINCT day FROM election WHERE status <> 'scheduled' AND kind <> 'pres_nomination'");
    expect(held.length).toBe(1);
    const first = Number(u.db.value("SELECT MIN(day) FROM election WHERE kind IN ('primary','general','special','runoff')"));
    expect(held[0]!.day).toBe(first);
    expect(Number(u.db.value("SELECT COUNT(*) FROM election WHERE day = ? AND status = 'scheduled' AND kind IN ('primary','general')", [first]))).toBe(0);
    expect(u.world.time).toBeLessThan(zonedToUtc(2016, 11, 1, 0, 0, 'America/New_York'));
    // A second step moves on to the next election day.
    await u.advance({ kind: 'nextElection' });
    expect(u.db.all("SELECT DISTINCT day FROM election WHERE status <> 'scheduled' AND kind <> 'pres_nomination'").length).toBe(2);
  }, 300_000);
});
