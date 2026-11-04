#!/usr/bin/env node
// Geography pipeline orchestrator. Usage: node tools/geo-pipeline/run.mjs [--only step[,step]] [--from step]
import { log } from './lib/util.mjs';

const STEPS = ['fetch', 'names', 'blocklist', 'blocks', 'acs', 'bu', 'geometry', 'pack', 'validate'];
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
let steps = only ?? (from ? STEPS.slice(STEPS.indexOf(from)) : STEPS);
const t0 = Date.now();
for (const name of steps) {
  if (!STEPS.includes(name)) throw new Error(`unknown step ${name}`);
  const t = Date.now(); log(`▶ ${name}`);
  const mod = await import(`./steps/${name}.mjs`);
  await mod.run();
  log(`✔ ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
log(`pipeline done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
