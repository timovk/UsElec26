import { fetchSource } from '../lib/fetch.mjs';
import { allSources } from '../lib/sources.mjs';
import { log } from '../lib/util.mjs';

export async function run() {
  const all = allSources();
  let i = 0;
  for (const s of all) { i++; await fetchSource(s); if (i % 20 === 0) log(`fetched ${i}/${all.length}`); }
  log(`fetch complete: ${all.length} sources`);
}
