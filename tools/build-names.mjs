// Builds public/data/names-v1.json (runtime name data) from the Census-derived files in data/names and data/blocklist.
// Usage: node tools/build-names.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));
const sur = read('data/names/surnames.json'), male = read('data/names/given-male.json'), female = read('data/names/given-female.json');
const block = read('data/blocklist/politicians.json');
const r1 = (x) => Math.round(x * 10) / 10;
const out = {
  version: 1,
  source: 'U.S. Census Bureau: 2010 Census surnames (race/ethnicity shares), 1990 Census given names; blocklist from unitedstates/congress-legislators (CC0) and curated governors.',
  surnames: sur.names.slice(0, 12000).map((s) => [s.name, s.count, r1(s.pctwhite ?? 0), r1(s.pctblack ?? 0), r1(s.pcthispanic ?? 0), r1((s.pctapi ?? 0) + (s.pctaian ?? 0) + (s.pct2prace ?? 0))]),
  male: male.names.slice(0, 900).map((g) => [g.name, g.freq]),
  female: female.names.slice(0, 1500).map((g) => [g.name, g.freq]),
  blocklist: block.names,
};
writeFileSync(new URL('../public/data/names-v1.json', import.meta.url), JSON.stringify(out));
console.log(`names-v1.json: ${out.surnames.length} surnames, ${out.male.length} male, ${out.female.length} female, ${out.blocklist.length} blocked names`);
