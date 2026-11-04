// Step "names": name-frequency seed data for the politician generator.
//  - data/names/surnames.json      top 20,000 surnames from the 2010 Census surname file, with race shares
//  - data/names/given-male.json    1990 Census male first names with frequency (%)
//  - data/names/given-female.json  1990 Census female first names with frequency (%)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipTo } from '../lib/fetch.mjs';
import { CACHE, REPO, log, writeJson } from '../lib/util.mjs';

const DL = join(CACHE, 'dl', 'names');
const OUT = join(REPO, 'data', 'names');
const TOP_SURNAMES = 20000;

// The Census files strip apostrophes and spaces and use upper case. Restore well-known forms only;
// never guess (e.g. "MACK", "MACIAS" must stay as they are).
const APOSTROPHE = new Set(['OBRIEN', 'OCONNOR', 'ONEILL', 'OCONNELL', 'ODONNELL', 'OREILLY', 'OROURKE', 'OHARA', 'OLEARY',
  'OMALLEY', 'OSULLIVAN', 'ONEAL', 'OKEEFE', 'OSHEA', 'OGRADY', 'ODOWD', 'OBANNON', 'OTOOLE', 'OCALLAGHAN', 'OFARRELL',
  'OGORMAN', 'OKANE', 'OLOUGHLIN', 'OMEARA', 'OHEARN', 'OBRYANT', 'ODONOGHUE', 'OHAIR', 'OHERN', 'OKELLEY', 'OMARA', 'ONEILL',
  'OQUINN', 'OSHAUGHNESSY', 'OBOYLE', 'OCONNER', 'ODANIEL', 'ODAY', 'ODEA', 'ODOM' /* Odom is not O'Dom — removed below */]);
APOSTROPHE.delete('ODOM');
const MAC = new Set(['MACDONALD', 'MACKENZIE', 'MACLEAN', 'MACARTHUR', 'MACMILLAN', 'MACKAY', 'MACINTOSH', 'MACLEOD',
  'MACGREGOR', 'MACKINNON', 'MACNEIL', 'MACPHERSON', 'MACDOUGALL', 'MACFARLANE', 'MACAULAY', 'MACNEILL', 'MACLELLAN',
  'MACCALLUM', 'MACINNIS', 'MACLAREN', 'MACRAE', 'MACKINNEY', 'MACDONELL', 'MACQUEEN', 'MACISAAC', 'MACEWEN', 'MACGILLIVRAY']);

export function titleCase(raw) {
  const u = raw.toUpperCase();
  const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  if (APOSTROPHE.has(u)) return `O'${cap(u.slice(1))}`;
  if (u.startsWith('MC') && u.length > 3) return `Mc${cap(u.slice(2))}`;
  if (MAC.has(u)) return `Mac${cap(u.slice(3))}`;
  return cap(u);
}

const pct = (s) => (s === '(S)' || s === '' ? null : Number(s));

export async function run() {
  const xdir = join(CACHE, 'x', 'surnames');
  if (!existsSync(join(xdir, 'Names_2010Census.csv'))) unzipTo(join(DL, 'names.zip'), xdir);
  const lines = readFileSync(join(xdir, 'Names_2010Census.csv'), 'latin1').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const col = (n) => header.indexOf(n);
  const rows = [];
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    if (f[col('name')] === 'ALL OTHER NAMES') continue;
    rows.push({
      name: titleCase(f[col('name')]), rank: Number(f[col('rank')]), count: Number(f[col('count')]),
      pctwhite: pct(f[col('pctwhite')]), pctblack: pct(f[col('pctblack')]), pctapi: pct(f[col('pctapi')]),
      pctaian: pct(f[col('pctaian')]), pct2prace: pct(f[col('pct2prace')]), pcthispanic: pct(f[col('pcthispanic')]),
    });
  }
  rows.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  writeJson(join(OUT, 'surnames.json'), {
    source: 'U.S. Census Bureau, 2010 Census surname file (Names_2010Census.csv); public domain',
    note: 'Top 20,000 surnames by count. pct* are percentages of bearers by race/ethnicity; null = suppressed (S).',
    names: rows.slice(0, TOP_SURNAMES),
  });
  for (const [sex, file] of [['male', 'dist.male.first'], ['female', 'dist.female.first']]) {
    const out = [];
    for (const l of readFileSync(join(DL, file), 'latin1').split(/\r?\n/)) {
      const m = /^(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)/.exec(l);
      if (m) out.push({ name: titleCase(m[1]), freq: Number(m[2]), rank: Number(m[4]) });
    }
    writeJson(join(OUT, `given-${sex}.json`), {
      source: `U.S. Census Bureau, 1990 Census name files (${file}); public domain`,
      note: 'freq = percent of the 1990 population of that sex with this first name.',
      names: out,
    });
    log(`given ${sex}: ${out.length}`);
  }
  log(`surnames: ${Math.min(rows.length, TOP_SURNAMES)} of ${rows.length}`);
}
