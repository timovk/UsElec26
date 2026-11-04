// Downloads via curl (honours the environment's proxy and CA bundle), with retries and a lock file.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CACHE, PIPE, ensureDir, log, readJson, sha256File, writeJson } from './util.mjs';

const LOCK = join(PIPE, 'sources.lock.json');
const PD = 'Public domain (U.S. Government work, 17 U.S.C. §105)';

function loadLock() { return existsSync(LOCK) ? readJson(LOCK) : { sources: {} }; }
let lock = null;
function saveLock() { writeJson(LOCK, lock, 2); }

/** Fetch url into .cache/<group>/<file>. Returns local path. Skips if present (and verifies hash if locked). */
/** Reject HTML error pages (the Census WAF answers some bursts with a 200 "Request Rejected" page) and broken zips. */
function looksValid(path) {
  const fd = openSync(path, 'r'); const b = Buffer.alloc(200); const n = readSync(fd, b, 0, 200, 0); closeSync(fd);
  const head = b.toString('latin1', 0, n).toLowerCase();
  if (head.includes('<html') && !path.endsWith('.html')) return false;
  if (path.endsWith('.zip')) { try { execFileSync('unzip', ['-tq', path], { stdio: 'ignore' }); } catch { return false; } }
  return true;
}

export async function fetchSource({ id, url, group, file, license = PD, notes = '' }) {
  lock ??= loadLock();
  const dir = ensureDir(join(CACHE, 'dl', group));
  const dest = join(dir, file ?? basename(new URL(url).pathname));
  // A cached file whose hash matches the lock is valid by definition; otherwise sanity-check it.
  if (existsSync(dest) && !(lock.sources[id] && (await sha256File(dest)) === lock.sources[id].sha256) && !looksValid(dest)) {
    log(`invalid cached file, re-downloading: ${dest}`);
    unlinkSync(dest);
    if (lock.sources[id]) { delete lock.sources[id]; saveLock(); }
  }
  if (!existsSync(dest)) {
    const tmp = dest + '.part';
    let ok = false;
    for (let attempt = 1; attempt <= 5 && !ok; attempt++) {
      try {
        execFileSync('curl', ['-sS', '-f', '-L', '--retry', '3', '--retry-delay', '2', '--max-time', '1800', '-o', tmp, url], { stdio: 'inherit' });
        ok = looksValid(tmp);
        if (!ok) { log(`rejected/invalid response (${attempt}/5): ${url}`); unlinkSync(tmp); await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt)); }
      } catch (e) {
        log(`fetch failed (${attempt}/5): ${url}`);
        if (existsSync(tmp)) unlinkSync(tmp);
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      }
    }
    if (!ok) throw new Error(`could not download ${url}`);
    renameSync(tmp, dest);
  }
  const sha = await sha256File(dest);
  const prev = lock.sources[id];
  if (prev && prev.sha256 !== sha) throw new Error(`hash mismatch for ${id}: locked ${prev.sha256}, got ${sha}`);
  if (!prev) {
    lock.sources[id] = { url, sha256: sha, bytes: statSync(dest).size, retrieved: new Date().toISOString().slice(0, 10), license, notes };
    saveLock();
  }
  return dest;
}

export function unzipTo(zipPath, outDir) {
  ensureDir(outDir);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', outDir]);
  return outDir;
}
