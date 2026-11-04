/** Election night on the real geography for a few states: timing realism and desk behaviour (opt-in: ENA_NIGHT=1). */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SEMANTIC_FILES, loadGeoPack } from '../../../src/geo/pack';
import { buildPopulation } from '../../../src/population/population';
import { generateElectorate } from '../../../src/electorate/model';
import type { KernelContest, KernelOption } from '../../../src/electorate/kernel';
import { buildShard, stateRanges } from '../../../src/electorate/shards';
import { calibrateTurnout, drawEnvironment } from '../../../src/electorate/environment';
import { buildParts } from '../../../src/counting/precincts';
import { runJob } from '../../../src/engine/nightJob';
import { buildNightInput, nightRaces } from '../../../src/engine/nightSetup';
import { STATUS_NAME } from '../../../src/counting/types';
import { formatTime, generalElectionDay, zonedToUtc } from '../../../src/core/time';

const DIR = 'public/geo-packs/2016.1/';
describe.skipIf(!existsSync(`${DIR}manifest.json`) || !process.env.ENA_NIGHT)('election night on real geography', () => {
  it('produces a plausible night in several states', async () => {
    const fs = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const pack = await loadGeoPack(async (f) => fs.get(f)!);
    const pop = buildPopulation(pack);
    const seed = process.env.ENA_NIGHT_SEED ?? 'NR-1';
    const e = generateElectorate(seed, pack, pop);
    const ranges = stateRanges(pack);
    const env = drawEnvironment(seed, 2016, pack, null, { presParty: 1, termsHeld: 2, midterm: false });
    const { tauE } = calibrateTurnout(seed, e, pop);
    const opt = (partySign: number, base = 0): KernelOption => ({ partySign, base, classFit: [0, 0, 0, 0], minorAppeal: partySign === 0 ? 0.55 : 0, homeCounty: -1, homeState: false });
    const day = generalElectionDay(2016);
    const ET = 'America/New_York';
    for (const usps of (process.env.ENA_NIGHT_STATES ?? 'PA,FL,CA,GA,AZ,KY,ME').split(',')) {
      const s = pack.states.findIndex((x) => x.usps === usps);
      const cds = pack.cds.filter((c) => c.stateIdx === s);
      const contests: KernelContest[] = [
        { id: 1, cd: -1, weight: 1, abstain: -4.2, options: [opt(0.5), opt(-0.5), opt(0, -2.3)] },
        { id: 2, cd: -1, weight: 0.95, abstain: -3.5, options: [opt(0.5, 0.05), opt(-0.5)] },
        ...cds.map((cd, i) => ({ id: 10 + i, cd: cd.idx, weight: 0.9, abstain: -3.0, options: [opt(0.5, i % 3 === 0 ? 0.3 : 0), opt(-0.5)] })),
      ];
      const ctx = { seed, electionKey: 'g2016', pack, pop, electorate: e, env, tauE, ranges };
      const inp = buildShard(ctx, s, 'general', 0, contests, 0.5);
      const parts = buildParts(inp.bus.rj, inp.bus.cd); inp.parts = { of: parts.of, count: parts.count };
      const races = nightRaces(pack, s, contests.map((c, i) => ({ contestIndex: i, office: i === 0 ? 'president' : i === 1 ? 'us_senator' : 'us_representative', method: usps === 'GA' && i === 1 ? 'majority' : 'plurality', parties: [1, 2, 3].slice(0, c.options.length), districtEv: (usps === 'ME' || usps === 'NE') && i === 0 })));
      const night = buildNightInput({ seed, key: 'g2016', pack, rg: ranges[s]!, stateIdx: s, day, year: 2016, coverageStart: zonedToUtc(2016, 11, 8, 17, 0, ET), races, national: 0.01, expectedBallots: 3e6 });
      if (process.env.ENA_NIGHT_TRACE === usps || process.env.ENA_NIGHT_TRACE === 'all') night.trace = 999;
      const t0 = performance.now();
      const out = runJob({ ...inp, night, stateIdx: s });
      const ms = performance.now() - t0;
      const n = out.night!;
      // Presidential race: share of the final count over time (ET).
      const K = n.races[0]!.k; let off = 0; const offs: number[] = [];
      for (let i = 0; i < n.raceRows.race.length; i++) { offs.push(off); off += n.races[n.raceRows.race[i]!]!.k; }
      let fin = 0; for (let i = 0; i < n.raceRows.race.length; i++) if (n.raceRows.race[i] === 0) for (let k = 0; k < K; k++) fin += n.raceRows.votes[offs[i]! + k]!;
      const marks = [20, 21, 22, 23, 24, 26, 30, 36, 48, 24 * 4, 24 * 10, 24 * 40].map((h) => zonedToUtc(2016, 11, 8, 0, 0, ET) + h * 60);
      const cum = marks.map((t) => { let c = 0, d = 0, r = 0; for (let i = 0; i < n.raceRows.race.length; i++) { if (n.raceRows.race[i] !== 0 || n.batches.time[n.raceRows.batch[i]!]! > t) continue; for (let k = 0; k < K; k++) c += n.raceRows.votes[offs[i]! + k]!; d += n.raceRows.votes[offs[i]!]!; r += n.raceRows.votes[offs[i]! + 1]!; } return `${(100 * c / fin).toFixed(0)}%(D${(c ? 100 * (d - r) / c : 0).toFixed(1)})`; });
      const evs = Array.from(n.events.time, (t, i) => ({ t, i })).filter((x) => n.events.race[x.i]! < 2 || n.races[n.events.race[x.i]!]!.cd >= 0 && n.events.race[x.i]! < 6);
      console.log(`${usps}: ${ms.toFixed(0)} ms, ${n.batches.time.length} batches, precincts ${Array.from(n.parts.precincts).reduce((a, b) => a + b, 0)}, survey n ${n.survey[0]?.n}\n  pres counted by 8p/9p/10p/11p/12a/2a/6a/12p(+1)/12a(+2)/+4d/+10d/+40d ET: ${cum.join(' ')}\n  ` +
        evs.map(({ t, i }) => `[race ${n.events.race[i]}] ${formatTime(t, ET)}${t > zonedToUtc(2016, 11, 9, 6, 0, ET) ? ` (+${Math.floor((t - zonedToUtc(2016, 11, 8, 0, 0, ET)) / 1440)}d)` : ''} ${STATUS_NAME[n.events.status[i]!]} ${n.events.option[i]} p=${(n.events.prob[i]! / 100).toFixed(1)}%`).join('\n  '));
      const calls = Array.from(n.events.status).filter((x) => x === 3).length;
      console.log(`  calls ${calls}/${n.races.length}`);
      expect(n.batches.time.length).toBeGreaterThan(0);
    }
  }, 600_000);
});
