/**
 * The Night Record (docs/architecture/07 §7.6, 08 §8.7): every batch of the count with its timestamp and
 * content, the wire's expected vote, every desk status and projection, and control projections. It is
 * computed once at the ballot lock, sealed, and only ever played back: a replay is the original record.
 */
import { ColumnTransform, decodeBundle, decodeIntColumns, encodeBundle, encodeIntColumns, sha256Hex } from '../core/codec';
import type { StateNight, SurveyTopline } from './types';

export interface RecordRace {
  contestId: number; cd: number; stateIdx: number; k: number;
  candidacyIds: number[]; parties: number[]; office: string; ev: number; label: string;
  /** Ranked-choice contest (Phase 7.1; absent in earlier records). */
  rcv?: boolean;
  parts: Int32Array;            // global part ids
  precincts: number;            // precincts in the race
  close: number;                // last poll closing in the race
}

export interface ControlEvent { time: number; kind: 'president' | 'senate' | 'house'; party: number; person: number | null; status: 1 | 0; detail: string }

/** Seats not up in this election (by party), and what a majority requires. */
export interface ChamberBase { holdovers: Record<number, number>; seats: number; majority: number }

/**
 * County races (Phase 7.6): counted and called on the night like the others, but kept apart from `races` so that the
 * broadcast, its alerts and its timeline never touch them; read on demand (rows grouped by race, `start[r]` the
 * first row of local race r).
 */
export interface LocalRaces {
  races: RecordRace[];
  rows: { batch: Int32Array; race: Int32Array; part: Int32Array; off: Int32Array; votes: Int32Array };
  start: Int32Array;
  wire: { time: Int32Array; race: Int32Array; expected: Int32Array };
  events: { time: Int32Array; race: Int32Array; status: Uint8Array; option: Int16Array; option2: Int16Array; prob: Int16Array; flags: Uint8Array };
}

export interface NightRecord {
  /** 1 = Phase 3; 2 = Phase 4 (adds part-level expected vote, survey crosstabs, alerts and commentary); 3 = Phase 7.6 (adds local races). */
  version: 1 | 2 | 3;
  day: number; lockTime: number; coverageStart: number; nightEnd: number; feedEnd: number;
  states: { stateIdx: number; electionId: number; closeFirst: number; closeLast: number; canvass: number; certify: number }[];
  races: RecordRace[];
  parts: { rj: Int32Array; cd: Int32Array; precincts: Int32Array; close: Int32Array; state: Int16Array };
  batches: { time: Int32Array; rj: Int32Array; mode: Uint8Array; flag: Uint8Array; rowStart: Int32Array; partStart: Int32Array };
  partRows: { batch: Int32Array; part: Int32Array; ballots: Int32Array; precincts: Int32Array };
  raceRows: { batch: Int32Array; race: Int32Array; part: Int32Array; off: Int32Array; votes: Int32Array };
  wire: { time: Int32Array; race: Int32Array; expected: Int32Array };
  events: { time: Int32Array; race: Int32Array; status: Uint8Array; option: Int16Array; option2: Int16Array; prob: Int16Array; flags: Uint8Array };
  control: ControlEvent[];
  chambers: { senate: ChamberBase; house: ChamberBase };
  survey: SurveyTopline[];
  /** Wire's expected ballots per part over time (version 2). */
  partWire: { time: Int32Array; part: Int32Array; expected: Int32Array };
  /** Alerts and commentary lines, built at the lock (version 2); v1 records derive them on load. */
  story: Story | null;
  /** County races (version 3). */
  local?: LocalRaces;
}

export interface StoryAlert { time: number; kind: string; race: number; importance: number; headline: string; detail: string; party: number; flip: boolean }
export interface StoryLine { time: number; speaker: number; type: string; race: number; text: string; template: string }
export interface Story { version: 1; alerts: StoryAlert[]; lines: StoryLine[]; speakers: { name: string; role: string }[] }

export interface RaceMeta { candidacyIds: number[]; parties: number[]; office: string; ev: number; label: string; /** Ranked-choice contest (Phase 7.1): without a first-choice majority it goes to the ranked-choice count, not a runoff. */ rcv?: boolean;
  /** A county race (Phase 7.6): recorded among the local races. */ local?: boolean }

/** Merge per-state nights (in state order) into one record. `meta[s][r]` describes race r of state night s. */
export function mergeNights(nights: StateNight[], meta: RaceMeta[][], electionIds: number[], times: { day: number; lockTime: number; coverageStart: number; nightEnd: number }, canvassCertify: { canvass: number; certify: number }[]): Omit<NightRecord, 'control' | 'chambers' | 'story'> {
  const partOff: number[] = [], raceOff: number[] = [];
  let np = 0, nr = 0;
  for (const n of nights) { partOff.push(np); raceOff.push(nr); np += n.parts.rj.length; nr += n.races.length; }
  const parts = { rj: new Int32Array(np), cd: new Int32Array(np), precincts: new Int32Array(np), close: new Int32Array(np), state: new Int16Array(np) };
  nights.forEach((n, s) => { parts.rj.set(n.parts.rj, partOff[s]); parts.cd.set(n.parts.cd, partOff[s]); parts.precincts.set(n.parts.precincts, partOff[s]); parts.close.set(n.parts.close, partOff[s]); parts.state.fill(n.stateIdx, partOff[s], partOff[s]! + n.parts.rj.length); });
  const allRaces: RecordRace[] = [];
  nights.forEach((n, s) => n.races.forEach((r, i) => {
    const gp = Int32Array.from(r.parts, (p) => p + partOff[s]!);
    let prec = 0, close = 0; for (const p of r.parts) { prec += n.parts.precincts[p]!; close = Math.max(close, n.parts.close[p]!); }
    const { local: _l, ...m } = meta[s]![i]!; void _l;
    allRaces.push({ contestId: r.contestId, cd: r.cd, stateIdx: n.stateIdx, k: r.k, ...m, parts: gp, precincts: prec, close });
  }));
  // County races (Phase 7.6) go to the local section: `idx[g]` is a race's index in its section.
  const isLocal = nights.flatMap((n, s) => n.races.map((_, i) => !!meta[s]![i]!.local));
  const idx = new Int32Array(allRaces.length); let nm = 0, nl = 0;
  isLocal.forEach((l, g) => { idx[g] = l ? nl++ : nm++; });
  const races = allRaces.filter((_, g) => !isLocal[g]), localRaces = allRaces.filter((_, g) => isLocal[g]);
  // Batches in global time order (stable: state order, then the state's own order).
  const all: { t: number; s: number; b: number }[] = [];
  nights.forEach((n, s) => { for (let b = 0; b < n.batches.time.length; b++) all.push({ t: n.batches.time[b]!, s, b }); });
  all.sort((x, y) => x.t - y.t || x.s - y.s || x.b - y.b);
  const nb = all.length;
  const remap = nights.map((n) => new Int32Array(n.batches.time.length));
  all.forEach((x, i) => { remap[x.s]![x.b] = i; });
  const batches = { time: new Int32Array(nb), rj: new Int32Array(nb), mode: new Uint8Array(nb), flag: new Uint8Array(nb), rowStart: new Int32Array(nb + 1), partStart: new Int32Array(nb + 1) };
  all.forEach((x, i) => { const n = nights[x.s]!; batches.time[i] = x.t; batches.rj[i] = n.batches.rj[x.b]!; batches.mode[i] = n.batches.mode[x.b]!; batches.flag[i] = n.batches.flag[x.b]!; });
  // Rows grouped by global batch.
  const pRows: [number, number, number, number][] = [];
  nights.forEach((n, s) => { for (let i = 0; i < n.partRows.batch.length; i++) pRows.push([remap[s]![n.partRows.batch[i]!]!, n.partRows.part[i]! + partOff[s]!, n.partRows.ballots[i]!, n.partRows.precincts[i]!]); });
  pRows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rRows: { b: number; race: number; part: number; s: number; src: number }[] = [], lRows: typeof rRows = [];
  const srcOff = nights.map((n) => { const o = new Int32Array(n.raceRows.race.length); let t = 0; for (let i = 0; i < o.length; i++) { o[i] = t; t += n.races[n.raceRows.race[i]!]!.k; } return o; });
  nights.forEach((n, s) => {
    for (let i = 0; i < n.raceRows.batch.length; i++) {
      const g = n.raceRows.race[i]! + raceOff[s]!;
      (isLocal[g] ? lRows : rRows).push({ b: remap[s]![n.raceRows.batch[i]!]!, race: idx[g]!, part: n.raceRows.part[i]! + partOff[s]!, s, src: i });
    }
  });
  rRows.sort((a, b) => a.b - b.b || a.race - b.race || a.part - b.part);
  lRows.sort((a, b) => a.race - b.race || a.b - b.b || a.part - b.part);
  const rowsOf = (list: typeof rRows, rs: RecordRace[]) => {
    let total = 0; for (const r of list) total += rs[r.race]!.k;
    const out = { batch: new Int32Array(list.length), race: new Int32Array(list.length), part: new Int32Array(list.length), off: new Int32Array(list.length), votes: new Int32Array(total) };
    let o = 0;
    list.forEach((r, i) => {
      const k = rs[r.race]!.k, n = nights[r.s]!;
      out.batch[i] = r.b; out.race[i] = r.race; out.part[i] = r.part; out.off[i] = o;
      out.votes.set(n.raceRows.votes.subarray(srcOff[r.s]![r.src]!, srcOff[r.s]![r.src]! + k), o); o += k;
    });
    return out;
  };
  const raceRows = rowsOf(rRows, races), localRows = rowsOf(lRows, localRaces);
  const partRows = { batch: Int32Array.from(pRows, (x) => x[0]), part: Int32Array.from(pRows, (x) => x[1]), ballots: Int32Array.from(pRows, (x) => x[2]), precincts: Int32Array.from(pRows, (x) => x[3]) };
  fillStarts(batches.rowStart, raceRows.batch, nb); fillStarts(batches.partStart, partRows.batch, nb);
  // Wire and desk events in time order.
  type W = [number, number, number]; type E = [number, number, number, number, number, number, number];
  const wireRows: W[] = [], evRows: E[] = [], lWire: W[] = [], lEv: E[] = [];
  nights.forEach((n, s) => {
    for (let i = 0; i < n.wire.time.length; i++) { const g = n.wire.race[i]! + raceOff[s]!; (isLocal[g] ? lWire : wireRows).push([n.wire.time[i]!, idx[g]!, n.wire.expected[i]!]); }
    for (let i = 0; i < n.events.time.length; i++) { const g = n.events.race[i]! + raceOff[s]!; (isLocal[g] ? lEv : evRows).push([n.events.time[i]!, idx[g]!, n.events.status[i]!, n.events.option[i]!, n.events.option2[i]!, n.events.prob[i]!, n.events.flags[i]!]); }
  });
  for (const l of [wireRows, lWire]) l.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const l of [evRows, lEv]) l.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const wireOf = (l: W[]) => ({ time: Int32Array.from(l, (x) => x[0]), race: Int32Array.from(l, (x) => x[1]), expected: Int32Array.from(l, (x) => Math.min(2147483647, x[2])) });
  const eventsOf = (l: E[]) => ({ time: Int32Array.from(l, (x) => x[0]), race: Int32Array.from(l, (x) => x[1]), status: Uint8Array.from(l, (x) => x[2]), option: Int16Array.from(l, (x) => x[3]), option2: Int16Array.from(l, (x) => x[4]), prob: Int16Array.from(l, (x) => x[5]), flags: Uint8Array.from(l, (x) => x[6]) });
  const feedEnd = nb ? batches.time[nb - 1]! : times.lockTime;
  // Survey toplines belong to statewide races (never local): their race indices move with the split.
  const survey = nights.flatMap((n, s) => n.survey.map((x) => ({ ...x, race: idx[x.race + raceOff[s]!]! })));
  return {
    version: localRaces.length ? 3 : 2, ...times, feedEnd,
    states: nights.map((n, s) => ({ stateIdx: n.stateIdx, electionId: electionIds[s]!, closeFirst: n.closeFirst, closeLast: n.closeLast, ...canvassCertify[s]! })),
    races, parts, batches, partRows, raceRows,
    wire: wireOf(wireRows), events: eventsOf(evRows), survey,
    partWire: mergePartWire(nights, partOff),
    ...(localRaces.length ? { local: { races: localRaces, rows: localRows, start: raceStarts(localRows.race, localRaces.length), wire: wireOf(lWire), events: eventsOf(lEv) } } : {}),
  };
}

/** First row of each race in rows grouped by race. */
function raceStarts(race: Int32Array, n: number): Int32Array {
  const st = new Int32Array(n + 1); let i = 0;
  for (let r = 0; r < n; r++) { st[r] = i; while (i < race.length && race[i] === r) i++; }
  st[n] = race.length;
  return st;
}

/**
 * A contest's feed in a record (main or local races): its final counted votes before provisional ballots (`rev1`,
 * with the time of its last such batch) and after (`rev2`), and whether the cumulative count ever exceeded the final.
 */
/** Each record's local races by contest (thousands a night). */
const localIndex = new WeakMap<NightRecord, Map<number, number>>();

export function contestFeed(rec: NightRecord, contestId: number, provMode: number): { k: number; rev1: number[]; rev2: number[]; t1: number; rows: number; cumOk: boolean } | null {
  const tally = (k: number, rows: Iterable<number>, rr: NightRecord['raceRows']) => {
    const rev1 = new Array<number>(k).fill(0), rev2 = new Array<number>(k).fill(0); let t1 = 0, n = 0;
    for (const i of rows) {
      const b = rr.batch[i]!, prov = rec.batches.mode[b] === provMode; n++;
      for (let j = 0; j < k; j++) { const v = rr.votes[rr.off[i]! + j]!; rev2[j]! += v; if (!prov) rev1[j]! += v; }
      if (!prov) t1 = Math.max(t1, rec.batches.time[b]!);
    }
    let cumOk = true; const cum = new Array<number>(k).fill(0);
    for (const i of rows) for (let j = 0; j < k; j++) { const v = (cum[j]! += rr.votes[rr.off[i]! + j]!); if (v < 0 || v > rev2[j]!) cumOk = false; }
    return { k, rev1, rev2, t1, rows: n, cumOk };
  };
  const ri = rec.races.findIndex((x) => x.contestId === contestId && x.cd < 0);
  if (ri >= 0) { const list: number[] = []; for (let i = 0; i < rec.raceRows.race.length; i++) if (rec.raceRows.race[i] === ri) list.push(i); return tally(rec.races[ri]!.k, list, rec.raceRows); }
  const L = rec.local; if (!L) return null;
  let idx = localIndex.get(rec); if (!idx) { idx = new Map(L.races.map((x, i) => [x.contestId, i])); localIndex.set(rec, idx); }
  const li = idx.get(contestId) ?? -1;
  if (li < 0) return null;
  const list: number[] = []; for (let i = L.start[li]!; i < L.start[li + 1]!; i++) list.push(i);
  return tally(L.races[li]!.k, list, L.rows);
}

function mergePartWire(nights: StateNight[], partOff: number[]): NightRecord['partWire'] {
  const rows: [number, number, number][] = [];
  nights.forEach((n, s) => { const w = n.partWire; if (!w) return; for (let i = 0; i < w.time.length; i++) rows.push([w.time[i]!, w.part[i]! + partOff[s]!, w.expected[i]!]); });
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { time: Int32Array.from(rows, (x) => x[0]), part: Int32Array.from(rows, (x) => x[1]), expected: Int32Array.from(rows, (x) => x[2]) };
}

function fillStarts(starts: Int32Array, rowBatch: Int32Array, nb: number): void {
  let i = 0;
  for (let b = 0; b < nb; b++) { starts[b] = i; while (i < rowBatch.length && rowBatch[i] === b) i++; }
  starts[nb] = rowBatch.length;
}

// ---- Encoding ---------------------------------------------------------------------------------------

export async function encodeNightRecord(rec: NightRecord): Promise<{ payload: Uint8Array; sha256: string }> {
  // Large row columns use the ENA1 varint codec (delta where values ascend); small ones travel as raw arrays.
  const D = ColumnTransform.Delta, Rw = ColumnTransform.Raw;
  const enc = (cols: [ArrayLike<number>, ColumnTransform][]) => encodeIntColumns(cols.map(([values, transform]) => ({ values, transform })));
  const arrays: Record<string, Int32Array | Uint8Array | Int16Array> = {
    'enc.batches': await enc([[rec.batches.time, D], [rec.batches.rj, D], [rec.batches.mode, Rw], [rec.batches.flag, Rw]]),
    'enc.partRows': await enc([[rec.partRows.batch, D], [rec.partRows.part, D], [rec.partRows.ballots, Rw], [rec.partRows.precincts, Rw]]),
    'enc.raceRows': await enc([[rec.raceRows.batch, D], [rec.raceRows.race, D], [rec.raceRows.part, D]]),
    'enc.votes': await enc([[rec.raceRows.votes, Rw]]),
    'enc.wire': await enc([[rec.wire.time, D], [rec.wire.race, D], [rec.wire.expected, D]]),
    'enc.parts': await enc([[rec.parts.rj, D], [rec.parts.cd, D], [rec.parts.precincts, Rw], [rec.parts.close, D], [rec.parts.state, D]]),
    'enc.partWire': await enc([[rec.partWire.time, D], [rec.partWire.part, Rw], [rec.partWire.expected, Rw]]),
  };
  for (const [k, v] of Object.entries(rec.events)) arrays[`events.${k}`] = v;
  const raceParts: number[] = []; const racesMeta = rec.races.map((r) => { const start = raceParts.length; raceParts.push(...r.parts); return { ...r, parts: [start, r.parts.length] }; });
  arrays['races.parts'] = Int32Array.from(raceParts);
  let localMeta: unknown = undefined;
  if (rec.local) {
    const L = rec.local;
    arrays['enc.localRows'] = await enc([[L.rows.batch, Rw], [L.rows.race, D], [L.rows.part, Rw]]);
    arrays['enc.localVotes'] = await enc([[L.rows.votes, Rw]]);
    arrays['enc.localWire'] = await enc([[L.wire.time, D], [L.wire.race, Rw], [L.wire.expected, Rw]]);
    for (const [k, v] of Object.entries(L.events)) arrays[`local.events.${k}`] = v;
    const lp: number[] = []; localMeta = L.races.map((r) => { const start = lp.length; lp.push(...r.parts); return { ...r, parts: [start, r.parts.length] }; });
    arrays['local.races.parts'] = Int32Array.from(lp);
  }
  const meta = { version: rec.version, day: rec.day, lockTime: rec.lockTime, coverageStart: rec.coverageStart, nightEnd: rec.nightEnd, feedEnd: rec.feedEnd, states: rec.states, races: racesMeta, control: rec.control, chambers: rec.chambers, survey: rec.survey, story: rec.story, localRaces: localMeta };
  const payload = await encodeBundle(arrays, meta);
  return { payload, sha256: await sha256Hex(payload) };
}

export async function decodeNightRecord(payload: Uint8Array): Promise<NightRecord> {
  const { arrays, meta } = await decodeBundle(payload);
  const m = meta as Omit<NightRecord, 'races' | 'parts' | 'batches' | 'partRows' | 'raceRows' | 'wire' | 'events' | 'local'> & { races: (Omit<RecordRace, 'parts'> & { parts: [number, number] })[]; localRaces?: (Omit<RecordRace, 'parts'> & { parts: [number, number] })[] };
  const g = <T>(k: string) => arrays[k] as unknown as T;
  const dec = async (k: string) => decodeIntColumns(arrays[k] as Uint8Array);
  const i32 = (x: Float64Array) => Int32Array.from(x), u8 = (x: Float64Array) => Uint8Array.from(x), i16 = (x: Float64Array) => Int16Array.from(x);
  const rp = g<Int32Array>('races.parts');
  const races: RecordRace[] = m.races.map((r) => ({ ...r, parts: rp.slice(r.parts[0], r.parts[0] + r.parts[1]) }));
  const [bt, brj, bm, bf] = await dec('enc.batches'), [prb, prp, prbal, prprec] = await dec('enc.partRows'), [rrb, rrr, rrp] = await dec('enc.raceRows'), [votes] = await dec('enc.votes');
  const [wt, wr, we] = await dec('enc.wire'), [prj, pcd, pprec, pclose, pst] = await dec('enc.parts');
  const pw = arrays['enc.partWire'] ? await dec('enc.partWire') : [new Float64Array(0), new Float64Array(0), new Float64Array(0)];
  const nb = bt!.length;
  const batches = { time: i32(bt!), rj: i32(brj!), mode: u8(bm!), flag: u8(bf!), rowStart: new Int32Array(nb + 1), partStart: new Int32Array(nb + 1) };
  const partRows = { batch: i32(prb!), part: i32(prp!), ballots: i32(prbal!), precincts: i32(prprec!) };
  const rr = { batch: i32(rrb!), race: i32(rrr!), part: i32(rrp!), votes: i32(votes!) };
  const off = new Int32Array(rr.race.length); let t = 0;
  for (let i = 0; i < off.length; i++) { off[i] = t; t += races[rr.race[i]!]!.k; }
  fillStarts(batches.rowStart, rr.batch, nb); fillStarts(batches.partStart, partRows.batch, nb);
  let local: LocalRaces | undefined;
  if (m.localRaces) {
    const lp = g<Int32Array>('local.races.parts');
    const lr: RecordRace[] = m.localRaces.map((r) => ({ ...r, parts: lp.slice(r.parts[0], r.parts[0] + r.parts[1]) }));
    const [lb, lrace, lpart] = await dec('enc.localRows'), [lv] = await dec('enc.localVotes'), [lwt, lwr, lwe] = await dec('enc.localWire');
    const rows = { batch: i32(lb!), race: i32(lrace!), part: i32(lpart!), votes: i32(lv!), off: new Int32Array(lb!.length) };
    let o = 0; for (let i = 0; i < rows.off.length; i++) { rows.off[i] = o; o += lr[rows.race[i]!]!.k; }
    local = { races: lr, rows, start: raceStarts(rows.race, lr.length), wire: { time: i32(lwt!), race: i32(lwr!), expected: i32(lwe!) },
      events: { time: g('local.events.time'), race: g('local.events.race'), status: g('local.events.status'), option: g('local.events.option'), option2: g('local.events.option2'), prob: g('local.events.prob'), flags: g('local.events.flags') } };
  }
  return {
    ...(local ? { local } : {}),
    version: m.version === 3 ? 3 : m.version === 2 ? 2 : 1, day: m.day, lockTime: m.lockTime, coverageStart: m.coverageStart, nightEnd: m.nightEnd, feedEnd: m.feedEnd, states: m.states, races, control: m.control, chambers: m.chambers, survey: m.survey,
    partWire: { time: i32(pw[0]!), part: i32(pw[1]!), expected: i32(pw[2]!) }, story: m.story ?? null,
    parts: { rj: i32(prj!), cd: i32(pcd!), precincts: i32(pprec!), close: i32(pclose!), state: i16(pst!) },
    batches, partRows, raceRows: { ...rr, off },
    wire: { time: i32(wt!), race: i32(wr!), expected: i32(we!) },
    events: { time: g('events.time'), race: g('events.race'), status: g('events.status'), option: g('events.option'), option2: g('events.option2'), prob: g('events.prob'), flags: g('events.flags') },
  };
}
