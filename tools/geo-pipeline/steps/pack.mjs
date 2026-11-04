// Step "pack": write public/geo-packs/2016.1/ per docs/data/geo-pack-format.md, plus data/timezones/county-tz.csv.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { NEW_ENGLAND } from '../lib/states.mjs';
import { PACK, PACK_VERSION, PIPE, PIPELINE_VERSION, REPO, WORK, ensureDir, log, readJson, sha256Buf, stableStringify, writeJson } from '../lib/util.mjs';
import { SCALE, TRANSLATE } from '../lib/projection.mjs';

export const BU_COLUMNS = [
  ['county', 'u16', 'county idx'], ['cd', 'u16', 'cd115 idx, 65535 = none (District of Columbia)'],
  ['sldu', 'u16', 'sldu idx, 65535 = none'], ['sldl', 'u16', 'sldl idx, 65535 = none'],
  ['cousub', 'u16', 'cousub idx, 65535 = none (outside New England)'], ['rj', 'u16', 'reporting-jurisdiction idx'],
  ['tract', 'u32', '6-digit tract code as integer'], ['bg', 'u8', 'block group digit'], ['part', 'u8', 'part within block group'],
  ['blocks', 'u16', '2010 blocks'], ['pop2010', 'u32', 'P1 total'], ['vap2010', 'u32', 'P3 18+'],
  ['vapHisp', 'u32', 'P4 18+ Hispanic'], ['vapWhiteNH', 'u32', 'P4 18+ White alone NH'], ['vapBlackNH', 'u32', 'P4 18+ Black alone NH'],
  ['landM2', 'f32', 'sum of block AREALAND'], ['x', 'f32', 'projected x'], ['y', 'f32', 'projected y'], ['lon', 'f32', 'deg'], ['lat', 'f32', 'deg'],
  ['cvap', 'f32', 'CVAP 2012–2016 apportioned by vap2010'],
  ['a18_29', 'u16', 'share ×1/65535'], ['a30_44', 'u16', 'share ×1/65535'], ['a45_64', 'u16', 'share ×1/65535'], ['a65p', 'u16', 'share ×1/65535'],
  ['male18', 'u16', 'share ×1/65535'], ['college25', 'u16', 'share ×1/65535'], ['medInc', 'f32', 'median household income, 2016 $'],
  ['flags', 'u8', 'bit0 income imputed; bit1 ACS shares imputed; bit2 CVAP imputed'],
];
const CTOR = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array };

export function encodeBu(rows) {
  const header = { rows: rows.length, sort: 'state,county,tract,bg,part', columns: [] };
  const arrays = [];
  let off = 0;
  for (const [name, type, note] of BU_COLUMNS) {
    const a = new CTOR[type](rows.length);
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][name];
      if (type !== 'f32' && type !== 'f64' && (!Number.isInteger(v) || v < 0 || v > (type === 'u8' ? 255 : type === 'u16' ? 65535 : 4294967295)))
        throw new Error(`column ${name} row ${i}: value ${v} does not fit ${type}`);
      a[i] = v;
    }
    header.columns.push({ name, type, byteOffset: off, byteLength: a.byteLength, note });
    arrays.push(a);
    off += Math.ceil(a.byteLength / 8) * 8;
  }
  const hjson = Buffer.from(JSON.stringify(header), 'utf8');
  const pre = 8 + hjson.length, pad = (8 - (pre % 8)) % 8;
  const buf = Buffer.alloc(pre + pad + off);
  buf.write('ENAB', 0, 'ascii'); buf.writeUInt32LE(hjson.length, 4); hjson.copy(buf, 8);
  const base = pre + pad;
  header.columns.forEach((c, i) => Buffer.from(arrays[i].buffer).copy(buf, base + c.byteOffset));
  return buf;
}

function csvCell(s) { s = String(s); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

export async function run() {
  const t = readJson(join(WORK, 'tables.json'));
  ensureDir(PACK);
  const tzNotes = new Map(t.counties.map((c) => [c.geoid, c.tzNote]));
  writeJson(join(PACK, 'states.json'), t.states);
  writeJson(join(PACK, 'counties.json'), t.counties);
  writeJson(join(PACK, 'cd115.json'), t.cd115);
  writeJson(join(PACK, 'sldu2016.json'), t.sldu2016);
  writeJson(join(PACK, 'sldl2016.json'), t.sldl2016);
  writeJson(join(PACK, 'cousub.json'), t.cousub);
  writeJson(join(PACK, 'rj.json'), t.rj);
  writeJson(join(PACK, 'county-adjacency.json'), readJson(join(WORK, 'county-adjacency.json')));
  const bin = encodeBu(t.bu);
  writeFileSync(join(PACK, 'bu.bin.gz'), gzipSync(bin, { level: 9, mtime: 0 }));
  log(`bu.bin: ${bin.length} bytes raw`);

  // time-zone seed file (one row per county)
  const tzLines = ['# County time zones for Election Night: America. Source: 49 CFR Part 71 (Standard Time Zone Boundaries),',
    '# compiled by tools/geo-pipeline/lib/timezones.mjs. tz = canonical IANA zone with identical rules for 2016 onward;',
    '# split = county crossed by a zone boundary (tz is then the population-majority zone, see note).',
    'geoid,name,tz,split,note'];
  for (const c of t.counties) tzLines.push([c.geoid, csvCell(c.fullName), c.tz, c.tzSplit ? 1 : 0, csvCell(tzNotes.get(c.geoid) ?? '')].join(','));
  ensureDir(join(REPO, 'data', 'timezones'));
  writeFileSync(join(REPO, 'data', 'timezones', 'county-tz.csv'), tzLines.join('\n') + '\n');

  // manifest
  const files = {};
  const walk = (d) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f !== 'manifest.json') { const b = readFileSync(p); files[relative(PACK, p)] = { bytes: b.length, sha256: sha256Buf(b) }; } } };
  walk(PACK);
  const lock = readJson(join(PIPE, 'sources.lock.json'));
  const used = Object.entries(lock.sources).filter(([id]) => !id.startsWith('surnames') && !id.startsWith('given') && !id.startsWith('congress-legislators'))
    .map(([id, s]) => ({ id, ...s })).sort((a, b) => a.id.localeCompare(b.id));
  const counts = { states: t.states.length, counties: t.counties.length, cds: t.cd115.length, sldu: t.sldu2016.length, sldl: t.sldl2016.length,
    cousub: t.cousub.length, rj: t.rj.length, bu: t.bu.length, blocks: t.bu.reduce((a, b) => a + b.blocks, 0),
    bg: new Set(t.bu.map((b) => `${b.county}|${b.tract}|${b.bg}`)).size, newEnglandStates: NEW_ENGLAND.size };
  writeJson(join(PACK, 'manifest.json'), {
    packVersion: PACK_VERSION, pipelineVersion: PIPELINE_VERSION, createdAt: new Date().toISOString().slice(0, 10),
    projection: { name: 'geoAlbersUsa', scale: SCALE, translate: TRANSLATE, viewBox: [0, 0, 975, 610] },
    counts, files, sources: used,
  }, 2);
  const total = Object.values(files).reduce((a, f) => a + f.bytes, 0);
  log(`pack written: ${Object.keys(files).length} files, ${(total / 1e6).toFixed(2)} MB`);
  return stableStringify;
}
