// Step "blocklist": names of real politicians, used only to REJECT generated fictional names.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { GOVERNORS } from '../lib/governors.mjs';
import { CACHE, REPO, log, writeJson } from '../lib/util.mjs';

const DL = join(CACHE, 'dl', 'legislators');
export const normalizeName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/u, '').replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();

export async function run() {
  const names = new Set();
  const add = (s) => { if (s) { const n = normalizeName(s); if (n.split(' ').length >= 2) names.add(n); } };
  const addPerson = (p) => {
    const n = p.name ?? {};
    add(`${n.first} ${n.last}`);
    if (n.nickname) add(`${n.nickname} ${n.last}`);
    if (n.middle && /^[A-Z]\.$/.test(n.first ?? '')) add(`${n.middle} ${n.last}`); // "J. Danforth Quayle" → "danforth quayle"
    add(n.official_full);
  };
  let members = 0;
  for (const f of ['legislators-current.yaml', 'legislators-historical.yaml']) {
    for (const p of loadYaml(readFileSync(join(DL, f), 'utf8'))) {
      const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '9999-12-31'));
      if (!(p.terms ?? []).some((t) => iso(t.end) >= '1945-01-01')) continue;
      addPerson(p); members++;
    }
  }
  let execs = 0;
  for (const p of loadYaml(readFileSync(join(DL, 'executive.yaml'), 'utf8'))) { addPerson(p); execs++; }
  let govs = 0;
  for (const list of Object.values(GOVERNORS)) for (const g of list) { add(g); govs++; }
  writeJson(join(REPO, 'data', 'blocklist', 'politicians.json'), {
    source: 'unitedstates/congress-legislators (CC0): members of Congress serving 1945 or later, all presidents and vice presidents; plus a curated list of governors serving 1990–2026 and DC mayors (compiled from general knowledge, marked curated).',
    purpose: 'Rejection only: generated fictional names matching an entry are discarded.',
    generated: new Date().toISOString().slice(0, 10),
    counts: { congressMembers: members, executives: execs, curatedGovernorsAndMayors: govs },
    names: [...names].sort(),
  }, 0);
  log(`blocklist: ${names.size} names (${members} members, ${execs} executives, ${govs} curated)`);
}
