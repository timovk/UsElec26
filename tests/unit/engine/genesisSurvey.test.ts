/** Survey of initial governments across seeds (real pack). Prints a table; asserts only broad plausibility. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SEMANTIC_FILES, loadGeoPack } from '../../../src/geo/pack';
import { genesis } from '../../../src/engine/genesis';
import { parseNameFile } from '../../../src/politicians/nameData';
import { leanMargin } from '../../../src/engine/world';

const DIR = 'public/geo-packs/2016.1/';
const have = existsSync(`${DIR}manifest.json`) && existsSync('public/data/names-v1.json') && !!process.env.ENA_SURVEY;

describe.skipIf(!have)('genesis survey', () => {
  it('initial governments track the electorate without systematic skew', async () => {
    const fs = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const pack = await loadGeoPack(async (f) => fs.get(f)!);
    const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
    const rows: string[] = [];
    let dSen = 0, n = 0;
    for (const seed of process.env.ENA_SURVEY!.split(',')) {
      const { world: w } = genesis({ seed, name: 's', pack, names });
      const nat = leanMargin({ dVotes: Float64Array.of(w.lean.national.d), votes: Float64Array.of(w.lean.national.t) }, 0);
      const sen = w.chambers.find((c) => c.kind === 'us_senate')!.composition.get(1) ?? 0;
      const house = w.chambers.find((c) => c.kind === 'us_house')!.composition.get(1) ?? 0;
      const gov = w.offices.filter((o) => o.kind === 'governor' && w.current.get(o.id)?.partyId === 1).length;
      const stateD = w.pack.states.filter((s) => s.usps !== 'DC' && leanMargin(w.lean.state, s.idx) > 0).length;
      const env = Object.values(w.history.env).map((x) => x.toFixed(1)).join(',');
      rows.push(`${seed}: lean ${nat.toFixed(1)} | states D ${stateD}/50 | Senate D ${sen} | House D ${house} | Gov D ${gov} | env ${env}`);
      dSen += sen; n++;
    }
    console.log(rows.join('\n'));
    expect(dSen / n).toBeGreaterThan(25); expect(dSen / n).toBeLessThan(75);
  }, 600_000);
});
