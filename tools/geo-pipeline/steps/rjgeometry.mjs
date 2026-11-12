// Step "rjgeometry" (Phase 7.5): the reporting units that are not counties, for maps.
//  - topo/rj.topo.json  objects: towns (New England county subdivisions)    from cb_2016_{09,23,25,33,44,50}_cousub_500k
//                                akhd  (Alaska's 2016 State House districts) from cb_2016_02_sldl_500k
// Feature ids are reporting-jurisdiction indices (rj.json idx); only units with residents are drawn (the
// "county subdivisions not defined" water areas are not). Projected and simplified like the county topology,
// but finer, because towns are small: the map shows them when zoomed into a state, and nationwide at county scale.
// Presentation only: the pack's semantic files are unchanged; the manifest gains the file's hash.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { geoProject } from 'd3-geo-projection';
import { mergeArcs, quantize } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import { albersUsa } from '../lib/projection.mjs';
import { readFeatures } from '../lib/shp.mjs';
import { CACHE, PACK, log, readJson, sha256Buf, writeJson } from '../lib/util.mjs';

const DL = join(CACHE, 'dl');
const QUANT = 1e5;
const SIMPLIFY_PX2 = 0.004; // finer than counties (0.25): a town is a few screen units across at state zoom
const NEW_ENGLAND = ['09', '23', '25', '33', '44', '50'];

export async function run() {
  const rj = readJson(join(PACK, 'rj.json'));
  const byCode = new Map(rj.filter((r) => r.kind !== 'county' && r.pop2010 > 0).map((r) => [r.code, r]));
  const allCodes = new Set(rj.map((r) => r.code));
  const collect = async (zip, idOf) => {
    const fc = await readFeatures(join(DL, 'cb', zip));
    const out = [], matched = new Set(), unmatched = [];
    for (const f of fc.features) {
      const r = byCode.get(idOf(f.properties));
      if (r && f.geometry) { out.push({ type: 'Feature', id: r.idx, properties: { name: r.name }, geometry: f.geometry }); matched.add(r.idx); } else if (f.geometry && !allCodes.has(idOf(f.properties))) unmatched.push(f);
    }
    // A town whose code changed between the 2010 blocks and the 2016 boundaries (Sanford, Maine became a city
    // in 2013): when its county has exactly one boundary without a unit, they are the same place.
    const fips = zip.slice(8, 10);
    for (const r of byCode.values()) {
      if (matched.has(r.idx) || !r.code.startsWith(fips) || r.code.length !== 10) continue;
      const cands = unmatched.filter((f) => f.properties.GEOID.slice(0, 5) === r.code.slice(0, 5));
      if (cands.length !== 1) continue;
      const f = cands[0]; unmatched.splice(unmatched.indexOf(f), 1);
      out.push({ type: 'Feature', id: r.idx, properties: { name: f.properties.NAME, code2016: f.properties.GEOID }, geometry: f.geometry });
      log(`  ${r.code} ${r.name} → ${f.properties.GEOID} ${f.properties.NAME}`);
    }
    return out;
  };
  const towns = [];
  for (const fips of NEW_ENGLAND) towns.push(...await collect(`cb_2016_${fips}_cousub_500k.zip`, (p) => p.GEOID));
  const akhd = await collect('cb_2016_02_sldl_500k.zip', (p) => p.GEOID);
  towns.sort((a, b) => a.id - b.id); akhd.sort((a, b) => a.id - b.id);
  const project = (features) => { const o = geoProject({ type: 'FeatureCollection', features }, albersUsa); o.features = o.features.filter((f) => f.geometry && f.geometry.coordinates?.length); return o; };
  const pt = project(towns), pa = project(akhd);
  const t = quantize(simplify(presimplify(topology({ towns: pt, akhd: pa }, QUANT)), SIMPLIFY_PX2), QUANT);
  void mergeArcs;
  const path = join(PACK, 'topo', 'rj.topo.json');
  writeJson(path, t);
  const expectTowns = rj.filter((r) => r.kind === 'town' && r.pop2010 > 0).length, expectHd = rj.filter((r) => r.kind === 'ak_house_district').length;
  log(`rj topology: ${t.objects.towns.geometries.length}/${expectTowns} towns, ${t.objects.akhd.geometries.length}/${expectHd} Alaska House districts, ${t.arcs.length} arcs`);
  if (t.objects.towns.geometries.length < expectTowns * 0.98 || t.objects.akhd.geometries.length !== expectHd) throw new Error('rj topology: units missing');
  // The manifest lists every pack file with its hash (the pack step rewrites it in a full run).
  const mpath = join(PACK, 'manifest.json');
  const m = readJson(mpath), b = readFileSync(path);
  m.files['topo/rj.topo.json'] = { bytes: b.length, sha256: sha256Buf(b) };
  writeJson(mpath, m, 2);
}
