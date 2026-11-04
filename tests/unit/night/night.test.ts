/** The election-night pipeline for one state on the fixture geography: count plan, partition, observers. */
import { describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { buildPopulation } from '../../../src/population/population';
import { generateElectorate } from '../../../src/electorate/model';
import type { KernelContest, KernelOption } from '../../../src/electorate/kernel';
import { buildShard, stateRanges } from '../../../src/electorate/shards';
import { drawEnvironment, calibrateTurnout } from '../../../src/electorate/environment';
import { buildParts } from '../../../src/counting/precincts';
import { runJob, type JobInput } from '../../../src/engine/nightJob';
import { buildNightInput, nightRaces } from '../../../src/engine/nightSetup';
import { ST_CALLED } from '../../../src/counting/types';
import { generalElectionDay, zonedToUtc } from '../../../src/core/time';

const pack = makeFixturePack();
const pop = buildPopulation(pack);
const e = generateElectorate('night', pack, pop, 3);
const ranges = stateRanges(pack);
const env = drawEnvironment('night', 2016, pack, null, { presParty: 1, termsHeld: 2, midterm: false });
const { tauE } = calibrateTurnout('night', e, pop);
const opt = (partySign: number, base = 0): KernelOption => ({ partySign, base, classFit: [0, 0, 0, 0], minorAppeal: partySign === 0 ? 0.55 : 0, homeCounty: -1, homeState: false });
const day = generalElectionDay(2016);

function job(usps: string, swap = false, key = 'g2016') {
  const s = pack.states.findIndex((x) => x.usps === usps);
  const cds = pack.cds.filter((c) => c.stateIdx === s);
  const two = (a: KernelOption, b: KernelOption) => (swap ? [b, a] : [a, b]);
  const contests: KernelContest[] = [
    { id: 1, cd: -1, weight: 1, abstain: -4.6, options: [...two(opt(0.5), opt(-0.5)), opt(0, -2.0)] },
    { id: 2, cd: -1, weight: 0.95, abstain: -3.4, options: two(opt(0.5, 0.15), opt(-0.5)) },
    ...cds.map((cd, i) => ({ id: 10 + i, cd: cd.idx, weight: 0.9, abstain: -3.0, options: two(opt(0.5), opt(-0.5, 0.2)) })),
  ];
  const ctx = { seed: 'night', electionKey: key, pack, pop, electorate: e, env, tauE, ranges };
  const inp = buildShard(ctx, s, 'general', 0, contests, 0.5);
  const parts = buildParts(inp.bus.rj, inp.bus.cd);
  inp.parts = { of: parts.of, count: parts.count };
  const parties = (n: number) => (swap ? [2, 1, 3] : [1, 2, 3]).slice(0, n);
  const races = nightRaces(pack, s, contests.map((c, i) => ({ contestIndex: i, office: i === 0 ? 'president' : i === 1 ? 'us_senator' : 'us_representative', method: 'plurality', parties: parties(c.options.length), districtEv: usps === 'ME' && i === 0 })));
  const night = buildNightInput({ seed: 'night', key, pack, rg: ranges[s]!, stateIdx: s, day, year: 2016, coverageStart: zonedToUtc(2016, 11, 8, 17, 0, 'America/New_York'), races, national: 0.01, expectedBallots: 1e6 });
  const ji: JobInput = { ...inp, night, stateIdx: s };
  return { s, contests, races, night, out: runJob(ji) };
}

describe('election night (one state)', () => {
  const pa = job('PA');
  const n = pa.out.night!;

  it('batches partition every race exactly: counted + rejected = cast', () => {
    n.races.forEach((race, ri) => {
      const c = pa.out.contests.find((x) => x.id === race.contestId)!; const K = race.k;
      const cast = new Array<number>(K).fill(0);
      for (let u = 0; u < c.units.length; u++) for (let k = 0; k < K; k++) cast[k]! += c.votes[u * K + k]!;
      const counted = new Array<number>(K).fill(0);
      let row = 0, off = 0;
      for (let i = 0; i < n.raceRows.race.length; i++) { const k2 = n.races[n.raceRows.race[i]!]!.k; if (n.raceRows.race[i] === ri) for (let k = 0; k < K; k++) counted[k]! += n.raceRows.votes[off + k]!; off += k2; row++; }
      void row;
      for (let k = 0; k < K; k++) expect(counted[k]! + n.rejected[ri]![k]!).toBe(cast[k]!);
      expect(n.rejected[ri]!.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    });
  });

  it('cumulative counts never exceed the final count, and nothing is reported before its polls close', () => {
    const K0 = n.races[0]!.k;
    const fin = new Array<number>(K0).fill(0), cum = new Array<number>(K0).fill(0);
    let off = 0; const offs: number[] = [];
    for (let i = 0; i < n.raceRows.race.length; i++) { offs.push(off); off += n.races[n.raceRows.race[i]!]!.k; }
    for (let i = 0; i < n.raceRows.race.length; i++) if (n.raceRows.race[i] === 0) for (let k = 0; k < K0; k++) fin[k]! += n.raceRows.votes[offs[i]! + k]!;
    for (let i = 0; i < n.raceRows.race.length; i++) {
      if (n.raceRows.race[i] !== 0) continue;
      for (let k = 0; k < K0; k++) { cum[k]! += n.raceRows.votes[offs[i]! + k]!; expect(cum[k]!).toBeLessThanOrEqual(fin[k]!); expect(cum[k]!).toBeGreaterThanOrEqual(0); }
    }
    for (let b = 1; b < n.batches.time.length; b++) expect(n.batches.time[b]!).toBeGreaterThanOrEqual(n.batches.time[b - 1]!);
    expect(n.batches.time[0]!).toBeGreaterThanOrEqual(n.closeFirst);
  });

  it('no projection before the last polls in the race close', () => {
    for (let i = 0; i < n.events.time.length; i++) {
      const race = n.races[n.events.race[i]!]!;
      const close = Math.max(...Array.from(race.parts, (p) => n.parts.close[p]!));
      expect(n.events.time[i]!).toBeGreaterThanOrEqual(close);
    }
    const calls = Array.from(n.events.status).filter((x) => x === ST_CALLED).length;
    console.log(`PA fixture: ${n.batches.time.length} batches, ${n.raceRows.race.length} race rows, ${n.events.time.length} desk events, ${calls} projections of ${n.races.length} races; survey n=${n.survey[0]?.n}`);
    expect(calls).toBeGreaterThan(0);
  });

  it('the count schedule does not depend on who the votes are for (candidates swapped → same schedule)', () => {
    const sw = job('PA', true);
    expect(Array.from(sw.out.night!.batches.time)).toEqual(Array.from(n.batches.time));
    expect(Array.from(sw.out.night!.batches.rj)).toEqual(Array.from(n.batches.rj));
    expect(Array.from(sw.out.night!.partRows.ballots)).toEqual(Array.from(n.partRows.ballots));
    expect(Array.from(sw.out.night!.partRows.precincts)).toEqual(Array.from(n.partRows.precincts));
  });

  it('is deterministic', () => {
    const again = job('PA');
    expect(Array.from(again.out.night!.raceRows.votes)).toEqual(Array.from(n.raceRows.votes));
    expect(Array.from(again.out.night!.events.time)).toEqual(Array.from(n.events.time));
  });
});
