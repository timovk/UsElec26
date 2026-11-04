/**
 * Geography pack loader (contract: docs/data/geo-pack-format.md).
 * The pack is static, versioned data built from U.S. Census Bureau sources by tools/geo-pipeline.
 */
import { gunzip, isGzip, unpackBundle, type TypedArray } from '../core/codec';

export interface StateRec { idx: number; fips: string; usps: string; name: string; region: number; division: number; pop2010: number; vap2010: number; pop2016: number }
export interface CountyRec {
  idx: number; geoid: string; stateIdx: number; name: string; fullName: string; legalType: string;
  pop2010: number; vap2010: number; pop2016: number; landM2: number; tz: string; tzSplit: boolean;
  centroid: [number, number]; lonlat: [number, number]; vtdCount2010: number; buStart: number; buCount: number;
}
export interface DistrictRec { idx: number; geoid: string; stateIdx: number; district?: number; code?: string; name?: string; pop2010: number; vap2010: number }
export interface CousubRec { idx: number; geoid: string; stateIdx: number; countyIdx: number; name: string; legalType: string; pop2010: number }
export interface RjRec { idx: number; kind: 'county' | 'town' | 'ak_house_district'; stateIdx: number; code: string; name: string; countyIdx: number | null; pop2010: number }

export interface BaseUnits {
  rows: number;
  county: Uint16Array; cd: Uint16Array; sldu: Uint16Array; sldl: Uint16Array; cousub: Uint16Array; rj: Uint16Array;
  tract: Uint32Array; bg: Uint8Array; part: Uint8Array; blocks: Uint16Array;
  pop2010: Uint32Array; vap2010: Uint32Array; vapHisp: Uint32Array; vapWhiteNH: Uint32Array; vapBlackNH: Uint32Array;
  landM2: Float32Array; x: Float32Array; y: Float32Array; lon: Float32Array; lat: Float32Array; cvap: Float32Array;
  a18_29: Uint16Array; a30_44: Uint16Array; a45_64: Uint16Array; a65p: Uint16Array; male18: Uint16Array; college25: Uint16Array;
  medInc: Float32Array; flags: Uint8Array;
}

export interface GeoPack {
  version: string;
  manifest: { packVersion: string; counts: Record<string, number>; files: Record<string, { bytes: number; sha256: string }>; [k: string]: unknown };
  states: StateRec[]; counties: CountyRec[]; cds: DistrictRec[]; sldu: DistrictRec[]; sldl: DistrictRec[];
  cousub: CousubRec[]; rj: RjRec[]; bu: BaseUnits; countyAdjacency: number[][];
}

export const NONE16 = 65535;

/** Files that carry semantic geography (copied into each universe database). Topology files are presentation only. */
export const SEMANTIC_FILES = ['manifest.json', 'states.json', 'counties.json', 'cd115.json', 'sldu2016.json', 'sldl2016.json',
  'cousub.json', 'rj.json', 'bu.bin.gz', 'county-adjacency.json'] as const;

export type PackFetcher = (file: string) => Promise<Uint8Array>;

const BU_COLUMNS: (keyof BaseUnits)[] = ['county', 'cd', 'sldu', 'sldl', 'cousub', 'rj', 'tract', 'bg', 'part', 'blocks', 'pop2010', 'vap2010',
  'vapHisp', 'vapWhiteNH', 'vapBlackNH', 'landM2', 'x', 'y', 'lon', 'lat', 'cvap', 'a18_29', 'a30_44', 'a45_64', 'a65p', 'male18', 'college25', 'medInc', 'flags'];

export function decodeBaseUnits(raw: Uint8Array): BaseUnits {
  const { arrays } = unpackBundle(raw);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + new DataView(raw.buffer, raw.byteOffset).getUint32(4, true)))) as { rows: number };
  const out: Record<string, TypedArray | number> = { rows: header.rows };
  for (const c of BU_COLUMNS) {
    const a = arrays[c];
    if (!a) throw new Error(`geo pack: bu.bin missing column ${c}`);
    if (a.length !== header.rows) throw new Error(`geo pack: column ${c} has ${a.length} rows, expected ${header.rows}`);
    out[c] = a;
  }
  return out as unknown as BaseUnits;
}

export async function loadGeoPack(fetchFile: PackFetcher): Promise<GeoPack> {
  const json = async <T>(f: string): Promise<T> => JSON.parse(new TextDecoder().decode(await fetchFile(f))) as T;
  const manifest = await json<GeoPack['manifest']>('manifest.json');
  const [states, counties, cds, sldu, sldl, cousub, rj, countyAdjacency, buGz] = await Promise.all([
    json<StateRec[]>('states.json'), json<CountyRec[]>('counties.json'), json<DistrictRec[]>('cd115.json'),
    json<DistrictRec[]>('sldu2016.json'), json<DistrictRec[]>('sldl2016.json'), json<CousubRec[]>('cousub.json'),
    json<RjRec[]>('rj.json'), json<number[][]>('county-adjacency.json'), fetchFile('bu.bin.gz'),
  ]);
  // Some servers send .gz files with Content-Encoding: gzip, so the browser has already decompressed them.
  const bu = decodeBaseUnits(isGzip(buGz) ? await gunzip(buGz) : buGz);
  validatePack({ version: manifest.packVersion, manifest, states, counties, cds, sldu, sldl, cousub, rj, bu, countyAdjacency });
  return { version: manifest.packVersion, manifest, states, counties, cds, sldu, sldl, cousub, rj, bu, countyAdjacency };
}

/** Structural checks the engine relies on. Statistical validation lives in the pipeline report. */
export function validatePack(p: GeoPack): void {
  const fail = (m: string) => { throw new Error(`geo pack ${p.version}: ${m}`); };
  p.states.forEach((s, i) => s.idx !== i && fail(`states idx ${i}`));
  p.counties.forEach((c, i) => c.idx !== i && fail(`counties idx ${i}`));
  p.cds.forEach((c, i) => c.idx !== i && fail(`cd idx ${i}`));
  if (p.countyAdjacency.length !== p.counties.length) fail('adjacency length');
  let prevCounty = -1;
  for (let i = 0; i < p.bu.rows; i++) {
    const c = p.bu.county[i]!;
    if (c < prevCounty) fail('bu rows not sorted by county');
    prevCounty = c;
    if (c >= p.counties.length) fail(`bu ${i} county out of range`);
    const cd = p.bu.cd[i]!;
    if (cd !== NONE16 && p.cds[cd]!.stateIdx !== p.counties[c]!.stateIdx) fail(`bu ${i} cd in another state`);
  }
  for (const c of p.counties) if (c.buCount > 0 && p.bu.county[c.buStart] !== c.idx) fail(`county ${c.geoid} buStart`);
}

/** Congressional district code as used on screen: "FL-07", "AK-AL". */
export function cdCode(pack: Pick<GeoPack, 'states' | 'cds'>, cd: number): string {
  const d = pack.cds[cd]; if (!d) return '';
  if (d.code) return d.code;
  const usps = pack.states[d.stateIdx]!.usps;
  return `${usps}-${!d.district ? 'AL' : String(d.district).padStart(2, '0')}`;
}

/** Congressional district as spoken: "Florida's 7th District", "Alaska's at-large district". */
export function cdSpoken(pack: Pick<GeoPack, 'states' | 'cds'>, cd: number): string {
  const d = pack.cds[cd]; if (!d) return 'the district';
  const name = pack.states[d.stateIdx]!.name, n = d.district ?? 0;
  if (!n) return `${name}'s at-large district`;
  const sfx = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${name}'s ${n}${sfx} District`;
}
