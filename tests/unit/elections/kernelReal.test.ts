import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SEMANTIC_FILES, loadGeoPack } from '../../../src/geo/pack';
import { buildPopulation } from '../../../src/population/population';
import { generateElectorate } from '../../../src/electorate/model';
import { runShard, type KernelContest, type KernelOption } from '../../../src/electorate/kernel';
import { buildShard, stateRanges } from '../../../src/electorate/shards';
import { calibrateTurnout, drawEnvironment } from '../../../src/electorate/environment';

const DIR = 'public/geo-packs/2016.1/';
describe.skipIf(!existsSync(`${DIR}manifest.json`) || !process.env.ENA_KBENCH)('kernel at national scale', () => {
  it('runs a national general election', async () => {
    const fs = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const pack = await loadGeoPack(async (f) => fs.get(f)!);
    const pop = buildPopulation(pack);
    const e = generateElectorate('KB', pack, pop);
    const t0 = performance.now();
    const cal = calibrateTurnout('KB', e, pop);
    const t1 = performance.now();
    const env = drawEnvironment('KB', 2016, pack, null, { presParty: 1, termsHeld: 2, midterm: false });
    const ranges = stateRanges(pack);
    const opt = (s: number, base = 0): KernelOption => ({ partySign: s, base, classFit: [0, 0, 0, 0], minorAppeal: s === 0 ? 0.55 : 0, homeCounty: -1, homeState: false });
    let ballots = 0, eligible = 0, build = 0, run = 0, D = 0, R = 0;
    for (const st of pack.states) {
      const contests: KernelContest[] = [{ id: 1, cd: -1, weight: 1, abstain: -4.6, options: [opt(0.5), opt(-0.5), opt(0, -2.1), opt(0, -2.9)] },
        { id: 2, cd: -1, weight: 0.95, abstain: -3.4, options: [opt(0.5), opt(-0.5), opt(0, -2.3)] },
        ...pack.cds.filter((c) => c.stateIdx === st.idx).map((c) => ({ id: 100 + c.idx, cd: c.idx, weight: 0.9, abstain: -3, options: [opt(0.5), opt(-0.5)] }))];
      const a = performance.now(); const inp = buildShard({ seed: 'KB', electionKey: 'g', pack, pop, electorate: e, env, tauE: cal.tauE, ranges }, st.idx, 'general', 0, contests, 0.3);
      const b = performance.now(); const out = runShard(inp); const c = performance.now();
      build += b - a; run += c - b;
      for (const x of out.ballots) ballots += x; for (const x of out.eligible) eligible += x;
      const p = out.contests[0]!; for (let u = 0; u < p.units.length; u++) { D += p.votes[u * 5]!; R += p.votes[u * 5 + 1]!; }
    }
    console.log(`turnout calibration ${Math.round(t1 - t0)} ms (target ${cal.target.toFixed(3)} achieved ${cal.achieved.toFixed(3)}); shards build ${Math.round(build)} ms, kernel ${Math.round(run)} ms; turnout ${(ballots / eligible).toFixed(3)}; ballots ${ballots}; pres D2 ${(D / (D + R)).toFixed(3)}`);
    expect(ballots / eligible).toBeGreaterThan(0.45);
  }, 600_000);
});
