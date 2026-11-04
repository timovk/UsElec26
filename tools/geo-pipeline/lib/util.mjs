import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIPE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = resolve(PIPE, '..', '..');
export const CACHE = join(PIPE, '.cache');
export const WORK = join(CACHE, 'work');
export const PACK_VERSION = '2016.1';
export const PACK = join(REPO, 'public', 'geo-packs', PACK_VERSION);
export const PIPELINE_VERSION = '1.0.0';

export const ensureDir = (d) => { mkdirSync(d, { recursive: true }); return d; };
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}
export const sha256Buf = (buf) => createHash('sha256').update(buf).digest('hex');

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(v, indent = 0) {
  const norm = (x) => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm(x[k])]));
    return x;
  };
  return JSON.stringify(norm(v), null, indent);
}
export function writeJson(path, v, indent = 0) { ensureDir(dirname(path)); writeFileSync(path, stableStringify(v, indent) + '\n'); }
export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export const exists = existsSync;
export const round = (x, d) => { const f = 10 ** d; return Math.round(x * f) / f; };
