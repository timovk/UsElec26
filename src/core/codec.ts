/**
 * Binary codecs.
 *  - ENA1: columnar integer blobs (LEB128 varints, optional zig-zag delta, deflate-raw, CRC32).
 *  - Typed bundles: named typed arrays with a JSON header (hot-state checkpoints, pack files).
 * Compression uses the platform CompressionStream (browsers, Node ≥ 18) — no dependencies.
 */

export type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

// ---- CRC32 ----------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Streams --------------------------------------------------------------------------------------
async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  try { return new Uint8Array(await out.arrayBuffer()); }
  catch (e) { throw new Error(`${stream instanceof DecompressionStream ? 'Decompression' : 'Compression'} failed — the data is corrupted or not in the expected format (${(e as Error).message}).`, { cause: e }); }
}

/** True if the bytes start with the gzip magic number. */
export const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
export const deflate = (b: Uint8Array) => pipeThrough(b, new CompressionStream('deflate-raw'));
export const inflate = (b: Uint8Array) => pipeThrough(b, new DecompressionStream('deflate-raw'));
export const gzip = (b: Uint8Array) => pipeThrough(b, new CompressionStream('gzip'));
export const gunzip = (b: Uint8Array) => pipeThrough(b, new DecompressionStream('gzip'));

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

// ---- Growable byte writer -------------------------------------------------------------------------
export class ByteWriter {
  private buf = new Uint8Array(1024);
  length = 0;
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const nb = new Uint8Array(cap); nb.set(this.buf.subarray(0, this.length)); this.buf = nb;
  }
  u8(v: number): void { this.ensure(1); this.buf[this.length++] = v & 0xff; }
  bytes(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; }
  varint(v: number): void {
    if (v < 0 || !Number.isInteger(v) || v > Number.MAX_SAFE_INTEGER) throw new RangeError(`varint out of range: ${v}`);
    this.ensure(8);
    while (v >= 0x80) { this.buf[this.length++] = (v % 128) | 0x80; v = Math.floor(v / 128); }
    this.buf[this.length++] = v;
  }
  u32le(v: number): void { this.ensure(4); new DataView(this.buf.buffer).setUint32(this.length, v >>> 0, true); this.length += 4; }
  toBytes(): Uint8Array { return this.buf.slice(0, this.length); }
}

export class ByteReader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  get remaining(): number { return this.buf.length - this.pos; }
  u8(): number { if (this.pos >= this.buf.length) throw new Error('read past end'); return this.buf[this.pos++]!; }
  bytes(n: number): Uint8Array { if (this.pos + n > this.buf.length) throw new Error('read past end'); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  varint(): number {
    let result = 0, mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 128;
    }
    throw new Error('varint too long');
  }
  u32le(): number { const v = new DataView(this.buf.buffer, this.buf.byteOffset).getUint32(this.pos, true); this.pos += 4; return v; }
}

export const zigzag = (x: number): number => (x >= 0 ? x * 2 : -x * 2 - 1);
export const unzigzag = (z: number): number => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

// ---- ENA1 integer columns ---------------------------------------------------------------------------
export const enum ColumnTransform { Raw = 0, Delta = 1 }

export interface IntColumn { values: ArrayLike<number>; transform?: ColumnTransform }

const ENA1_MAGIC = [0x45, 0x31]; // 'E1'

/** Encode integer columns of equal length. Values must be integers in [0, 2^53) for Raw; any safe integer for Delta. */
export async function encodeIntColumns(cols: readonly IntColumn[]): Promise<Uint8Array> {
  const rows = cols[0]?.values.length ?? 0;
  const inner = new ByteWriter();
  inner.varint(cols.length); inner.varint(rows);
  for (const col of cols) {
    if (col.values.length !== rows) throw new Error('ENA1: ragged columns');
    const t = col.transform ?? ColumnTransform.Raw;
    inner.u8(t);
    let prev = 0;
    for (let i = 0; i < rows; i++) {
      const v = col.values[i]!;
      if (t === ColumnTransform.Delta) { inner.varint(zigzag(v - prev)); prev = v; } else inner.varint(v);
    }
  }
  const raw = inner.toBytes();
  const body = await deflate(raw);
  const out = new ByteWriter();
  out.u8(ENA1_MAGIC[0]!); out.u8(ENA1_MAGIC[1]!); out.u8(1); out.u8(1);
  out.varint(raw.length); out.u32le(crc32(raw)); out.bytes(body);
  return out.toBytes();
}

export async function decodeIntColumns(bytes: Uint8Array): Promise<Float64Array[]> {
  const r = new ByteReader(bytes);
  if (r.u8() !== ENA1_MAGIC[0] || r.u8() !== ENA1_MAGIC[1]) throw new Error('ENA1: bad magic');
  const version = r.u8(); const flags = r.u8();
  if (version !== 1) throw new Error(`ENA1: unsupported version ${version}`);
  const rawLen = r.varint(); const crc = r.u32le();
  const body = r.bytes(r.remaining);
  const raw = flags & 1 ? await inflate(body) : body;
  if (raw.length !== rawLen || crc32(raw) !== crc) throw new Error('ENA1: checksum mismatch (corrupted blob)');
  const ir = new ByteReader(raw);
  const nCols = ir.varint(), rows = ir.varint();
  const cols: Float64Array[] = [];
  for (let c = 0; c < nCols; c++) {
    const t = ir.u8(); const arr = new Float64Array(rows);
    let prev = 0;
    for (let i = 0; i < rows; i++) {
      const v = ir.varint();
      if (t === ColumnTransform.Delta) { prev += unzigzag(v); arr[i] = prev; } else arr[i] = v;
    }
    cols.push(arr);
  }
  return cols;
}

// ---- Typed bundles ------------------------------------------------------------------------------------
type TypeTag = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64';
const CTORS = {
  i8: Int8Array, u8: Uint8Array, i16: Int16Array, u16: Uint16Array,
  i32: Int32Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array,
} as const;

function tagOf(a: TypedArray): TypeTag {
  if (a instanceof Int8Array) return 'i8'; if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Int16Array) return 'i16'; if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int32Array) return 'i32'; if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Float32Array) return 'f32'; return 'f64';
}

export interface BundleHeader { columns: { name: string; type: TypeTag; byteOffset: number; byteLength: number }[]; meta?: unknown }

/** Layout: 'ENAB' | u32 headerLength | JSON header | pad to 8 | aligned columns. Not compressed (callers choose). */
export function packBundle(arrays: Record<string, TypedArray>, meta?: unknown): Uint8Array {
  const names = Object.keys(arrays).sort();
  const columns: BundleHeader['columns'] = [];
  let off = 0;
  for (const name of names) {
    const a = arrays[name]!;
    columns.push({ name, type: tagOf(a), byteOffset: off, byteLength: a.byteLength });
    off += Math.ceil(a.byteLength / 8) * 8;
  }
  const header = new TextEncoder().encode(JSON.stringify({ columns, meta } satisfies BundleHeader));
  const start = Math.ceil((8 + header.length) / 8) * 8;
  const out = new Uint8Array(start + off);
  out.set([0x45, 0x4e, 0x41, 0x42], 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  for (const c of columns) {
    const a = arrays[c.name]!;
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), start + c.byteOffset);
  }
  return out;
}

export function unpackBundle(bytes: Uint8Array): { arrays: Record<string, TypedArray>; meta: unknown } {
  if (bytes[0] !== 0x45 || bytes[1] !== 0x4e || bytes[2] !== 0x41 || bytes[3] !== 0x42) throw new Error('bundle: bad magic');
  const hl = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as BundleHeader;
  const start = Math.ceil((8 + hl) / 8) * 8;
  const arrays: Record<string, TypedArray> = {};
  for (const c of header.columns) {
    const Ctor = CTORS[c.type];
    const copy = bytes.slice(start + c.byteOffset, start + c.byteOffset + c.byteLength);
    arrays[c.name] = new Ctor(copy.buffer, 0, c.byteLength / Ctor.BYTES_PER_ELEMENT);
  }
  return { arrays, meta: header.meta };
}

/** Compressed, checksummed bundle for storage. */
export async function encodeBundle(arrays: Record<string, TypedArray>, meta?: unknown): Promise<Uint8Array> {
  const raw = packBundle(arrays, meta);
  const out = new ByteWriter();
  out.u8(0x45); out.u8(0x5a); out.u32le(crc32(raw)); out.bytes(await deflate(raw));
  return out.toBytes();
}

export async function decodeBundle(bytes: Uint8Array): Promise<{ arrays: Record<string, TypedArray>; meta: unknown }> {
  if (bytes[0] !== 0x45 || bytes[1] !== 0x5a) throw new Error('bundle: bad container magic');
  const crc = new DataView(bytes.buffer, bytes.byteOffset).getUint32(2, true);
  const raw = await inflate(bytes.subarray(6));
  if (crc32(raw) !== crc) throw new Error('bundle: checksum mismatch (corrupted blob)');
  return unpackBundle(raw);
}

export async function encodeJson(value: unknown): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  const out = new ByteWriter();
  out.u8(0x45); out.u8(0x4a); out.u32le(crc32(raw)); out.bytes(await deflate(raw));
  return out.toBytes();
}

export async function decodeJson<T>(bytes: Uint8Array): Promise<T> {
  if (bytes[0] !== 0x45 || bytes[1] !== 0x4a) throw new Error('json blob: bad magic');
  const crc = new DataView(bytes.buffer, bytes.byteOffset).getUint32(2, true);
  const raw = await inflate(bytes.subarray(6));
  if (crc32(raw) !== crc) throw new Error('json blob: checksum mismatch (corrupted blob)');
  return JSON.parse(new TextDecoder().decode(raw)) as T;
}
