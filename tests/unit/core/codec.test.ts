import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ColumnTransform, crc32, decodeBundle, decodeIntColumns, decodeJson, encodeBundle, encodeIntColumns, encodeJson, sha256Hex } from '../../../src/core/codec';

describe('codecs', () => {
  it('crc32 known answer', () => { expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926); });
  it('sha256 known answer', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('ENA1 round-trips random integer columns (property)', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 1, max: 4 }), fc.integer(), async (rows, ncols, seed) => {
      let s = seed >>> 0; const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
      const cols = Array.from({ length: ncols }, (_, c) => ({ values: Array.from({ length: rows }, () => c % 2 ? next() % 100000 : next()), transform: c === 1 ? ColumnTransform.Delta : ColumnTransform.Raw }));
      const dec = await decodeIntColumns(await encodeIntColumns(cols));
      return dec.every((col, c) => Array.from(col).every((v, i) => v === cols[c]!.values[i]));
    }), { numRuns: 60 });
  });
  it('detects corruption', async () => {
    const enc = await encodeIntColumns([{ values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }]);
    enc[enc.length - 1] = enc[enc.length - 1]! ^ 0xff;
    await expect(decodeIntColumns(enc)).rejects.toThrow();
  });
  it('bundles and json blobs round-trip', async () => {
    const b = await decodeBundle(await encodeBundle({ a: new Float32Array([1.5, -2]), b: new Uint16Array([7, 8, 9]) }, { v: 1 }));
    expect(Array.from(b.arrays.a!)).toEqual([1.5, -2]); expect(Array.from(b.arrays.b!)).toEqual([7, 8, 9]); expect(b.meta).toEqual({ v: 1 });
    expect(await decodeJson(await encodeJson({ x: [1, 'two'] }))).toEqual({ x: [1, 'two'] });
  });
});
