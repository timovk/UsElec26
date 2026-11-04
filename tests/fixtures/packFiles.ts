import { gzip, packBundle, type TypedArray } from '../../src/core/codec';
import type { GeoPack, NameData } from '../../src/engine/testExports';

/** Serialize an in-memory GeoPack into the on-disk pack file set (as the pipeline would write it). */
export async function packToFiles(pack: GeoPack): Promise<Map<string, Uint8Array>> {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  const files = new Map<string, Uint8Array>();
  files.set('manifest.json', enc(pack.manifest));
  files.set('states.json', enc(pack.states)); files.set('counties.json', enc(pack.counties)); files.set('cd115.json', enc(pack.cds));
  files.set('sldu2016.json', enc(pack.sldu)); files.set('sldl2016.json', enc(pack.sldl)); files.set('cousub.json', enc(pack.cousub));
  files.set('rj.json', enc(pack.rj)); files.set('county-adjacency.json', enc(pack.countyAdjacency));
  const { rows, ...cols } = pack.bu;
  const raw = packBundle(cols as unknown as Record<string, TypedArray>);
  // Contract header carries `rows` at top level.
  const hl = new DataView(raw.buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + hl)));
  const withRows = packBundleWithRows(cols as unknown as Record<string, TypedArray>, rows, header);
  files.set('bu.bin.gz', await gzip(withRows));
  return files;
}

function packBundleWithRows(arrays: Record<string, TypedArray>, rows: number, header: { columns: { name: string; byteOffset: number; byteLength: number }[] }): Uint8Array {
  const h = new TextEncoder().encode(JSON.stringify({ rows, sort: 'state,county,tract,bg,part', columns: header.columns }));
  const start = Math.ceil((8 + h.length) / 8) * 8;
  const total = header.columns.reduce((a, c) => Math.max(a, c.byteOffset + Math.ceil(c.byteLength / 8) * 8), 0);
  const out = new Uint8Array(start + total);
  out.set([0x45, 0x4e, 0x41, 0x42]); new DataView(out.buffer).setUint32(4, h.length, true); out.set(h, 8);
  for (const c of header.columns) { const a = arrays[c.name]!; out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), start + c.byteOffset); }
  return out;
}

export function fixtureNames(): NameData {
  const sur = ['Abbott', 'Alvarez', 'Bennett', 'Brooks', 'Castillo', 'Chen', 'Coleman', 'Delgado', 'Dunn', 'Ellison', 'Fischer', 'Foster', 'Garza', 'Gibson',
    'Hale', 'Hayes', 'Ibarra', 'Jensen', 'Kaur', 'Keller', 'Lam', 'Lowe', 'Marsh', 'Medina', 'Nash', 'Nguyen', 'Okafor', 'Ortiz', 'Patel', 'Pruitt',
    'Quinn', 'Ramos', 'Reyes', 'Rhodes', 'Santos', 'Sloan', 'Tate', 'Torres', 'Underwood', 'Vance', 'Vargas', 'Walsh', 'Webb', 'Whitaker', 'Yates', 'Zhou'];
  return {
    surnames: sur.map((name, i) => ({ name, count: 1000 + i * 37, pct: [60 - (i % 5) * 8, 10 + (i % 3) * 5, 10 + (i % 4) * 6, 5 + (i % 6) * 4] as [number, number, number, number] })),
    givenMale: ['Aaron', 'Brian', 'Carl', 'Daniel', 'Edward', 'Frank', 'Gary', 'Henry', 'Isaac', 'James', 'Kevin', 'Louis', 'Martin', 'Neil', 'Oscar', 'Paul', 'Raymond', 'Scott', 'Thomas', 'Victor', 'Walter'].map((name, i) => ({ name, freq: 1 + i })),
    givenFemale: ['Alice', 'Brenda', 'Carol', 'Diane', 'Elena', 'Fiona', 'Grace', 'Helen', 'Irene', 'Joan', 'Karen', 'Laura', 'Maria', 'Nancy', 'Olivia', 'Paula', 'Rachel', 'Susan', 'Teresa', 'Valerie'].map((name, i) => ({ name, freq: 1 + i })),
    blocklist: new Set(['james brooks']),
  };
}
