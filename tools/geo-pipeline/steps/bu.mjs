// Step "bu": assemble the national Base Unit table and every lookup table of the pack.
// Inputs: work/bu-raw/*.json, work/acs/*.json, work/cvap.json, Vintage 2016 estimates, CB 2016 names.
// Output: work/tables.json (all JSON tables + BU rows, consumed by the "pack" and "validate" steps).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDbf } from '../lib/shp.mjs';
import { NEW_ENGLAND, STATES, byFips } from '../lib/states.mjs';
import { countyTimezone, unusedExceptions } from '../lib/timezones.mjs';
import { CACHE, WORK, log, readJson, writeJson } from '../lib/util.mjs';

const DL = join(CACHE, 'dl');
const CB = join(DL, 'cb');
const NONE16 = 65535;

const COUNTY_LSAD = { '06': 'County', '15': 'Parish', '04': 'Borough', '05': 'Census Area', '03': 'City and Borough', '12': 'Municipality', '25': 'City', '00': 'District' };
const COUSUB_LSAD = { '43': 'town', '25': 'city', '31': 'gore', '32': 'grant', '36': 'location', '39': 'plantation', '42': 'purchase', '44': 'township', '46': 'unorganized territory', '86': 'reservation' };

function fullCountyName(name, legalType) {
  if (legalType === 'District') return name;
  if (legalType === 'City') return `${name} city`; // Census style for independent cities
  return `${name} ${legalType}`;
}

function popest() {
  const lines = readFileSync(join(DL, 'popest', 'co-est2016-alldata.csv'), 'latin1').split(/\r?\n/).filter(Boolean);
  const h = lines[0].split(',');
  const iS = h.indexOf('SUMLEV'), iSt = h.indexOf('STATE'), iC = h.indexOf('COUNTY'), iP = h.indexOf('POPESTIMATE2016');
  const county = new Map(), state = new Map();
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    // CTYNAME/STNAME never contain commas in this file except none; guard anyway by counting from the start
    if (f[iS] === '050') county.set(f[iSt] + f[iC], Number(f[iP]));
    else if (f[iS] === '040') state.set(f[iSt], Number(f[iP]));
  }
  return { county, state };
}

/** Largest-remainder quantization of non-negative weights to integers summing to `total`. */
function quantize(weights, total) {
  const s = weights.reduce((a, b) => a + b, 0);
  if (!(s > 0)) return weights.map(() => 0);
  const raw = weights.map((w) => (w / s) * total);
  const out = raw.map(Math.floor);
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rem > 0; k++, rem--) out[order[k % order.length][1]]++;
  return out;
}
const q16 = (x) => Math.max(0, Math.min(65535, Math.round(x * 65535)));

export async function run() {
  const est = popest();
  // --- counties (2016 vintage) ---------------------------------------------------------------
  const cbCounties = (await readDbf(join(CB, 'cb_2016_us_county_500k.zip'))).filter((r) => byFips.has(r.STATEFP));
  cbCounties.sort((a, b) => a.GEOID.localeCompare(b.GEOID));
  const namesByState = new Map();
  for (const r of cbCounties) {
    const usps = byFips.get(r.STATEFP).usps;
    if (!namesByState.has(usps)) namesByState.set(usps, new Set());
    namesByState.get(usps).add(r.NAME);
  }
  const tzMissing = unusedExceptions(namesByState);
  if (tzMissing.length) throw new Error(`time-zone exceptions reference unknown counties: ${tzMissing.join(', ')}`);

  const states = STATES.map((s, idx) => ({ idx, fips: s.fips, usps: s.usps, name: s.name, region: s.region, division: s.division, pop2010: 0, vap2010: 0, pop2016: est.state.get(s.fips) }));
  const stateIdx = new Map(states.map((s) => [s.fips, s.idx]));
  const counties = cbCounties.map((r, idx) => {
    const legalType = COUNTY_LSAD[r.LSAD];
    if (!legalType) throw new Error(`unknown county LSAD ${r.LSAD} for ${r.GEOID}`);
    const tz = countyTimezone(byFips.get(r.STATEFP).usps, r.NAME);
    return { idx, geoid: r.GEOID, stateIdx: stateIdx.get(r.STATEFP), name: r.NAME, fullName: fullCountyName(r.NAME, legalType), legalType,
      pop2010: 0, vap2010: 0, pop2016: est.county.get(r.GEOID), landM2: 0, tz: tz.tz, tzSplit: tz.split, tzNote: tz.note,
      centroid: [0, 0], lonlat: [0, 0], vtdCount2010: 0, buStart: 0, buCount: 0 };
  });
  const countyIdx = new Map(counties.map((c) => [c.geoid, c.idx]));
  const missingEst = counties.filter((c) => !Number.isFinite(c.pop2016)).map((c) => c.geoid);
  if (missingEst.length) throw new Error(`no Vintage 2016 estimate for ${missingEst.join(',')}`);

  // --- names for districts and towns ----------------------------------------------------------
  const slduNames = new Map(), sldlNames = new Map(), cousubNames = new Map();
  for (const s of STATES) {
    if (s.fips === '11') continue;
    for (const r of await readDbf(join(CB, `cb_2016_${s.fips}_sldu_500k.zip`))) slduNames.set(r.GEOID, r.NAME);
    if (s.fips !== '31') for (const r of await readDbf(join(CB, `cb_2016_${s.fips}_sldl_500k.zip`))) sldlNames.set(r.GEOID, r.NAME);
    if (NEW_ENGLAND.has(s.fips)) for (const r of await readDbf(join(CB, `cb_2016_${s.fips}_cousub_500k.zip`))) cousubNames.set(r.GEOID, { name: r.NAME, legalType: COUSUB_LSAD[r.LSAD] ?? `LSAD ${r.LSAD}` });
  }

  // --- Base Units --------------------------------------------------------------------------------
  const cvap = readJson(join(WORK, 'cvap.json'));
  const rows = [];
  const stats = { states: {}, acsImputed: 0, incImputed: 0, cvapImputed: 0, cvapRatio: [] };
  const vtdByCounty = {};
  for (const s of STATES) {
    const raw = readJson(join(WORK, 'bu-raw', `${s.fips}.json`));
    const acs = readJson(join(WORK, 'acs', `${s.fips}.json`));
    stats.states[s.fips] = raw.stats;
    Object.assign(vtdByCounty, raw.stats.vtd);
    // block-group adult totals (for apportioning BG-level CVAP to parts)
    const bgVap = new Map(), tractVap = new Map();
    for (const r of raw.rows) {
      const bg = r.county + r.tract + r.bg;
      bgVap.set(bg, (bgVap.get(bg) ?? 0) + r.vap);
      tractVap.set(r.county + r.tract, (tractVap.get(r.county + r.tract) ?? 0) + r.vap);
    }
    for (const r of raw.rows) {
      const bgId = r.county + r.tract + r.bg, trId = r.county + r.tract;
      let flags = 0;
      let rec = acs.bg[bgId];
      if (!rec || !(rec.tot > 0) || !(rec.pop25 > 0)) { rec = acs.tract[trId]; flags |= 2; }
      if (!rec || !(rec.tot > 0) || !(rec.pop25 > 0)) { rec = acs.county[r.county]; flags |= 2; }
      let inc = acs.bg[bgId]?.medInc;
      if (!Number.isFinite(inc)) { inc = acs.tract[trId]?.medInc; flags |= 1; }
      if (!Number.isFinite(inc)) { inc = acs.county[r.county]?.medInc; flags |= 1; }
      const ages = quantize([rec.a18_29, rec.a30_44, rec.a45_64, rec.a65p], 65535);
      // CVAP: block-group estimate apportioned by 2010 adult population share
      let cv;
      const bgC = cvap.bg[bgId], bv = bgVap.get(bgId);
      if (Number.isFinite(bgC) && bv > 0) cv = bgC * (r.vap / bv);
      else {
        flags |= 4;
        const tc = cvap.tract[trId], tv = tractVap.get(trId);
        cv = Number.isFinite(tc) && tv > 0 ? tc * (r.vap / tv) : 0;
      }
      if (flags & 2) stats.acsImputed++;
      if (flags & 1) stats.incImputed++;
      if (flags & 4) stats.cvapImputed++;
      const ci = countyIdx.get(r.county);
      if (ci === undefined) throw new Error(`BU in unknown county ${r.county}`);
      rows.push({ ...r, stateFips: s.fips, countyIdx: ci, cvap: cv, a: ages, male18: rec.tot > 0 ? rec.male18 / rec.tot : 0.5,
        college25: rec.pop25 > 0 ? rec.coll25 / rec.pop25 : 0, medInc: Number.isFinite(inc) ? inc : NaN, flags });
    }
  }
  // global order: state, county, tract, bg, part (rows already sorted within state; states in FIPS order)
  rows.sort((p, q) => p.county.localeCompare(q.county) || p.tract.localeCompare(q.tract) || p.bg.localeCompare(q.bg) || p.part - q.part);

  // --- districts, towns ------------------------------------------------------------------------
  const mk = (kind) => new Map();
  const cdMap = mk(), slduMap = mk(), sldlMap = mk(), cousubMap = mk();
  for (const r of rows) {
    if (r.cd) cdMap.set(r.stateFips + r.cd, { stateFips: r.stateFips, code: r.cd });
    if (r.sldu) slduMap.set(r.stateFips + r.sldu, { stateFips: r.stateFips, code: r.sldu });
    if (r.sldl) sldlMap.set(r.stateFips + r.sldl, { stateFips: r.stateFips, code: r.sldl });
    if (r.cousub) cousubMap.set(r.county + r.cousub, { stateFips: r.stateFips, county: r.county, code: r.cousub });
  }
  const sortedEntries = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const cd115 = sortedEntries(cdMap).map(([geoid, v], idx) => ({ idx, geoid, stateIdx: stateIdx.get(v.stateFips), district: Number(v.code), pop2010: 0, vap2010: 0 }));
  const sld = (m, names) => sortedEntries(m).map(([geoid, v], idx) => ({ idx, geoid, stateIdx: stateIdx.get(v.stateFips), code: v.code, name: names.get(geoid) ?? v.code.replace(/^0+(?=\d)/, ''), pop2010: 0, vap2010: 0 }));
  const sldu2016 = sld(slduMap, slduNames), sldl2016 = sld(sldlMap, sldlNames);
  const cousub = sortedEntries(cousubMap).map(([geoid, v], idx) => {
    const n = cousubNames.get(geoid) ?? (v.code === '00000' ? { name: 'County subdivisions not defined', legalType: 'undefined' } : { name: v.code, legalType: 'unknown' });
    return { idx, geoid, stateIdx: stateIdx.get(v.stateFips), countyIdx: countyIdx.get(v.county), name: n.name, legalType: n.legalType, pop2010: 0 };
  });
  const cdIdx = new Map(cd115.map((d) => [d.geoid, d.idx]));
  const slduIdx = new Map(sldu2016.map((d) => [d.geoid, d.idx]));
  const sldlIdx = new Map(sldl2016.map((d) => [d.geoid, d.idx]));
  const cousubIdx = new Map(cousub.map((d) => [d.geoid, d.idx]));

  // --- reporting jurisdictions -------------------------------------------------------------------
  const rjDefs = new Map();
  const rjKey = (r) => {
    if (NEW_ENGLAND.has(r.stateFips)) return `town:${r.county}${r.cousub}`;
    if (r.stateFips === '02') return `ak:02${r.sldl}`;
    if (r.county === '15005') return 'county:15009'; // Kalawao is administered with Maui for elections
    return `county:${r.county}`;
  };
  for (const r of rows) {
    const k = rjKey(r);
    if (rjDefs.has(k)) continue;
    const [kind, code] = k.split(':');
    if (kind === 'county') { const c = counties[countyIdx.get(code)]; rjDefs.set(k, { kind: 'county', stateFips: r.stateFips, code, name: c.fullName, countyIdx: c.idx }); }
    else if (kind === 'town') { const t = cousub[cousubIdx.get(code)]; rjDefs.set(k, { kind: 'town', stateFips: r.stateFips, code, name: t.legalType === 'undefined' ? `${t.name} (${counties[t.countyIdx].fullName})` : `${t.name} ${t.legalType}`, countyIdx: t.countyIdx }); }
    else { const d = sldl2016[sldlIdx.get(code)]; rjDefs.set(k, { kind: 'ak_house_district', stateFips: '02', code, name: `House District ${d.name}`, countyIdx: null }); }
  }
  const rj = [...rjDefs.entries()].sort((a, b) => a[1].stateFips.localeCompare(b[1].stateFips) || a[1].code.localeCompare(b[1].code))
    .map(([key, v], idx) => ({ key, idx, kind: v.kind, stateIdx: stateIdx.get(v.stateFips), code: v.code, name: v.name, countyIdx: v.countyIdx, pop2010: 0 }));
  const rjIdx = new Map(rj.map((d) => [d.key, d.idx]));

  // --- per-BU indices and aggregates -------------------------------------------------------------
  const cAgg = counties.map(() => ({ w: 0, x: 0, y: 0, lon: 0, lat: 0, a: 0, ax: 0, ay: 0, alon: 0, alat: 0 }));
  const bu = rows.map((r, i) => {
    const c = counties[r.countyIdx];
    const o = {
      county: r.countyIdx, cd: r.cd ? cdIdx.get(r.stateFips + r.cd) : NONE16, sldu: r.sldu ? slduIdx.get(r.stateFips + r.sldu) : NONE16,
      sldl: r.sldl ? sldlIdx.get(r.stateFips + r.sldl) : NONE16, cousub: r.cousub ? cousubIdx.get(r.county + r.cousub) : NONE16,
      rj: rjIdx.get(rjKey(r)), tract: Number(r.tract), bg: Number(r.bg), part: r.part, blocks: r.blocks,
      pop2010: r.pop, vap2010: r.vap, vapHisp: r.vapHisp, vapWhiteNH: r.vapWhiteNH, vapBlackNH: r.vapBlackNH,
      landM2: r.land, x: r.x, y: r.y, lon: r.lon, lat: r.lat, cvap: r.cvap,
      a18_29: r.a[0], a30_44: r.a[1], a45_64: r.a[2], a65p: r.a[3], male18: q16(r.male18), college25: q16(r.college25),
      medInc: r.medInc, flags: r.flags,
    };
    if (c.buCount === 0) c.buStart = i;
    c.buCount++;
    c.pop2010 += r.pop; c.vap2010 += r.vap; c.landM2 += r.land;
    states[c.stateIdx].pop2010 += r.pop; states[c.stateIdx].vap2010 += r.vap;
    if (o.cd !== NONE16) { cd115[o.cd].pop2010 += r.pop; cd115[o.cd].vap2010 += r.vap; }
    if (o.sldu !== NONE16) { sldu2016[o.sldu].pop2010 += r.pop; sldu2016[o.sldu].vap2010 += r.vap; }
    if (o.sldl !== NONE16) { sldl2016[o.sldl].pop2010 += r.pop; sldl2016[o.sldl].vap2010 += r.vap; }
    if (o.cousub !== NONE16) cousub[o.cousub].pop2010 += r.pop;
    rj[o.rj].pop2010 += r.pop;
    const g = cAgg[r.countyIdx];
    const lon = r.stateFips === '02' && r.lon > 0 ? r.lon - 360 : r.lon;
    g.w += r.pop; g.x += r.pop * r.x; g.y += r.pop * r.y; g.lon += r.pop * lon; g.lat += r.pop * r.lat;
    g.a += r.land; g.ax += r.land * r.x; g.ay += r.land * r.y; g.alon += r.land * lon; g.alat += r.land * r.lat;
    if (Number.isFinite(r.cvap) && r.vap > 0) stats.cvapRatio.push(r.cvap / r.vap);
    return o;
  });
  counties.forEach((c, i) => {
    const g = cAgg[i];
    const [x, y, lon, lat] = g.w > 0 ? [g.x / g.w, g.y / g.w, g.lon / g.w, g.lat / g.w] : [g.ax / g.a, g.ay / g.a, g.alon / g.a, g.alat / g.a];
    c.centroid = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
    c.lonlat = [Math.round((lon < -180 ? lon + 360 : lon) * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
    c.vtdCount2010 = vtdByCounty[c.geoid] ?? 0;
    c.landM2 = Math.round(c.landM2);
  });
  const emptyCounties = counties.filter((c) => c.buCount === 0).map((c) => c.geoid);
  if (emptyCounties.length) throw new Error(`counties without BUs: ${emptyCounties.join(',')}`);
  rj.forEach((r) => delete r.key);

  writeJson(join(WORK, 'tables.json'), { states, counties, cd115, sldu2016, sldl2016, cousub, rj, bu, stats: { ...stats, cvapRatio: undefined } });
  // keep the ratio sample compact for validation
  stats.cvapRatio.sort((a, b) => a - b);
  const pctl = (p) => stats.cvapRatio[Math.floor(p * (stats.cvapRatio.length - 1))];
  writeJson(join(WORK, 'bu-stats.json'), { acsImputed: stats.acsImputed, incImputed: stats.incImputed, cvapImputed: stats.cvapImputed,
    cvapRatioPct: { p01: pctl(0.01), p05: pctl(0.05), p50: pctl(0.5), p95: pctl(0.95), p99: pctl(0.99), max: stats.cvapRatio.at(-1) },
    cvapOver105: stats.cvapRatio.filter((x) => x > 1.05).length });
  log(`BUs ${bu.length}, counties ${counties.length}, CDs ${cd115.length}, SLDU ${sldu2016.length}, SLDL ${sldl2016.length}, towns ${cousub.length}, RJs ${rj.length}`);
}
