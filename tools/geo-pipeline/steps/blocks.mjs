// Step "blocks": parse 2010 PL 94-171 blocks for each state, attach 2016 district assignments from the
// official Census block equivalency files, and aggregate blocks into raw Base Units.
// Output: .cache/work/bu-raw/<fips>.json  (BU rows, block-level statistics for validation)
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { unzipTo } from '../lib/fetch.mjs';
import { projectPoint } from '../lib/projection.mjs';
import { COUNTY_RECODE, NEW_ENGLAND, STATES } from '../lib/states.mjs';
import { CACHE, WORK, ensureDir, log, writeJson } from '../lib/util.mjs';

const DL = join(CACHE, 'dl');
const X = join(CACHE, 'x');

/** Split national BEF files into per-state files (cached). */
async function splitBefs() {
  const out = ensureDir(join(WORK, 'bef'));
  if (existsSync(join(out, 'done'))) return out;
  const files = {
    cd: ['bef-cd115', 'cd115.zip', 'cd115', 'National_CD115.txt'],
    sldu: ['bef-sldu2016', 'sldu_2016.zip', 'sldu_2016', 'National_2016SLDU.txt'],
    sldl: ['bef-sldl2016', 'sldl_2016.zip', 'sldl_2016', 'National_2016SLDL.txt'],
  };
  for (const [kind, [, zip, dir, name]] of Object.entries(files)) {
    const xdir = join(X, 'bef', dir);
    if (!existsSync(join(xdir, name))) unzipTo(join(DL, 'bef', zip), xdir);
    const byState = new Map();
    const rl = createInterface({ input: createReadStream(join(xdir, name)), crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
      if (first) { first = false; continue; }
      if (!line) continue;
      const st = line.slice(0, 2);
      let arr = byState.get(st); if (!arr) byState.set(st, (arr = []));
      arr.push(line);
    }
    for (const [st, lines] of byState) writeFileSync(join(out, `${kind}-${st}.csv`), lines.join('\n') + '\n');
    log(`split ${kind}: ${byState.size} states`);
  }
  writeFileSync(join(out, 'done'), '');
  return out;
}

function loadBef(dir, kind, fips) {
  const m = new Map();
  const p = join(dir, `${kind}-${fips}.csv`);
  if (!existsSync(p)) return m;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.indexOf(',');
    const rest = line.slice(c + 1);
    const c2 = rest.indexOf(',');
    m.set(line.slice(0, c), (c2 < 0 ? rest : rest.slice(0, c2)).trim());
  }
  return m;
}

async function* lines(path, encoding) {
  const rl = createInterface({ input: createReadStream(path, { encoding }), crlfDelay: Infinity });
  for await (const l of rl) if (l) yield l;
}

export async function processState(st, befDir) {
  const ab = st.usps.toLowerCase();
  const xdir = join(X, 'pl94', ab);
  if (!existsSync(join(xdir, `${ab}geo2010.pl`))) unzipTo(join(DL, 'pl94', `${ab}2010.pl.zip`), xdir);
  const cdMap = loadBef(befDir, 'cd', st.fips);
  const slduMap = st.fips === '11' ? new Map() : loadBef(befDir, 'sldu', st.fips);
  const sldlMap = loadBef(befDir, 'sldl', st.fips);
  const geo = lines(join(xdir, `${ab}geo2010.pl`), 'latin1');
  const f1 = lines(join(xdir, `${ab}000012010.pl`), 'latin1');
  const f2 = lines(join(xdir, `${ab}000022010.pl`), 'latin1');

  const bus = new Map(); // key -> BU accumulator
  const stats = { blocks: 0, pop: 0, vap: 0, p1MismatchPop100: 0, missingCd: 0, missingSldu: 0, missingSldl: 0,
    zzCd: 0, zzSldu: 0, zzSldl: 0, zzPop: 0, recoded: {}, county: {}, vtd: {} };
  const unresolved = []; // blocks with ZZ/missing assignments, resolved after the pass
  const NE = NEW_ENGLAND.has(st.fips);
  while (true) {
    const g = await geo.next(); if (g.done) break;
    const a = await f1.next(), b = await f2.next();
    const G = g.value, A = a.value.split(','), Bv = b.value.split(',');
    const logrec = G.slice(18, 25);
    if (A[4] !== logrec || Bv[4] !== logrec) throw new Error(`${st.usps}: LOGRECNO misalignment at ${logrec}`);
    if (G.slice(8, 11) !== '750') continue;
    const county10 = G.slice(27, 32);
    const county = COUNTY_RECODE.get(county10) ?? county10;
    if (county !== county10) stats.recoded[county10] = (stats.recoded[county10] ?? 0) + 1;
    const tract = G.slice(54, 60), bg = G.slice(60, 61), block = G.slice(61, 65);
    const blockId = county10 + tract + block;
    const cousub = G.slice(36, 41), vtd = G.slice(161, 167).trim();
    const land = Number(G.slice(198, 212));
    const pop100 = Number(G.slice(318, 327));
    const lat = Number(G.slice(336, 347)), lon = Number(G.slice(347, 359));
    const pop = Number(A[5]), vap = Number(Bv[5]);
    const vapHisp = Number(Bv[77]), vapWhiteNH = Number(Bv[80]), vapBlackNH = Number(Bv[81]);
    if (pop !== pop100) stats.p1MismatchPop100++;
    stats.blocks++; stats.pop += pop; stats.vap += vap;
    stats.county[county] = (stats.county[county] ?? 0) + pop;
    if (pop > 0 && vtd) { (stats.vtd[county] ??= new Set()).add(vtd); }

    let cd = st.fips === '11' ? '' : cdMap.get(blockId);
    let sldu = st.fips === '11' ? '' : slduMap.get(blockId);
    let sldl = (st.fips === '11' || st.fips === '31') ? '' : sldlMap.get(blockId);
    if (cd === undefined) { stats.missingCd++; cd = null; } else if (cd?.startsWith('Z')) { stats.zzCd++; cd = null; }
    if (sldu === undefined) { stats.missingSldu++; sldu = null; } else if (sldu?.startsWith('Z')) { stats.zzSldu++; sldu = null; }
    if (sldl === undefined) { stats.missingSldl++; sldl = null; } else if (sldl?.startsWith('Z')) { stats.zzSldl++; sldl = null; }
    const rec = { county, tract, bg, cousub: NE ? cousub : '', cd, sldu, sldl, land, pop, vap, vapHisp, vapWhiteNH, vapBlackNH, lat, lon };
    if (cd === null || sldu === null || sldl === null) { unresolved.push(rec); if (pop > 0) stats.zzPop += pop; continue; }
    addToBu(bus, rec, st.fips);
  }
  // Resolve unassigned (water / "ZZ") blocks: take the most common assignment among resolved blocks of the
  // same block group (then tract, then county). Counted in the validation report.
  if (unresolved.length) {
    const vote = new Map();
    for (const bu of bus.values()) for (const lvl of [bu.county + bu.tract + bu.bg, bu.county + bu.tract, bu.county]) {
      for (const k of [`${lvl}|${bu.cousub}`, `${lvl}|*`]) {
        const cur = vote.get(k);
        if (!cur || bu.blocks > cur.blocks) vote.set(k, { cd: bu.cd, sldu: bu.sldu, sldl: bu.sldl, blocks: bu.blocks });
      }
    }
    stats.resolvedByNeighbour = 0; stats.unresolvable = 0;
    for (const r of unresolved) {
      const cand = [r.county + r.tract + r.bg, r.county + r.tract, r.county].map((l) => vote.get(`${l}|${r.cousub}`) ?? vote.get(`${l}|*`)).find(Boolean);
      if (!cand) { stats.unresolvable++; continue; }
      if (r.cd === null) r.cd = cand.cd;
      if (r.sldu === null) r.sldu = cand.sldu;
      if (r.sldl === null) r.sldl = cand.sldl;
      stats.resolvedByNeighbour++;
      addToBu(bus, r, st.fips);
    }
  }
  const rows = [...bus.values()].map((b) => finishBu(b, st.fips));
  rows.sort((p, q) => (p.county + p.tract + p.bg + p.cd + p.sldu + p.sldl + p.cousub).localeCompare(q.county + q.tract + q.bg + q.cd + q.sldu + q.sldl + q.cousub));
  // part numbers within block group
  let prev = '', part = 0;
  for (const r of rows) { const k = r.county + r.tract + r.bg; part = k === prev ? part + 1 : 0; prev = k; r.part = part; }
  stats.vtd = Object.fromEntries(Object.entries(stats.vtd).map(([c, s]) => [c, s.size]));
  stats.bu = rows.length;
  stats.buWithoutCousub = new Set(rows.map((r) => r.county + r.tract + r.bg + r.cd + r.sldu + r.sldl)).size;
  return { rows, stats };
}

function addToBu(bus, r, fips) {
  const key = `${r.county}|${r.tract}|${r.bg}|${r.cd}|${r.sldu}|${r.sldl}|${r.cousub}`;
  let bu = bus.get(key);
  if (!bu) {
    bu = { county: r.county, tract: r.tract, bg: r.bg, cd: r.cd, sldu: r.sldu, sldl: r.sldl, cousub: r.cousub,
      blocks: 0, pop: 0, vap: 0, vapHisp: 0, vapWhiteNH: 0, vapBlackNH: 0, land: 0,
      wSum: 0, wx: 0, wy: 0, wlon: 0, wlat: 0, aSum: 0, ax: 0, ay: 0, alon: 0, alat: 0, n: 0, nx: 0, ny: 0, nlon: 0, nlat: 0 };
    bus.set(key, bu);
  }
  bu.blocks++; bu.pop += r.pop; bu.vap += r.vap; bu.vapHisp += r.vapHisp; bu.vapWhiteNH += r.vapWhiteNH; bu.vapBlackNH += r.vapBlackNH; bu.land += r.land;
  // Unwrap Aleutian longitudes east of the antimeridian so averages stay continuous.
  const lon = fips === '02' && r.lon > 0 ? r.lon - 360 : r.lon;
  const p = projectPoint(r.lon, r.lat, fips) ?? [NaN, NaN];
  const w = r.pop, a = r.land;
  bu.wSum += w; bu.wx += w * p[0]; bu.wy += w * p[1]; bu.wlon += w * lon; bu.wlat += w * r.lat;
  bu.aSum += a; bu.ax += a * p[0]; bu.ay += a * p[1]; bu.alon += a * lon; bu.alat += a * r.lat;
  bu.n++; bu.nx += p[0]; bu.ny += p[1]; bu.nlon += lon; bu.nlat += r.lat;
}

function finishBu(b, fips) {
  const pick = b.wSum > 0 ? [b.wx / b.wSum, b.wy / b.wSum, b.wlon / b.wSum, b.wlat / b.wSum]
    : b.aSum > 0 ? [b.ax / b.aSum, b.ay / b.aSum, b.alon / b.aSum, b.alat / b.aSum]
      : [b.nx / b.n, b.ny / b.n, b.nlon / b.n, b.nlat / b.n];
  let lon = pick[2]; if (fips === '02' && lon < -180) lon += 360;
  return { county: b.county, tract: b.tract, bg: b.bg, cd: b.cd, sldu: b.sldu, sldl: b.sldl, cousub: b.cousub,
    blocks: b.blocks, pop: b.pop, vap: b.vap, vapHisp: b.vapHisp, vapWhiteNH: b.vapWhiteNH, vapBlackNH: b.vapBlackNH,
    land: b.land, x: pick[0], y: pick[1], lon, lat: pick[3] };
}

export async function run() {
  const befDir = await splitBefs();
  const out = ensureDir(join(WORK, 'bu-raw'));
  const only = process.env.GEO_STATES?.split(',');
  for (const st of STATES) {
    if (only && !only.includes(st.usps)) continue;
    const dest = join(out, `${st.fips}.json`);
    if (existsSync(dest) && !process.env.GEO_FORCE) continue;
    const t = Date.now();
    const { rows, stats } = await processState(st, befDir);
    writeJson(dest, { fips: st.fips, rows, stats });
    log(`${st.usps}: ${stats.blocks} blocks → ${rows.length} BUs (pop ${stats.pop}) ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
}
