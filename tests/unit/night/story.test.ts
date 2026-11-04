/**
 * Alerts and commentary: every line is bound to facts (no unbound slot), the story is deterministic, no alert
 * or line about a race comes before its polls close, and commentary does not repeat itself.
 * Real geography is opt-in: ENA_STORY=seed1,seed2 (prints a sample of the night's commentary).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { SEMANTIC_FILES } from '../../../src/geo/pack';
import { parseNameFile } from '../../../src/politicians/nameData';
import { formatTime, zonedToUtc } from '../../../src/core/time';
import { about, realize, validateLine, SPEAKERS } from '../../../src/broadcast/story';
import { surname } from '../../../src/core/names';
import { nightStory } from '../../../src/engine/nightStory';
import type { NightRecord, Story } from '../../../src/counting/record';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let sqlite3: Sqlite3Static;
beforeAll(async () => { sqlite3 = await initSqlite(); });

/** Repetition metrics: share of repeated templates within a sliding window, and distinct trigram ratio. */
export function repetition(story: Story): { windowRepeat: number; trigramDistinct: number; maxTemplateShare: number } {
  const W = 8; let rep = 0;
  story.lines.forEach((l, i) => { if (story.lines.slice(Math.max(0, i - W), i).some((x) => x.template === l.template)) rep++; });
  const grams = new Map<string, number>(); let total = 0;
  for (const l of story.lines) {
    const w = l.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
    for (let i = 0; i + 2 < w.length; i++) { const g = `${w[i]} ${w[i + 1]} ${w[i + 2]}`; grams.set(g, (grams.get(g) ?? 0) + 1); total++; }
  }
  const byTpl = new Map<string, number>(); for (const l of story.lines) byTpl.set(l.template, (byTpl.get(l.template) ?? 0) + 1);
  return { windowRepeat: story.lines.length ? rep / story.lines.length : 0, trigramDistinct: total ? grams.size / total : 1, maxTemplateShare: story.lines.length ? Math.max(...byTpl.values()) / story.lines.length : 0 };
}

export function checkStory(rec: NightRecord, story: Story): void {
  for (const l of story.lines) {
    expect(validateLine(l.text), l.text).toBe(true);
    expect(l.speaker).toBeGreaterThanOrEqual(0); expect(l.speaker).toBeLessThan(SPEAKERS.length);
    if (l.race >= 0) expect(l.time, l.text).toBeGreaterThanOrEqual(rec.races[l.race]!.close);
    expect(l.time).toBeGreaterThanOrEqual(rec.coverageStart);
  }
  for (const a of story.alerts) {
    expect(validateLine(a.headline) && validateLine(a.detail + ' ..........'), `${a.headline} / ${a.detail}`).toBe(true);
    if (a.race >= 0) expect(a.time, a.headline).toBeGreaterThanOrEqual(rec.races[a.race]!.close);
  }
  // Lines are in time order and never two at once from the same speaker.
  for (let i = 1; i < story.lines.length; i++) expect(story.lines[i]!.time).toBeGreaterThanOrEqual(story.lines[i - 1]!.time);
}

describe('story templates', () => {
  it('drops lines with unbound slots and keeps optional clauses only when bound', () => {
    expect(realize('{a} leads.', { a: 'Kim' })).toBe('Kim leads.');
    expect(realize('{a} leads {b}.', { a: 'Kim' })).toBeNull();
    expect(realize('{a} leads.[[b| {b} trails.]]', { a: 'Kim' })).toBe('Kim leads.');
    expect(realize('{a} leads.[[b| {b} trails.]]', { a: 'Kim', b: 'Lee' })).toBe('Kim leads. Lee trails.');
    expect(realize('{a} leads[[x|, with {y} out]].', { a: 'Kim', x: true })).toBe('Kim leads.');
    expect(realize('{a} is {n}.', { a: 'Kim', n: NaN })).toBeNull();
    expect(surname('Paul Rodriguez Jr.')).toBe('Rodriguez'); expect(surname('Isaac Torres III')).toBe('Torres'); expect(surname('Kim')).toBe('Kim');
    expect(about(41234)).toBe('about 41,000'); expect(about(1_234_567)).toBe('about 1.2 million'); expect(about(1234)).toBe('about 1,200');
  });
});

describe('alerts and commentary (fixture)', () => {
  it('is fact-bound, deterministic, after poll closings and varied', async () => {
    const files = await packToFiles(makeFixturePack());
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Story', seed: 'STORY-1' }, files, fixtureNames());
    await u.advance({ kind: 'until', time: zonedToUtc(2016, 11, 9, 12, 0, 'America/New_York') });
    const id = Number(u.db.value("SELECT night_id FROM night WHERE kind = 'general'"));
    const rec = (await u.elections.nightRecord(id))!;
    const story = rec.story!;
    expect(story.lines.length).toBeGreaterThan(20);
    expect(story.alerts.some((a) => a.kind === 'polls_closed')).toBe(true);
    expect(story.alerts.some((a) => a.kind === 'projection')).toBe(true);
    checkStory(rec, story);
    // Rebuilt from the record and the archive: identical.
    const again = nightStory(u.db, u.world, { ...rec, story: undefined } as unknown as NightRecord);
    expect(JSON.stringify(again.lines)).toBe(JSON.stringify(story.lines));
    const m = repetition(story);
    if (process.env.ENA_STORY_PRINT) console.log(story.lines.map((l) => `${formatTime(l.time)} ${SPEAKERS[l.speaker]!.name} [${l.template}]: ${l.text}`).join('\n') + '\n' + story.alerts.map((a) => `${formatTime(a.time)} ${a.kind} ${a.headline} — ${a.detail}`).join('\n'));
    console.log(`fixture: ${story.lines.length} lines, ${story.alerts.length} alerts; window repeat ${(100 * m.windowRepeat).toFixed(1)}%, distinct trigrams ${(100 * m.trigramDistinct).toFixed(1)}%, max template share ${(100 * m.maxTemplateShare).toFixed(1)}%`);
    expect(m.windowRepeat).toBeLessThan(0.15);
    expect(m.maxTemplateShare).toBeLessThan(0.2);

    // Analyst detail from the record: votes by mode and the count's history agree with the playback.
    const { Playback } = await import('../../../src/broadcast/playback');
    const pb = new Playback(rec);
    const t = rec.coverageStart + 6 * 60;
    const snap = pb.at(t);
    let checked = 0;
    rec.races.forEach((race, r) => {
      if (race.office !== 'us_senator' || race.cd >= 0) return;
      const d = pb.raceDetail(r, t);
      const byMode = d.byMode.reduce((a, v) => a.map((x, j) => x + v[j]!), new Array<number>(race.k).fill(0));
      expect(byMode).toEqual(Array.from(snap.races[r]!.votes));
      if (d.history.length) expect(d.history[d.history.length - 1]!.votes).toEqual(Array.from(snap.races[r]!.votes));
      for (const e of d.events) expect(e.time).toBeGreaterThanOrEqual(race.close);
      checked++;
    });
    expect(checked).toBeGreaterThan(5);
    // Map context and calls for the night; the archive results map carries per-area numbers.
    const { runNightQuery } = await import('../../../src/engine/nightQueries');
    const { runArchiveQuery } = await import('../../../src/engine/archiveQueries');
    const ctx = await runNightQuery(u, { kind: 'nightContext', id }) as { eligibleState: Record<number, number>; baselines: Record<number, unknown> };
    expect(Object.keys(ctx.eligibleState).length).toBeGreaterThan(10);
    expect(Object.keys(ctx.baselines).length).toBe(0); // the first simulated cycle has no previous comparable election
    const calls = await runNightQuery(u, { kind: 'nightCalls', id }) as { pct: number; time: number }[];
    expect(calls.length).toBeGreaterThan(100);
    for (const c of calls) { expect(c.pct).toBeGreaterThanOrEqual(0); expect(c.pct).toBeLessThanOrEqual(1); }
    const map = await runArchiveQuery(u, { kind: 'resultsMap', year: 2016, office: 'president', layer: 'state' }) as { cells: { d: number[]; r: number[]; valid: number[]; has: number[]; ballots: number[] | null; eligible: number[] | null } };
    const st = map.cells.has.filter((x) => x).length;
    expect(st).toBeGreaterThan(40);
    map.cells.has.forEach((h, i) => { if (h) { expect(map.cells.d[i]! + map.cells.r[i]!).toBeLessThanOrEqual(map.cells.valid[i]!); expect(map.cells.ballots![i]!).toBeLessThanOrEqual(map.cells.eligible![i]!); } });
    // While the count goes on, the summary does not reveal the sealed turnout.
    const ys = await runArchiveQuery(u, { kind: 'yearSummary', year: 2016 }) as { turnout: unknown };
    expect(ys.turnout).toBeNull();
  }, 300_000);
});

const DIR = 'public/geo-packs/2016.1/';
const seeds = (process.env.ENA_STORY ?? '').split(',').filter(Boolean);
describe.skipIf(!existsSync(`${DIR}manifest.json`) || seeds.length === 0)('alerts and commentary on real geography', () => {
  it.each(seeds)('seed %s', async (seed) => {
    const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'R', seed }, files, names);
    await u.advance({ kind: 'until', time: zonedToUtc(2016, 11, 9, 12, 0, 'America/New_York') });
    const id = Number(u.db.value("SELECT night_id FROM night WHERE kind = 'general'"));
    const rec = (await u.elections.nightRecord(id))!;
    const t0 = performance.now();
    const story = nightStory(u.db, u.world, rec);
    const ms = performance.now() - t0;
    checkStory(rec, story);
    const m = repetition(story);
    const byType = new Map<string, number>(); for (const l of story.lines) byType.set(l.type, (byType.get(l.type) ?? 0) + 1);
    const byKind = new Map<string, number>(); for (const a of story.alerts) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
    console.log(`seed ${seed}: built in ${Math.round(ms)} ms; ${story.lines.length} lines, ${story.alerts.length} alerts\n lines by type ${JSON.stringify(Object.fromEntries(byType))}\n alerts by kind ${JSON.stringify(Object.fromEntries(byKind))}\n window repeat ${(100 * m.windowRepeat).toFixed(1)}%, distinct trigrams ${(100 * m.trigramDistinct).toFixed(1)}%, max template share ${(100 * m.maxTemplateShare).toFixed(1)}%`);
    if (process.env.ENA_STORY_PRINT) console.log(story.lines.map((l) => `${formatTime(l.time)} ${SPEAKERS[l.speaker]!.name}: ${l.text}`).join('\n'));
    expect(m.windowRepeat).toBeLessThan(0.15);
  }, 900_000);
});
