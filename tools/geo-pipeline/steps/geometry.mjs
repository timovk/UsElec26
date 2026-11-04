// Step "geometry": rendering topologies (pre-projected) and county adjacency.
//  - topo/counties.topo.json  objects: counties, states (merged), nation (merged)   from cb_2016_us_county_5m
//  - topo/cd115.topo.json     object: cd115                                         from cb_2016_us_cd115_5m
//  - county-adjacency.json    rook adjacency from TIGER/Line 2016 full-resolution counties
import { join } from 'node:path';
import { geoProject } from 'd3-geo-projection';
import { mergeArcs, neighbors, quantize } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import { albersUsa } from '../lib/projection.mjs';
import { readFeatures } from '../lib/shp.mjs';
import { byFips } from '../lib/states.mjs';
import { CACHE, PACK, WORK, log, readJson, writeJson } from '../lib/util.mjs';

const DL = join(CACHE, 'dl');
const QUANT = 1e5;
const SIMPLIFY_PX2 = 0.25; // minimum triangle area kept, in square screen units of the 975×610 viewBox

function project(fc) {
  const out = geoProject(fc, albersUsa);
  out.features = out.features.filter((f) => f.geometry && f.geometry.coordinates?.length);
  return out;
}

function simplifyTopo(topo) {
  const t = presimplify(topo); // planar triangle areas (coordinates are already projected)
  // presimplify decodes to absolute float coordinates; re-quantize (as us-atlas does with topoquantize)
  return quantize(simplify(t, SIMPLIFY_PX2), QUANT);
}

export async function run() {
  const tables = readJson(join(WORK, 'tables.json'));
  const countyIdx = new Map(tables.counties.map((c) => [c.geoid, c.idx]));

  // --- counties / states / nation ---------------------------------------------------------------
  const cfc = await readFeatures(join(DL, 'cb', 'cb_2016_us_county_5m.zip'));
  cfc.features = cfc.features.filter((f) => byFips.has(f.properties.STATEFP))
    .map((f) => ({ type: 'Feature', id: f.properties.GEOID, properties: { name: f.properties.NAME }, geometry: f.geometry }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const pc = project(cfc);
  const missing = cfc.features.length - pc.features.length;
  let ct = simplifyTopo(topology({ counties: pc }, QUANT));
  const geoms = ct.objects.counties.geometries;
  const byState = new Map();
  for (const g of geoms) { const s = g.id.slice(0, 2); if (!byState.has(s)) byState.set(s, []); byState.get(s).push(g); }
  ct.objects.states = { type: 'GeometryCollection', geometries: [...byState.keys()].sort().map((s) => ({ ...mergeArcs(ct, byState.get(s)), id: s, properties: { name: byFips.get(s).name } })) };
  ct.objects.nation = { type: 'GeometryCollection', geometries: [{ ...mergeArcs(ct, geoms), id: 'US' }] };
  writeJson(join(PACK, 'topo', 'counties.topo.json'), ct);
  log(`counties topology: ${geoms.length} counties (${missing} dropped by projection), ${ct.arcs.length} arcs`);

  // --- CD115 ------------------------------------------------------------------------------------
  const dfc = await readFeatures(join(DL, 'cb', 'cb_2016_us_cd115_5m.zip'));
  const cdIds = new Set(tables.cd115.map((d) => d.geoid));
  dfc.features = dfc.features.filter((f) => cdIds.has(f.properties.GEOID))
    .map((f) => ({ type: 'Feature', id: f.properties.GEOID, properties: {}, geometry: f.geometry }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const pd = project(dfc);
  const dt = simplifyTopo(topology({ cd115: pd }, QUANT));
  writeJson(join(PACK, 'topo', 'cd115.topo.json'), dt);
  log(`cd115 topology: ${dt.objects.cd115.geometries.length} districts (${cdIds.size} expected)`);

  // --- county adjacency (full-resolution TIGER, unprojected, no quantization → exact shared edges) ---
  const tfc = await readFeatures(join(DL, 'tiger', 'tl_2016_us_county.zip'));
  const tf = tfc.features.filter((f) => countyIdx.has(f.properties.GEOID))
    .map((f) => ({ type: 'Feature', id: f.properties.GEOID, properties: {}, geometry: f.geometry }))
    .sort((a, b) => countyIdx.get(a.id) - countyIdx.get(b.id));
  if (tf.length !== tables.counties.length) throw new Error(`TIGER counties ${tf.length} != ${tables.counties.length}`);
  const at = topology({ c: { type: 'FeatureCollection', features: tf } });
  const nb = neighbors(at.objects.c.geometries).map((list) => [...list].sort((a, b) => a - b));
  writeJson(join(WORK, 'county-adjacency.json'), nb);
  writeJson(join(WORK, 'geometry-stats.json'), { countiesDroppedByProjection: missing, countyFeatures: geoms.length, cdFeatures: dt.objects.cd115.geometries.length, islands: nb.filter((l) => l.length === 0).length });
  log(`adjacency: ${nb.reduce((a, l) => a + l.length, 0) / 2} pairs, ${nb.filter((l) => l.length === 0).length} without neighbours`);
}
