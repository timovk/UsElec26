/**
 * Decision-desk accuracy over many simulated election nights (docs/architecture/10 Phase 3 tests): wrong-call
 * rate, withdrawals, races still uncalled the morning after, and median call times by office.
 *   default: 10 nights on the fixture geography
 *   ENA_DESK_NIGHTS=N   N fixture nights
 *   ENA_DESK_REAL=N     N nights on the real Census geography (slow: ~12 s per night)
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { SEMANTIC_FILES } from '../../../src/geo/pack';
import { parseNameFile } from '../../../src/politicians/nameData';
import { generalElectionDay, zonedToUtc } from '../../../src/core/time';
import { ST_CALLED, ST_RUNOFF, ST_WITHDRAWN } from '../../../src/counting/types';

interface Stats { nights: number; calls: number; wrong: string[]; withdrawn: number; earlyEvents: number; races: number; uncalledMorning: Map<string, number>; callMinutes: Map<string, number[]>; pollClose: number; runoffs: number; wrongRunoffs: number }

async function measure(u: Universe, nights: number, label: string): Promise<Stats> {
  const day = generalElectionDay(2016);
  const st: Stats = { nights, calls: 0, wrong: [], withdrawn: 0, earlyEvents: 0, races: 0, uncalledMorning: new Map(), callMinutes: new Map(), pollClose: 0, runoffs: 0, wrongRunoffs: 0 };
  for (let v = 0; v < nights; v++) {
    const { rec, finals } = await u.elections.simulateNight(2016, day, `desk-${v}`);
    const last = new Map<number, { status: number; opt: number; opt2: number; t: number; pc: boolean }>();
    for (let i = 0; i < rec.events.time.length; i++) {
      const r = rec.events.race[i]!, t = rec.events.time[i]!, s = rec.events.status[i]!;
      if (t < rec.races[r]!.close) st.earlyEvents++;
      if (s === ST_WITHDRAWN) {
        st.withdrawn++;
        if (process.env.ENA_DESK_DEBUG && st.withdrawn <= 30) {
          const race = rec.races[r]!; const prev = last.get(r);
          const f = finals[r]!, valid = f.slice(0, race.k - 1).reduce((a, b) => a + b, 0), srt = [...f.slice(0, race.k - 1)].sort((a, b) => b - a);
          // counted share and margin at the time of withdrawal
          let cnt = 0; const cv = new Array<number>(race.k).fill(0);
          for (let q = 0; q < rec.raceRows.race.length; q++) { if (rec.raceRows.race[q] !== r || rec.batches.time[rec.raceRows.batch[q]!]! > t) continue; for (let j = 0; j < race.k; j++) { cv[j]! += rec.raceRows.votes[rec.raceRows.off[q]! + j]!; cnt += rec.raceRows.votes[rec.raceRows.off[q]! + j]!; } }
          const fb = f.reduce((a, b) => a + b, 0);
          const glitchNear = rec.batches.flag.some((fl, b) => fl === 1 && Math.abs(rec.batches.time[b]! - t) < 120);
          console.log(`WD ${race.label}: called ${prev ? prev.t - race.close : '?'} min after close (pc ${prev?.pc}), withdrawn ${t - race.close} min after, p=${(rec.events.prob[i]! / 100).toFixed(1)}%, counted ${(100 * cnt / fb).toFixed(0)}%, margin now ${(100 * (cv[prev?.opt ?? 0]! - Math.max(...cv.slice(0, race.k - 1).filter((_, j) => j !== (prev?.opt ?? 0)))) / Math.max(1, cv.slice(0, race.k - 1).reduce((a, b) => a + b, 0))).toFixed(1)}, final margin ${(100 * (srt[0]! - (srt[1] ?? 0)) / Math.max(1, valid)).toFixed(1)}, glitch nearby ${glitchNear}`);
        }
      }
      if (s === ST_CALLED || s === ST_RUNOFF) last.set(r, { status: s, opt: rec.events.option[i]!, opt2: rec.events.option2[i]!, t, pc: (rec.events.flags[i]! & 1) === 1 });
      else if (s === ST_WITHDRAWN) last.delete(r);
    }
    rec.races.forEach((race, r) => {
      st.races++;
      const f = finals[r]!, valid = f.slice(0, race.k - 1).reduce((a, b) => a + b, 0);
      const order = f.slice(0, race.k - 1).map((x, j) => [x, j] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const c = last.get(r);
      const office = race.office === 'president' && race.cd >= 0 ? 'president (district)' : race.office;
      if (!c || c.t > rec.nightEnd) st.uncalledMorning.set(office, (st.uncalledMorning.get(office) ?? 0) + 1);
      if (!c) return;
      if (c.status === ST_RUNOFF) {
        st.runoffs++;
        const top = order[0]![0] / Math.max(1, valid);
        if (top > 0.5 || new Set([order[0]![1], order[1]![1]]).size !== new Set([c.opt, c.opt2]).size || ![c.opt, c.opt2].includes(order[0]![1]) || ![c.opt, c.opt2].includes(order[1]![1])) st.wrongRunoffs++;
        return;
      }
      st.calls++; if (c.pc) st.pollClose++;
      const majorityFail = race.office !== 'president' && valid > 0 && order[0]![0] / valid <= 0.5 && /GA|LA/.test(race.label) && false;
      if (order[0]![1] !== c.opt || majorityFail) st.wrong.push(`${label} night ${v}: ${race.label} (called ${c.opt}, final leader ${order[0]![1]}, margin ${(100 * (order[0]![0] - (order[1]?.[0] ?? 0)) / Math.max(1, valid)).toFixed(2)} pts)`);
      const m = st.callMinutes.get(office) ?? []; m.push(c.t - race.close); st.callMinutes.set(office, m);
    });
  }
  return st;
}

function report(name: string, st: Stats): void {
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)]! : 0; };
  const pct = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]! : 0; };
  const lines = [`${name}: ${st.nights} nights, ${st.races} races, ${st.calls} projections (${st.pollClose} at poll closing), ${st.wrong.length} wrong (rate ${(st.wrong.length / Math.max(1, st.calls) * 500).toFixed(2)} per 500), ${st.withdrawn} withdrawn, ${st.runoffs} runoff projections (${st.wrongRunoffs} wrong), ${st.earlyEvents} desk events before poll closing`];
  for (const [o, m] of [...st.callMinutes].sort()) lines.push(`  ${o}: median call ${med(m)} min after the last polls close (90th pct ${pct(m, 0.9)} min); uncalled at 6 am: ${st.uncalledMorning.get(o) ?? 0} of ${Math.round(m.length + (st.uncalledMorning.get(o) ?? 0) - m.filter((x) => x === -1).length)}`);
  for (const w of st.wrong.slice(0, 10)) lines.push(`  WRONG ${w}`);
  console.log(lines.join('\n'));
}

describe('decision desk accuracy', () => {
  it('over simulated nights on the fixture geography', async () => {
    const sqlite3 = await initSqlite();
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Desk', seed: 'DESK-1' }, await packToFiles(makeFixturePack()), fixtureNames());
    await u.advance({ kind: 'until', time: zonedToUtc(2016, 11, 9, 0, 0, 'America/New_York') });
    const st = await measure(u, Number(process.env.ENA_DESK_NIGHTS ?? 10), 'fixture');
    report('fixture', st);
    expect(st.earlyEvents).toBe(0);
    expect(st.wrong.length / Math.max(1, st.calls)).toBeLessThan(1 / 500);
  }, 1_800_000);

  const DIR = 'public/geo-packs/2016.1/';
  it.skipIf(!existsSync(`${DIR}manifest.json`) || !process.env.ENA_DESK_REAL)('over simulated nights on the real geography', async () => {
    const sqlite3 = await initSqlite();
    const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Desk', seed: process.env.ENA_DESK_SEED ?? 'DESK-R1' }, files, names);
    await u.advance({ kind: 'until', time: zonedToUtc(2016, 11, 9, 0, 0, 'America/New_York') });
    const st = await measure(u, Number(process.env.ENA_DESK_REAL), 'real');
    report('real geography', st);
    expect(st.earlyEvents).toBe(0);
  }, 7_200_000);
});
