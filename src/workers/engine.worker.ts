/// <reference lib="webworker" />
/**
 * Engine Worker: owns the universe and the only database connection.
 * The UI talks to it exclusively through the message protocol in src/engine/protocol.ts.
 */
import type { EngineEvent, Request, Response as EngineResponse, SlotInfo, StorageInfo } from '../engine/protocol';
import { Universe, ENGINE_VERSION, ENGINE_UPDATED } from '../engine/universe';
import { runQuery } from '../engine/queries';
import { SEMANTIC_FILES } from '../geo/pack';
import { gzip, isGzip } from '../core/codec';
import { initSqlite, MemoryStorage, OpfsStorage, UNIVERSE_DIR, type Storage } from '../persistence/storage';
import { SCHEMA_VERSION, migrate } from '../persistence/schema';
import { integrityReport } from '../persistence/audit';
import { decodeEna, encodeEna } from '../persistence/enaFile';
import { parseNameFile, type NameFileV1 } from '../politicians/nameData';
import type { NameData } from '../politicians/names';
import { runDiagnostics } from '../engine/diagnostics';
import { WorkerPoolRunner, type ShardRunner } from '../engine/computePool';
import { sqliteWriteBench } from '../persistence/bench';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

declare const self: DedicatedWorkerGlobalScope;

const BASE = import.meta.env.BASE_URL;
const PACK_DIR = `${BASE}geo-packs/2016.1/`;

let sqlite3: Sqlite3Static | null = null;
let storage: Storage | null = null;
let universe: Universe | null = null;
let names: NameData | null = null;
let playing: { daysPerSecond: number; timer: ReturnType<typeof setTimeout> | null } | null = null;
let busy: Promise<unknown> = Promise.resolve();
let pool: ShardRunner | null = null;
function attach(u: Universe): Universe {
  try {
    pool ??= new WorkerPoolRunner(() => new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module', name: 'compute' }), Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)));
    u.runner = pool;
  } catch (e) { console.warn('compute workers unavailable; running inline', e); }
  let lastEmit = 0;
  u.onProgress = (step, fraction) => { const t = performance.now(); if (t - lastEmit > 150 || fraction >= 1) { lastEmit = t; emit({ event: 'progress', step, fraction }); } };
  return u;
}

const emit = (e: EngineEvent) => self.postMessage(e);

async function fetchBytes(url: string): Promise<Uint8Array> {
  let r: Response;
  try { r = await fetch(url); } catch (e) { throw new Error(`Network error loading ${url}: ${(e as Error).message}. If you are offline, open the app once while online.`, { cause: e }); }
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status}). If you are offline, open the app once while online.`);
  return new Uint8Array(await r.arrayBuffer());
}

async function getNames(): Promise<NameData> {
  if (!names) names = parseNameFile(JSON.parse(new TextDecoder().decode(await fetchBytes(`${BASE}data/names-v1.json`))) as NameFileV1);
  return names;
}

async function init(): Promise<{ storage: StorageInfo; slots: SlotInfo[]; engineVersion: string; engineUpdated: string }> {
  if (!sqlite3) sqlite3 = await initSqlite();
  if (!storage) {
    const gotLock = await new Promise<boolean>((resolve) => {
      if (!('locks' in navigator)) { resolve(true); return; }
      void navigator.locks.request('ena-app-instance', { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        return lock ? new Promise<void>(() => {}) : undefined; // hold for the worker's lifetime
      });
    });
    if (!gotLock) throw new Error('Election Night: America is already open in another tab or window. Close it there to continue here.');
    try { storage = await OpfsStorage.create(sqlite3); await (storage as OpfsStorage).ensureCapacity(2); }
    catch (e) {
      console.warn('OPFS unavailable, using temporary in-memory storage', e);
      storage = new MemoryStorage(sqlite3);
    }
  }
  return { storage: await storageInfo(false), slots: listSlots(), engineVersion: ENGINE_VERSION, engineUpdated: ENGINE_UPDATED };
}

async function storageInfo(requestPersist: boolean): Promise<StorageInfo> {
  let persisted: boolean | null = null, usage: number | null = null, quota: number | null = null;
  try {
    if (requestPersist && navigator.storage?.persist) persisted = await navigator.storage.persist();
    else if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? null; quota = est?.quota ?? null;
  } catch { /* not available */ }
  return { kind: storage?.kind ?? 'memory', persisted, usage, quota };
}

function slotInfo(fileName: string): SlotInfo | null {
  const s = storage!;
  const active = universe && universe.fileName === fileName ? universe.db : null;
  const db = active ?? s.open(fileName);
  try {
    if (!active) migrate(db);
    const u = db.get<{ name: string; seed: string; clock_time: number; start_time: number; created_real: string }>('SELECT name, seed, clock_time, start_time, created_real FROM universe WHERE id = 1');
    if (!u) return null;
    const lastExport = db.value<string>("SELECT value FROM meta WHERE key = 'last_export_real'") ?? '';
    const bytes = Number(db.value('PRAGMA page_count') ?? 0) * Number(db.value('PRAGMA page_size') ?? 0);
    return { id: fileName.slice(UNIVERSE_DIR.length + 2, -'.sqlite3'.length), name: u.name, seed: u.seed, currentTime: u.clock_time, startTime: u.start_time, createdReal: u.created_real, lastExportReal: lastExport, bytes };
  } catch (e) { console.warn('unreadable universe', fileName, e); return null; }
  finally { if (!active) db.close(); }
}

const fileFor = (id: string) => `${UNIVERSE_DIR}u-${id}.sqlite3`;
function listSlots(): SlotInfo[] { return storage!.list().map(slotInfo).filter((s): s is SlotInfo => !!s).sort((a, b) => b.createdReal.localeCompare(a.createdReal)); }

function stopPlay(): void { if (playing?.timer) clearTimeout(playing.timer); playing = null; }

function startPlay(daysPerSecond: number): void {
  stopPlay();
  playing = { daysPerSecond, timer: null };
  const tick = async () => {
    if (!playing || !universe) return;
    const started = performance.now();
    const days = Math.max(1, Math.round(playing.daysPerSecond / 5));
    try {
      const run = busy.then(() => universe!.advance({ kind: 'days', days }, false));
      busy = run;
      const items = await run;
      emit({ event: 'clock', time: universe.world.time, playing: true });
      if (items.length) emit({ event: 'news', items: items.map((n) => ({ id: n.id, time: n.time, kind: n.kind, headline: n.headline, body: n.body, personId: n.refs.personId as number | undefined })) });
    } catch (e) { stopPlay(); emit({ event: 'error', message: String((e as Error).message ?? e) }); return; }
    if (playing) playing.timer = setTimeout(() => void tick(), Math.max(0, (1000 * days) / playing.daysPerSecond - (performance.now() - started)));
  };
  void tick();
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'init': return init();
    case 'list': return listSlots();
    case 'storage': return storageInfo(!!req.requestPersist);
    case 'create': {
      stopPlay(); universe?.close(); universe = null;
      const packFiles = new Map<string, Uint8Array>();
      emit({ event: 'progress', step: 'Loading U.S. geography', fraction: 0.01 });
      await Promise.all(SEMANTIC_FILES.map(async (f) => {
        let b = await fetchBytes(PACK_DIR + f);
        if (f.endsWith('.gz') && !isGzip(b)) b = await gzip(b); // keep the universe's copy compressed
        packFiles.set(f, b);
      }));
      if (storage instanceof OpfsStorage) await storage.ensureCapacity(2);
      universe = attach(await Universe.create(storage!, { name: req.name, seed: req.seed }, packFiles, await getNames(), (step, fraction) => emit({ event: 'progress', step, fraction })));
      return slotInfo(universe.fileName);
    }
    case 'open': {
      stopPlay();
      if (universe && universe.fileName === fileFor(req.id)) return slotInfo(universe.fileName);
      universe?.close(); universe = null;
      let n: NameData | null; try { n = await getNames(); } catch { n = null; }
      universe = attach(await Universe.open(storage!, fileFor(req.id), n));
      return slotInfo(universe.fileName);
    }
    case 'close': stopPlay(); universe?.close(); universe = null; return null;
    case 'delete': {
      if (universe && universe.fileName === fileFor(req.id)) { stopPlay(); universe.close(); universe = null; }
      storage!.remove(fileFor(req.id)); return listSlots();
    }
    case 'export': {
      const f = fileFor(req.id);
      let bytes: Uint8Array;
      if (universe && universe.fileName === f) { bytes = universe.exportBytes(); universe.markExported(); }
      else { bytes = storage!.exportFile(f); const db = storage!.open(f); db.run("INSERT OR REPLACE INTO meta VALUES ('last_export_real', ?)", [new Date().toISOString()]); db.close(); }
      const info = slotInfo(f)!;
      const ena = await encodeEna(bytes, SCHEMA_VERSION, ENGINE_VERSION);
      return { bytes: ena, fileName: `${info.name.replace(/[^\w\- ]+/g, '').trim() || 'universe'}.ena` };
    }
    case 'import': {
      const { db } = await decodeEna(req.bytes);
      const id = `imported-${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(36)).join('')}`;
      const f = fileFor(id);
      await storage!.importFile(f, db);
      const check = storage!.open(f);
      try {
        const qc = check.value<string>('PRAGMA quick_check');
        if (qc !== 'ok') throw new Error(`The imported database is damaged: ${qc}`);
        migrate(check);
        if (!check.get('SELECT 1 FROM universe WHERE id = 1')) throw new Error('The file does not contain a universe.');
      } catch (e) { check.close(); storage!.remove(f); throw e; }
      check.close();
      return slotInfo(f);
    }
    case 'advance': {
      if (!universe) throw new Error('No universe is open.');
      stopPlay();
      const items = await universe.advance(req.target);
      emit({ event: 'clock', time: universe.world.time, playing: false });
      return items.map((n) => ({ id: n.id, time: n.time, kind: n.kind, headline: n.headline, body: n.body, personId: n.refs.personId as number | undefined }));
    }
    case 'play': if (!universe) throw new Error('No universe is open.'); startPlay(req.daysPerSecond); return null;
    case 'pause': stopPlay(); if (universe) emit({ event: 'clock', time: universe.world.time, playing: false }); return null;
    case 'query': if (!universe) throw new Error('No universe is open.'); return runQuery(universe, req.query);
    case 'integrity': if (!universe) throw new Error('No universe is open.'); return integrityReport(universe.db);
    case 'diagnostics': return runDiagnostics(() => sqliteWriteBench(sqlite3!), universe);
  }
}

self.onmessage = (ev: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = ev.data;
  const run = req.type === 'pause' || req.type === 'query' ? handle(req) : (busy = busy.then(() => handle(req), () => handle(req)));
  run.then(
    (result) => {
      const msg: EngineResponse = { id, ok: true, result };
      const b = result && typeof result === 'object' ? (result as { bytes?: unknown }).bytes : undefined;
      const transfer = b instanceof Uint8Array ? [b.buffer as ArrayBuffer] : [];
      self.postMessage(msg, transfer);
    },
    (err: unknown) => { console.error("[engine]", req.type, err); self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies EngineResponse); },
  );
};
