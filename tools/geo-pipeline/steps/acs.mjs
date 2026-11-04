// Step "acs": block-group (and tract) demographics from the ACS 2012–2016 5-year summary file, and
// citizen voting-age population from the 2012–2016 CVAP special tabulation.
// Output: .cache/work/acs/<fips>.json  { bg:{geoid:rec}, tract:{geoid:rec}, county:{geoid:rec} }
//         .cache/work/cvap.json        { bg:{geoid:cvap}, tract:{…}, county:{…} }
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { unzipTo } from '../lib/fetch.mjs';
import { execFileSync } from 'node:child_process';
import { ACS_SEQS, ACS_WHOLE_STATE } from '../lib/sources.mjs';
import { STATES } from '../lib/states.mjs';
import { CACHE, WORK, ensureDir, log, readJson, writeJson } from '../lib/util.mjs';

const DL = join(CACHE, 'dl');
const X = join(CACHE, 'x');

/** Start index (0-based CSV column) and cell count of each table, from the official lookup file. */
function tableLayout() {
  const lines = readFileSync(join(DL, 'acs', 'ACS_5yr_Seq_Table_Number_Lookup.txt'), 'latin1').split(/\r?\n/);
  const out = {};
  for (const l of lines) {
    const f = l.split(',');
    if (f[1] in ACS_SEQS && f[4] && /CELLS?/.test(f[5])) out[f[1]] = { seq: f[2], start: Number(f[4]) - 1, cells: parseInt(f[5], 10) };
  }
  for (const t of Object.keys(ACS_SEQS)) if (!out[t]) throw new Error(`table ${t} not in lookup`);
  return out;
}

/** Minimal CSV splitter supporting double-quoted fields. */
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s) => (s === undefined || s === '' || s === '.' ? NaN : Number(s));

function emptyRec() { return { tot: 0, a18_29: 0, a30_44: 0, a45_64: 0, a65p: 0, male18: 0, pop25: 0, coll25: 0, medInc: NaN }; }

// B01001 cell numbers (1-based within the table).
const MALE = { a18_29: [7, 8, 9, 10, 11], a30_44: [12, 13, 14], a45_64: [15, 16, 17, 18, 19], a65p: [20, 21, 22, 23, 24, 25] };
const FEMALE_OFFSET = 24; // female cells = male cells + 24

function readSeq(path, start, cells) {
  const m = new Map();
  for (const l of readFileSync(path, 'latin1').split(/\r?\n/)) {
    if (!l) continue;
    const f = l.split(',');
    m.set(f[5], f.slice(start, start + cells));
  }
  return m;
}

async function stateAcs(st, layout) {
  const ab = st.usps.toLowerCase();
  const xdir = ensureDir(join(X, 'acs', st.usps));
  for (const seq of Object.values(ACS_SEQS)) {
    const e = join(xdir, `e20165${ab}${seq}000.txt`);
    if (existsSync(e)) continue;
    if (ACS_WHOLE_STATE.has(`${st.usps}:${seq}`)) {
      // extract only the needed estimate file from the whole-state archive
      execFileSync('unzip', ['-o', '-q', '-j', join(DL, 'acs', st.usps, `${st.acsDir}_Tracts_Block_Groups_Only.zip`), `e20165${ab}${seq}000.txt`, '-d', xdir]);
    } else unzipTo(join(DL, 'acs', st.usps, `20165${ab}${seq}000.zip`), xdir);
  }
  // LOGRECNO → GEOID for tracts (140) and block groups (150)
  const geo = new Map();
  for (const l of readFileSync(join(DL, 'acs', st.usps, `g20165${ab}.csv`), 'latin1').split(/\r?\n/)) {
    if (!l) continue;
    const f = l.split(',');
    if ((f[2] === '140' || f[2] === '150') && f[3] === '00') geo.set(f[4], { lvl: f[2], geoid: f[48].slice(7) });
  }
  const s1 = readSeq(join(xdir, `e20165${ab}${layout.B01001.seq}000.txt`), layout.B01001.start, layout.B01001.cells);
  const s2 = readSeq(join(xdir, `e20165${ab}${layout.B15003.seq}000.txt`), layout.B15003.start, layout.B15003.cells);
  const s3 = readSeq(join(xdir, `e20165${ab}${layout.B19013.seq}000.txt`), layout.B19013.start, layout.B19013.cells);
  const bg = {}, tract = {}, county = {};
  for (const [lr, g] of geo) {
    const a = s1.get(lr), b = s2.get(lr), c = s3.get(lr);
    if (!a) continue;
    const r = emptyRec();
    const cell = (arr, n) => num(arr[n - 1]);
    for (const [band, cellsM] of Object.entries(MALE)) {
      let m = 0, w = 0;
      for (const n of cellsM) { m += cell(a, n); w += cell(a, n + FEMALE_OFFSET); }
      r[band] = m + w; r.male18 += m;
    }
    r.tot = r.a18_29 + r.a30_44 + r.a45_64 + r.a65p;
    if (b) { r.pop25 = cell(b, 1); r.coll25 = cell(b, 22) + cell(b, 23) + cell(b, 24) + cell(b, 25); }
    if (c) r.medInc = cell(c, 1);
    if (g.lvl === '150') bg[g.geoid] = r;
    else {
      tract[g.geoid] = r;
      const cg = g.geoid.slice(0, 5);
      const cr = (county[cg] ??= { ...emptyRec(), incW: 0, incSum: 0 });
      for (const k of ['tot', 'a18_29', 'a30_44', 'a45_64', 'a65p', 'male18', 'pop25', 'coll25']) cr[k] += Number.isFinite(r[k]) ? r[k] : 0;
      if (Number.isFinite(r.medInc) && r.tot > 0) { cr.incSum += r.medInc * r.tot; cr.incW += r.tot; }
    }
  }
  // County median income approximated by the adult-population-weighted mean of tract medians
  // (only used to impute suppressed block-group/tract values; flagged).
  for (const cr of Object.values(county)) { cr.medInc = cr.incW > 0 ? cr.incSum / cr.incW : NaN; delete cr.incW; delete cr.incSum; }
  return { bg, tract, county };
}

async function cvap() {
  const dest = join(WORK, 'cvap.json');
  if (existsSync(dest)) return;
  const xdir = join(X, 'cvap');
  if (!existsSync(join(xdir, 'BlockGr.csv'))) unzipTo(join(DL, 'cvap', 'CVAP_2012-2016_ACS_csv_files.zip'), xdir);
  const out = {};
  for (const [lvl, file, prefix] of [['bg', 'BlockGr.csv', '15000US'], ['tract', 'Tract.csv', '14000US'], ['county', 'County.csv', '05000US']]) {
    const m = (out[lvl] = {});
    const rl = createInterface({ input: createReadStream(join(xdir, file), { encoding: 'latin1' }), crlfDelay: Infinity });
    let cols = null;
    for await (const l of rl) {
      const f = splitCsv(l);
      if (!cols) { cols = Object.fromEntries(f.map((n, i) => [n.toUpperCase(), i])); continue; }
      if (f[cols.LNNUMBER] !== '1') continue;
      const g = f[cols.GEOID];
      if (g?.startsWith(prefix)) m[g.slice(7)] = Number(f[cols.CVAP_EST]);
    }
    log(`cvap ${lvl}: ${Object.keys(m).length}`);
  }
  writeJson(dest, out);
}

export async function run() {
  const layout = tableLayout();
  log(`ACS layout ${JSON.stringify(layout)}`);
  const out = ensureDir(join(WORK, 'acs'));
  for (const st of STATES) {
    const dest = join(out, `${st.fips}.json`);
    if (existsSync(dest) && !process.env.GEO_FORCE) continue;
    const r = await stateAcs(st, layout);
    writeJson(dest, r);
    log(`${st.usps}: ACS ${Object.keys(r.bg).length} BGs, ${Object.keys(r.tract).length} tracts`);
  }
  await cvap();
}

export const loadAcs = (fips) => readJson(join(WORK, 'acs', `${fips}.json`));
