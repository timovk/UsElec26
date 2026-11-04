/**
 * `.ena` universe export format.
 *   bytes 0–3   'ENA\0'
 *   bytes 4–5   format version (u16 LE) = 1
 *   bytes 6–7   schema version (u16 LE)
 *   bytes 8–23  engine version (ASCII, zero-padded)
 *   bytes 24–27 payload length (u32 LE)
 *   bytes 28–31 reserved (0)
 *   bytes 32–63 SHA-256 of the payload
 *   bytes 64…   payload = gzip(SQLite database image)
 */
import { gunzip, gzip, sha256Hex } from '../core/codec';

const MAGIC = [0x45, 0x4e, 0x41, 0x00];

export interface EnaHeader { formatVersion: number; schemaVersion: number; engineVersion: string; payloadLength: number; sha256: string }

export async function encodeEna(db: Uint8Array, schemaVersion: number, engineVersion: string): Promise<Uint8Array> {
  const payload = await gzip(db);
  const hash = await sha256Hex(payload);
  const out = new Uint8Array(64 + payload.length);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0); dv.setUint16(4, 1, true); dv.setUint16(6, schemaVersion, true);
  out.set(new TextEncoder().encode(engineVersion.slice(0, 16)), 8);
  dv.setUint32(24, payload.length, true);
  for (let i = 0; i < 32; i++) out[32 + i] = parseInt(hash.slice(2 * i, 2 * i + 2), 16);
  out.set(payload, 64);
  return out;
}

export function readEnaHeader(bytes: Uint8Array): EnaHeader {
  if (bytes.length < 64 || MAGIC.some((m, i) => bytes[i] !== m)) throw new Error('This is not an Election Night: America universe file (.ena).');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 64);
  const ev = new TextDecoder().decode(bytes.subarray(8, 24)).replace(/\0+$/, '');
  let sha = ''; for (let i = 32; i < 64; i++) sha += bytes[i]!.toString(16).padStart(2, '0');
  return { formatVersion: dv.getUint16(4, true), schemaVersion: dv.getUint16(6, true), engineVersion: ev, payloadLength: dv.getUint32(24, true), sha256: sha };
}

export async function decodeEna(bytes: Uint8Array): Promise<{ header: EnaHeader; db: Uint8Array }> {
  const header = readEnaHeader(bytes);
  if (header.formatVersion !== 1) throw new Error(`Unsupported universe file format ${header.formatVersion}.`);
  const payload = bytes.subarray(64);
  if (payload.length !== header.payloadLength) throw new Error('The universe file is truncated (incomplete download or copy).');
  if (await sha256Hex(payload) !== header.sha256) throw new Error('The universe file failed its checksum — it is corrupted.');
  const db = await gunzip(payload);
  if (new TextDecoder().decode(db.subarray(0, 15)) !== 'SQLite format 3') throw new Error('The universe file does not contain a database.');
  return { header, db };
}
