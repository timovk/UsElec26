/**
 * Tooling (opt-in): build a real-geography universe and export it as a .ena file, for screenshots, visual
 * regression and benchmarks. ENA_MAKE=<out path> ENA_MAKE_SEED=<seed> ENA_MAKE_UNTIL=<ISO local ET, e.g. 2016-11-09T07:00>.
 */
import { describe, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SEMANTIC_FILES } from '../../../src/geo/pack';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { parseNameFile } from '../../../src/politicians/nameData';
import { zonedToUtc } from '../../../src/core/time';
import { encodeEna } from '../../../src/persistence/enaFile';
import { SCHEMA_VERSION } from '../../../src/persistence/schema';
import { ENGINE_VERSION } from '../../../src/engine/universe';

const DIR = 'public/geo-packs/2016.1/';
const out = process.env.ENA_MAKE;
describe.skipIf(!out || !existsSync(`${DIR}manifest.json`))('make a universe file', () => {
  it('builds and exports', async () => {
    const sqlite3 = await initSqlite();
    const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
    const seed = process.env.ENA_MAKE_SEED ?? 'BCAST-1';
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: `Broadcast ${seed}`, seed }, files, names);
    const [d, hm] = (process.env.ENA_MAKE_UNTIL ?? '2016-11-09T07:00').split('T');
    const [y, m, dd] = d!.split('-').map(Number); const [h, mi] = hm!.split(':').map(Number);
    (globalThis as unknown as { __seasonT: Record<string, number> }).__seasonT = {};
    const t0 = performance.now();
    await u.advance({ kind: 'until', time: zonedToUtc(y!, m!, dd!, h!, mi!, 'America/New_York') });
    console.log(`advanced in ${Math.round(performance.now() - t0)} ms; season ${JSON.stringify(Object.fromEntries(Object.entries((globalThis as unknown as { __seasonT: Record<string, number> }).__seasonT).map(([k, v]) => [k, Math.round(v)])))}`);
    writeFileSync(out!, await encodeEna(u.exportBytes(), SCHEMA_VERSION, ENGINE_VERSION));
    console.log(`wrote ${out}`);
  }, 1_800_000);
});
