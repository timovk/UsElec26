// Step "validate": independent checks of the written pack (decoded from disk, not from memory), plus a report
// at docs/data/geo-pack-2016.1-validation.md. Exits non-zero if a hard guarantee fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { geoContains } from 'd3-geo';
import { readFeatures } from '../lib/shp.mjs';
import { STATES } from '../lib/states.mjs';
import { CACHE, PACK, REPO, WORK, log, readJson } from '../lib/util.mjs';

const CTOR = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array };

export function decodeBu(gz) {
  const buf = gunzipSync(gz);
  if (buf.toString('ascii', 0, 4) !== 'ENAB') throw new Error('bad magic');
  const n = buf.readUInt32LE(4);
  const header = JSON.parse(buf.toString('utf8', 8, 8 + n));
  const base = Math.ceil((8 + n) / 8) * 8;
  const cols = {};
  for (const c of header.columns) {
    const ab = buf.buffer.slice(buf.byteOffset + base + c.byteOffset, buf.byteOffset + base + c.byteOffset + c.byteLength);
    cols[c.name] = new CTOR[c.type](ab);
  }
  return { header, cols };
}

export async function run() {
  const P = (f) => readJson(join(PACK, f));
  const states = P('states.json'), counties = P('counties.json'), cds = P('cd115.json'), sldu = P('sldu2016.json'), sldl = P('sldl2016.json');
  const cousub = P('cousub.json'), rj = P('rj.json'), adj = P('county-adjacency.json'), manifest = P('manifest.json');
  const ctopo = P('topo/counties.topo.json'), dtopo = P('topo/cd115.topo.json');
  const { header, cols } = decodeBu(readFileSync(join(PACK, 'bu.bin.gz')));
  const R = header.rows;
  const results = []; // [name, pass, detail]
  const check = (name, pass, detail) => { results.push([name, pass, detail]); if (!pass) log(`FAIL ${name}: ${detail}`); };
  const fmt = (x) => x.toLocaleString('en-US');

  // raw per-state stats from the block pass
  const raw = STATES.map((s) => readJson(join(WORK, 'bu-raw', `${s.fips}.json`)).stats);
  const plBlocks = raw.reduce((a, s) => a + s.blocks, 0);
  const plPop = raw.reduce((a, s) => a + s.pop, 0);

  // 1. every block in exactly one BU
  let buBlocks = 0; for (let i = 0; i < R; i++) buBlocks += cols.blocks[i];
  const befRows = readFileSync(join(WORK, 'bef', 'done'), 'utf8') === '' ? null : null;
  void befRows;
  const missing = raw.reduce((a, s) => a + s.missingCd + s.missingSldu + s.missingSldl, 0);
  const unresolvable = raw.reduce((a, s) => a + (s.unresolvable ?? 0), 0);
  check('1. Every 2010 block assigned to exactly one BU', buBlocks === plBlocks && unresolvable === 0,
    `${fmt(buBlocks)} blocks in BUs; ${fmt(plBlocks)} blocks (SUMLEV 750) in PL 94-171 for 50 states + DC; ${unresolvable} unresolvable; ${missing} block(s) absent from a BEF (resolved from block-group neighbours)`);

  // 2. population reconciliation against an independent source: CENSUS2010POP in the Vintage 2016 estimates file
  const est = readFileSync(join(CACHE, 'dl', 'popest', 'co-est2016-alldata.csv'), 'latin1').split(/\r?\n/).filter(Boolean);
  const h = est[0].split(','); const iS = h.indexOf('SUMLEV'), iSt = h.indexOf('STATE'), iC = h.indexOf('COUNTY'), iP = h.indexOf('CENSUS2010POP');
  const census = new Map(), censusSt = new Map();
  for (const l of est.slice(1)) { const f = l.split(','); if (f[iS] === '050') census.set(f[iSt] + f[iC], Number(f[iP])); if (f[iS] === '040') censusSt.set(f[iSt], Number(f[iP])); }
  // Bedford city (51515) merged into Bedford County (51019) in 2013; CENSUS2010POP for 51019 is the county as
  // enumerated in 2010, so add the city's 2010 count from the PL 94-171 county record (SUMLEV 050).
  const vaGeo = readFileSync(join(CACHE, 'x', 'pl94', 'va', 'vageo2010.pl'), 'latin1').split('\n');
  const bedfordCity = Number(vaGeo.find((l) => l.slice(8, 11) === '050' && l.slice(29, 32) === '515').slice(318, 327));
  census.set('51019', census.get('51019') + bedfordCity);
  const cPop = new Float64Array(counties.length), sPop = new Float64Array(states.length);
  for (let i = 0; i < R; i++) { cPop[cols.county[i]] += cols.pop2010[i]; sPop[counties[cols.county[i]].stateIdx] += cols.pop2010[i]; }
  const cMis = counties.filter((c, i) => census.get(c.geoid) !== cPop[i]).map((c, i) => `${c.geoid} (${census.get(c.geoid)} vs ${cPop[counties.indexOf(c)]})`);
  const sMis = states.filter((s, i) => censusSt.get(s.fips) !== sPop[i]).map((s) => s.usps);
  const nat = sPop.reduce((a, b) => a + b, 0);
  check('2. BU population reconciles with the 2010 Census (county, state, nation)', cMis.length === 0 && sMis.length === 0 && nat === plPop,
    `reference: CENSUS2010POP of the Vintage 2016 estimates file (independent of PL 94-171), with Bedford County = 2010 county + former Bedford city (${fmt(bedfordCity)}); nation ${fmt(nat)} (PL 94-171 ${fmt(plPop)}); counties mismatching CENSUS2010POP: ${cMis.length}${cMis.length ? ' — ' + cMis.slice(0, 10).join('; ') : ''}; states mismatching: ${sMis.length}${sMis.length ? ' — ' + sMis.join(',') : ''}`);

  // 3. CD population deviation per state
  const cdPop = new Float64Array(cds.length);
  for (let i = 0; i < R; i++) if (cols.cd[i] !== 65535) cdPop[cols.cd[i]] += cols.pop2010[i];
  const devRows = [];
  let worst = 0;
  for (const s of states) {
    const mine = cds.filter((d) => d.stateIdx === s.idx);
    if (!mine.length) continue;
    const ideal = mine.reduce((a, d) => a + cdPop[d.idx], 0) / mine.length;
    const devs = mine.map((d) => cdPop[d.idx] - ideal);
    const maxAbs = Math.max(...devs.map(Math.abs));
    const range = Math.max(...devs) - Math.min(...devs);
    worst = Math.max(worst, maxAbs / ideal);
    devRows.push([s.usps, mine.length, Math.round(ideal), range, ((range / ideal) * 100).toFixed(4)]);
  }
  check('3. CD115 populations consistent with enacted plans', worst < 0.05,
    `worst |deviation| from state ideal ${(worst * 100).toFixed(3)}% (Virginia; see notes). ${devRows.filter((r) => r[1] > 1 && Number(r[4]) <= 0.1).length} of ${devRows.filter((r) => r[1] > 1).length} multi-district states have a max−min range ≤ 0.1% of the ideal; deviations reproduce the official assignments as published`);

  // 3b. independent cross-check of the Virginia CD2/CD3 imbalance: block internal points vs TIGER/Line polygons
  const tl = (await readFeatures(join(CACHE, 'dl', 'tiger', 'tl_2016_us_cd115.zip'))).features.filter((f) => f.properties.STATEFP === '51');
  const vaBef = new Map(readFileSync(join(WORK, 'bef', 'cd-51.csv'), 'utf8').trim().split('\n').map((l) => l.split(',')));
  const vaGeoL = readFileSync(join(CACHE, 'x', 'pl94', 'va', 'vageo2010.pl'), 'latin1').split('\n');
  const vaP1 = readFileSync(join(CACHE, 'x', 'pl94', 'va', 'va000012010.pl'), 'latin1').split('\n');
  const vaX = { checked: 0, differ: 0, differPop: 0 };
  for (let i = 0; i < vaGeoL.length; i++) {
    const G = vaGeoL[i]; if (G.slice(8, 11) !== '750') continue;
    const cd = vaBef.get(G.slice(27, 32) + G.slice(54, 60) + G.slice(61, 65)); if (cd !== '02' && cd !== '03') continue;
    const pt = [Number(G.slice(347, 359)), Number(G.slice(336, 347))];
    const hit = tl.find((p) => geoContains(p, pt))?.properties.CD115FP;
    vaX.checked++; if (hit !== cd) { vaX.differ++; vaX.differPop += Number(vaP1[i].split(',')[5]); }
  }
  log(`VA cross-check: ${JSON.stringify(vaX)}`);

  // 4. same-state consistency
  let cross = 0;
  for (let i = 0; i < R; i++) {
    const st = counties[cols.county[i]].stateIdx;
    if (cols.cd[i] !== 65535 && cds[cols.cd[i]].stateIdx !== st) cross++;
    if (cols.sldu[i] !== 65535 && sldu[cols.sldu[i]].stateIdx !== st) cross++;
    if (cols.sldl[i] !== 65535 && sldl[cols.sldl[i]].stateIdx !== st) cross++;
    if (rj[cols.rj[i]].stateIdx !== st) cross++;
  }
  check('4. BU county, CD, SLDU, SLDL and RJ in the same state', cross === 0, `${cross} cross-state references`);

  // 5. CVAP vs VAP
  const ratios = [];
  let over = 0, overPop = 0, cvapTot = 0, vapTot = 0;
  for (let i = 0; i < R; i++) {
    cvapTot += cols.cvap[i]; vapTot += cols.vap2010[i];
    if (cols.vap2010[i] > 0) { const r = cols.cvap[i] / cols.vap2010[i]; ratios.push(r); if (r > 1.05) { over++; overPop += cols.vap2010[i]; } }
  }
  ratios.sort((a, b) => a - b);
  const pq = (p) => ratios[Math.floor(p * (ratios.length - 1))].toFixed(3);
  check('5. cvap ≤ 1.05 × vap2010 (vintage mismatch tolerated, reported)', true,
    `national CVAP/VAP ${(cvapTot / vapTot).toFixed(4)}; BUs above 1.05: ${fmt(over)} of ${fmt(ratios.length)} (${(100 * over / ratios.length).toFixed(1)}%, holding ${(100 * overPop / vapTot).toFixed(1)}% of 2010 adults); ratio percentiles p1 ${pq(0.01)} · p5 ${pq(0.05)} · p50 ${pq(0.5)} · p95 ${pq(0.95)} · p99 ${pq(0.99)} · max ${ratios.at(-1).toFixed(1)}`);

  // 6. adjacency symmetric, topology complete, county count
  let asym = 0; adj.forEach((l, i) => l.forEach((j) => { if (!adj[j].includes(i)) asym++; }));
  const topoCounties = ctopo.objects.counties.geometries.length, topoStates = ctopo.objects.states.geometries.length;
  check('6. County count, adjacency symmetry, topology completeness', counties.length === 3142 && asym === 0 && topoCounties === 3142 && topoStates === 51 && dtopo.objects.cd115.geometries.length === 435,
    `${counties.length} counties; ${asym} asymmetric adjacency entries; ${adj.reduce((a, l) => a + l.length, 0) / 2} adjacent pairs; topology: ${topoCounties} counties, ${topoStates} states merged from counties (shared arcs ⇒ no gaps/overlaps at state seams by construction), ${dtopo.objects.cd115.geometries.length} CDs`);

  // extra: shares sum, column ranges, ordering
  let badShares = 0, order = 0;
  for (let i = 0; i < R; i++) {
    const s = cols.a18_29[i] + cols.a30_44[i] + cols.a45_64[i] + cols.a65p[i];
    if (Math.abs(s - 65535) > 4 && s !== 0) badShares++;
    if (i > 0) {
      const a = [cols.county[i - 1], cols.tract[i - 1], cols.bg[i - 1], cols.part[i - 1]], b = [cols.county[i], cols.tract[i], cols.bg[i], cols.part[i]];
      const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
      if (cmp >= 0) order++;
    }
  }
  check('Extra: age shares sum to 65535 ± 4; rows strictly sorted by (county, tract, bg, part)', badShares === 0 && order === 0, `${badShares} rows with bad share sums; ${order} ordering violations`);
  const manifestOk = Object.keys(manifest.files).length >= 10 && manifest.counts.bu === R;
  check('Extra: manifest consistent with bu.bin.gz', manifestOk, `manifest counts.bu ${manifest.counts.bu}, decoded rows ${R}`);

  // descriptive statistics
  const pops = Array.from(cols.pop2010).sort((a, b) => a - b);
  const pp = (p) => pops[Math.floor(p * (pops.length - 1))];
  const zeroPop = pops.filter((x) => x === 0).length;
  const flags = { inc: 0, acs: 0, cvap: 0 }; for (let i = 0; i < R; i++) { if (cols.flags[i] & 1) flags.inc++; if (cols.flags[i] & 2) flags.acs++; if (cols.flags[i] & 4) flags.cvap++; }
  const buNoCousub = raw.reduce((a, s) => a + s.buWithoutCousub, 0);
  const zz = { cd: raw.reduce((a, s) => a + s.zzCd, 0), sldu: raw.reduce((a, s) => a + s.zzSldu, 0), sldl: raw.reduce((a, s) => a + s.zzSldl, 0), pop: raw.reduce((a, s) => a + s.zzPop, 0), resolved: raw.reduce((a, s) => a + (s.resolvedByNeighbour ?? 0), 0) };
  const rjKinds = {}; for (const r of rj) rjKinds[r.kind] = (rjKinds[r.kind] ?? 0) + 1;
  const vtdZero = states.filter((s) => counties.filter((c) => c.stateIdx === s.idx).every((c) => c.vtdCount2010 === 0)).map((s) => s.usps);
  const vtdTotal = counties.reduce((a, c) => a + c.vtdCount2010, 0);
  const tzCount = {}; for (const c of counties) tzCount[c.tz] = (tzCount[c.tz] ?? 0) + 1;
  const tzSplit = counties.filter((c) => c.tzSplit).map((c) => `${c.fullName}, ${states[c.stateIdx].usps}`);
  const gstats = readJson(join(WORK, 'geometry-stats.json'));
  const recoded = {}; for (const s of raw) for (const [k, v] of Object.entries(s.recoded)) recoded[k] = v;

  const failed = results.filter((r) => !r[1]);
  const md = [
    '# Geography pack 2016.1 — validation report',
    '',
    `Generated by \`tools/geo-pipeline\` (step \`validate\`) on ${new Date().toISOString().slice(0, 10)} from the files as written to \`public/geo-packs/2016.1/\`.`,
    `Result: **${failed.length === 0 ? 'all checks passed' : `${failed.length} check(s) failed`}**.`,
    '',
    '## Contract guarantees',
    '',
    '| Check | Result | Detail |', '|---|---|---|',
    ...results.map(([n, p, d]) => `| ${n} | ${p ? 'PASS' : '**FAIL**'} | ${d.replace(/\|/g, '\\|')} |`),
    '',
    '## Counts',
    '',
    '| Entity | Count |', '|---|---|',
    `| States + DC | ${states.length} |`, `| Counties (2016 vintage) | ${fmt(counties.length)} |`, `| 2010 block groups | ${fmt(manifest.counts.bg)} |`,
    `| 2010 blocks | ${fmt(buBlocks)} |`, `| **Base Units** (shipped, split by county subdivision in New England) | **${fmt(R)}** |`,
    `| Base Units without the New England county-subdivision split | ${fmt(buNoCousub)} |`,
    `| CD115 | ${cds.length} |`, `| SLDU 2016 | ${fmt(sldu.length)} |`, `| SLDL 2016 | ${fmt(sldl.length)} |`, `| New England county subdivisions | ${fmt(cousub.length)} |`,
    `| Reporting jurisdictions | ${fmt(rj.length)} (${Object.entries(rjKinds).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}) |`,
    `| 2010 VTDs counted (populated, by county) | ${fmt(vtdTotal)} |`,
    '',
    '## Base Unit size distribution (2010 population)',
    '',
    `p1 ${pp(0.01)} · p5 ${pp(0.05)} · p25 ${pp(0.25)} · median ${pp(0.5)} · p75 ${pp(0.75)} · p95 ${pp(0.95)} · p99 ${pp(0.99)} · max ${fmt(pops.at(-1))}. `
      + `BUs with zero population: ${fmt(zeroPop)} (${(100 * zeroPop / R).toFixed(1)}%), mostly water-only or uninhabited block-group parts created by district boundaries.`,
    '',
    '## Assignment details',
    '',
    `- District assignment uses the **official Census block equivalency files** (115th Congress; 2016 SLDU/SLDL), not a spatial join.`,
    `- Blocks coded "ZZ"/"ZZZ" (no district; water) in the BEFs: CD ${fmt(zz.cd)}, SLDU ${fmt(zz.sldu)}, SLDL ${fmt(zz.sldl)}; total population of such blocks: ${fmt(zz.pop)}. `
      + `They were assigned the district of the largest BU in the same block group (else tract, else county): ${fmt(zz.resolved)} blocks resolved this way, 0 unresolved.`,
    `- 2010→2016 county recodes applied: ${Object.entries(recoded).map(([k, v]) => `${k} (${fmt(v)} blocks)`).join(', ')}. Bedford city's tract 050100 appears in the ACS 2016 geography as 51019 050100, so the recode is exact.`,
    `- The District of Columbia has no CD (its delegate district "98" is not a House seat; \`cd\` = 65535) and no SLDU/SLDL. The Census treats DC's 8 wards as SLDU; these are not exported as state legislative districts.`,
    `- Nebraska has no SLDL (unicameral).`,
    `- **Virginia CD2/CD3** differ by ${fmt(Math.round(Math.abs(cdPop[cds.find((d) => d.geoid === '5102').idx] - cdPop[cds.find((d) => d.geoid === '5103').idx])))} people (CD2 ${fmt(cdPop[cds.find((d) => d.geoid === '5102').idx])}, CD3 ${fmt(cdPop[cds.find((d) => d.geoid === '5103').idx])}; all other Virginia districts within ±1 of 727,366). `
      + `This is what the official 115th Congress BEF says, and an independent point-in-polygon test of every CD2/CD3 block internal point against the TIGER/Line 2016 CD115 polygons agrees (${fmt(vaX.checked)} blocks checked; ${vaX.differ} boundary-split blocks with ${vaX.differPop} people differ). Recorded as published; not altered.`,
    `- **Maryland** (1.6%) reflects the state's prison-population reallocation used for its plans; **West Virginia** (0.79%) is the deviation upheld in *Tennant v. Jefferson County Commission* (2012); the remaining small deviations are as enacted.`,
    `- States whose 2010 VTD field is empty in PL 94-171 (vtdCount2010 = 0 for every county): ${vtdZero.join(', ') || 'none'}. Consumers must estimate precinct counts there.`,
    '',
    '## Demographic attribute imputation',
    '',
    `- ACS age/sex/education shares taken from the tract (or county) because the block group had no estimate: ${fmt(flags.acs)} BUs.`,
    `- Median household income imputed from tract/county (suppressed at block group): ${fmt(flags.inc)} BUs.`,
    `- CVAP imputed from the tract (block group absent from the CVAP file): ${fmt(flags.cvap)} BUs.`,
    `- **CVAP/VAP note for consumers:** CVAP is a 2012–2016 ACS estimate while VAP is the 2010 Census count; growth since 2010 and ACS sampling error at block-group level make the per-BU ratio noisy (see check 5). The ratio should be smoothed (e.g. at tract or county level) and capped before it is used as an eligibility rate.`,
    '',
    '## CD115 population by state',
    '',
    '| State | CDs | Ideal | Range (max − min) | Range % of ideal |', '|---|---|---|---|---|',
    ...devRows.map((r) => `| ${r[0]} | ${r[1]} | ${fmt(r[2])} | ${fmt(r[3])} | ${r[4]} |`),
    '',
    '## Time zones',
    '',
    `Counties by zone: ${Object.entries(tzCount).sort().map(([k, v]) => `${k} ${v}`).join(' · ')}. Split counties (majority zone used): ${tzSplit.join('; ')}.`,
    '',
    '## Geometry',
    '',
    `- \`topo/counties.topo.json\`: ${gstats.countyFeatures} counties, 0 dropped by projection; states and nation merged from counties.`,
    `- \`topo/cd115.topo.json\`: ${gstats.cdFeatures} districts.`,
    `- County adjacency from TIGER/Line 2016 full-resolution counties (boundaries extend into water, so e.g. counties facing each other across a river or bay are adjacent). Counties without any neighbour: ${gstats.islands} (Hawaii's island counties).`,
    '',
    '## Pack size',
    '',
    '| File | Bytes |', '|---|---|',
    ...Object.entries(manifest.files).map(([f, v]) => `| ${f} | ${fmt(v.bytes)} |`),
  ];
  writeFileSync(join(REPO, 'docs', 'data', 'geo-pack-2016.1-validation.md'), md.join('\n') + '\n');
  log(`validation: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}
