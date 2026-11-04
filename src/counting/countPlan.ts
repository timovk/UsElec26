/**
 * Count-plan builder (docs/architecture/08-election-night.md §8.3).
 *
 * Two strictly separated steps:
 *  1. `planSchedule` decides *when* ballots are counted: precinct completion and reporting cadence for
 *     Election Day, early-vote and mail releases, post-night mail processing, late mail, provisional
 *     adjudication and rejected ballots. It sees ballot counts by mode and timing covariates only — never
 *     a vote, a candidate or a margin — so leads and reversals can only emerge from geography, modes and law.
 *  2. `partitionVotes` splits every (unit, mode) cell's votes across that cell's chunks by multivariate
 *     hypergeometric sampling, so batches partition the cast ballots exactly.
 */
import { Rng } from '../core/rng';
import { MINUTES_PER_DAY } from '../core/time';
import type { CountingRules } from '../rules/counting2016';
import { FLAG_CORRECTION, FLAG_GLITCH, FLAG_NORMAL, MODE_EARLY, MODE_ED, MODE_MAIL, MODE_PROV } from './types';
import type { Precincts, Parts } from './precincts';

const N_MODES = 4;

export interface RjProfile { edSpeed: number; cadence: number; dump: boolean; firstPush: number; mailHours: number; glitch: number; lineRate: number }

/** Persistent administrative profile of a reporting jurisdiction (keyed by universe seed and jurisdiction). */
export function rjProfile(seed: string, rj: number, ballots: number): RjProfile {
  const r = Rng.stream(seed, 'rj-profile', rj);
  const big = Math.log2(1 + ballots / 20000);
  const dump = r.bernoulli(ballots < 20000 ? 0.3 : 0.1);
  return {
    edSpeed: Math.exp(r.normal(0, 0.3)),
    cadence: dump ? r.range(50, 130) : ballots < 20000 ? r.range(15, 45) : r.range(6, 20),
    dump,
    firstPush: r.range(10, 40),
    mailHours: Math.exp(r.normal(Math.log(1.2 + 0.7 * big), 0.4)),
    glitch: 0.0005 + 0.0008 * big,
    lineRate: 0.03 + 0.05 * Math.min(1, big / 4),
  };
}

export interface ScheduleInput {
  seed: string; key: string;
  rjFirst: number; rjCount: number;
  rj: ArrayLike<number>;              // per unit, global RJ
  close: ArrayLike<number>;           // per unit poll closing (UTC minutes)
  young: ArrayLike<number>;           // per unit share aged 18–29 (late-returning mail)
  ballotsByMode: ArrayLike<number>;   // units × 4
  rjOffset: ArrayLike<number>;        // per RJ local: UTC offset (minutes)
  parts: Parts; precincts: Precincts;
  rules: CountingRules; mailReject: number; provReject: number;
}

export interface Schedule {
  batchTime: number[]; batchRj: number[]; batchMode: number[]; batchFlag: number[];
  /** Chunks of each (unit, mode) cell in counting order; batch −1 = rejected (never counted). */
  cells: Map<number, { batch: number; n: number }[]>;
  /** Per batch: part → [ballots, precincts completed]. */
  partRows: Map<number, Map<number, [number, number]>>;
  /** Glitch batches and the correction batch that repairs each. */
  glitches: { batch: number; correction: number }[];
  /** Per unit with mail: [rejected, late, received on Election Day, received earlier]. */
  mailSplit: Map<number, [number, number, number, number]>;
}

/**
 * Ticks of a processing stream that needs `minutes` of work from `start`. On election night it runs until
 * 03:00 local, publishing at the jurisdiction's cadence; on later days offices work 09:00–18:00 and publish
 * one update each afternoon.
 */
function stream(start: number, minutes: number, cadence: number, offset: number, r: Rng): { time: number; frac: number }[] {
  if (minutes <= 0) return [{ time: Math.round(start), frac: 1 }];
  const out: { time: number; frac: number }[] = [];
  const dayOf = (t: number) => Math.floor((t + offset) / MINUTES_PER_DAY);
  const hourOf = (t: number) => (t + offset - dayOf(t) * MINUTES_PER_DAY) / 60;
  const at = (day: number, h: number) => day * MINUTES_PER_DAY + h * 60 - offset;
  let t = start, night = true;
  const h0 = hourOf(t);
  let end: number;
  if (h0 >= 17) end = at(dayOf(t) + 1, 3);
  else if (h0 < 3) end = at(dayOf(t), 3);
  else { night = false; if (h0 < 9) t = at(dayOf(t), 9); end = at(dayOf(t), 18); }
  let done = 0;
  for (let guard = 0; done < minutes && guard < 120; guard++) {
    const step = night ? cadence : (end - t);
    while (done < minutes && t < end - 0.5) {
      const stop = Math.min(t + step * (night ? r.range(0.8, 1.2) : 1), end);
      const work = Math.min(minutes - done, stop - t);
      done += work; t += work;
      out.push({ time: Math.round(night ? t : end - r.range(0, 90)), frac: work / minutes });
    }
    if (done >= minutes) break;
    t = at(dayOf(end) + (hourOf(end) >= 9 ? 1 : 0), 9); end = at(dayOf(t), 18); night = false;
  }
  if (done < minutes) out[out.length - 1]!.frac += (minutes - done) / minutes;
  // Merge ticks published at the same minute.
  const merged: typeof out = [];
  for (const x of out) { const last = merged[merged.length - 1]; if (last && last.time >= x.time) last.frac += x.frac; else merged.push({ ...x }); }
  return merged;
}

/** Local 17:00 on day `d` after Election Day (`edLocalDay` = local day number of Election Day). */
const localAfternoon = (edLocalDay: number, d: number, offset: number) => (edLocalDay + d) * MINUTES_PER_DAY + 17 * 60 - offset;

export function planSchedule(inp: ScheduleInput): Schedule {
  const n = inp.rj.length;
  const sch: Schedule = { batchTime: [], batchRj: [], batchMode: [], batchFlag: [], cells: new Map(), partRows: new Map(), glitches: [], mailSplit: new Map() };
  const newBatch = (time: number, rjLocal: number, mode: number, flag = FLAG_NORMAL) => {
    sch.batchTime.push(Math.round(time)); sch.batchRj.push(rjLocal); sch.batchMode.push(mode); sch.batchFlag.push(flag);
    return sch.batchTime.length - 1;
  };
  const addChunk = (unit: number, mode: number, batch: number, cnt: number) => {
    if (cnt <= 0) return;
    const key = unit * N_MODES + mode;
    let l = sch.cells.get(key); if (!l) { l = []; sch.cells.set(key, l); }
    const last = l[l.length - 1];
    if (last && last.batch === batch) last.n += cnt; else l.push({ batch, n: cnt });
    if (batch < 0) return;
    let pr = sch.partRows.get(batch); if (!pr) { pr = new Map(); sch.partRows.set(batch, pr); }
    const p = inp.parts.of[unit]!; const v = pr.get(p) ?? [0, 0]; v[0] += cnt; pr.set(p, v);
  };
  const addPrecinct = (batch: number, part: number) => {
    let pr = sch.partRows.get(batch); if (!pr) { pr = new Map(); sch.partRows.set(batch, pr); }
    const v = pr.get(part) ?? [0, 0]; v[1] += 1; pr.set(part, v);
  };

  // Units by reporting jurisdiction.
  const byRj: number[][] = Array.from({ length: inp.rjCount }, () => []);
  for (let i = 0; i < n; i++) byRj[inp.rj[i]! - inp.rjFirst]!.push(i);
  const bm = (i: number, m: number) => inp.ballotsByMode[i * N_MODES + m]!;
  const R = inp.rules;

  for (let lr = 0; lr < inp.rjCount; lr++) {
    const units = byRj[lr]!; if (!units.length) continue;
    const rjGlobal = inp.rjFirst + lr, offset = inp.rjOffset[lr]!;
    let V = 0, firstClose = Infinity, lastClose = -Infinity;
    for (const i of units) { for (let m = 0; m < N_MODES; m++) V += bm(i, m); if (inp.close[i]! < firstClose) firstClose = inp.close[i]!; if (inp.close[i]! > lastClose) lastClose = inp.close[i]!; }
    if (V === 0 && !units.some((i) => inp.precincts.of[i]! >= 0)) continue;
    const prof = rjProfile(inp.seed, rjGlobal, V);
    const r = Rng.stream(inp.key, 'schedule', rjGlobal);
    const edLocalDay = Math.floor((firstClose + offset) / MINUTES_PER_DAY);

    // 1. Election Day: precincts complete, the jurisdiction pushes at its cadence.
    const prec = new Map<number, { units: number[]; ed: number; close: number }>();
    for (const i of units) {
      const p = inp.precincts.of[i]!; if (p < 0) continue;
      let e = prec.get(p); if (!e) { e = { units: [], ed: 0, close: -Infinity }; prec.set(p, e); }
      e.units.push(i); e.ed += bm(i, MODE_ED); if (inp.close[i]! > e.close) e.close = inp.close[i]!;
    }
    const median = (24 + 15 * Math.log2(1 + V / 20000)) * prof.edSpeed;
    const done = [...prec.entries()].sort((a, b) => a[0] - b[0]).map(([p, e]) => {
      let d = median * Math.exp(r.normal(0, 0.55)) * (1 + 0.1 * Math.log2(1 + e.ed / 700));
      if (r.bernoulli(prof.lineRate)) d += r.range(10, 90);         // voters still in line at closing time
      return { p, e, t: e.close + Math.min(d, 8 * 60) };
    }).sort((a, b) => a.t - b.t || a.p - b.p);
    let tick = firstClose + prof.firstPush, k = 0, firstEdTick = -1;
    while (k < done.length) {
      const batchItems: typeof done = [];
      while (k < done.length && done[k]!.t <= tick) batchItems.push(done[k++]!);
      if (batchItems.length) {
        const b = newBatch(tick, lr, MODE_ED);
        if (firstEdTick < 0) firstEdTick = tick;
        for (const it of batchItems) { addPrecinct(b, inp.parts.of[it.e.units[0]!]!); for (const i of it.e.units) addChunk(i, MODE_ED, b, bm(i, MODE_ED)); }
      }
      tick += prof.cadence * r.range(0.8, 1.2);
    }
    const firstRelease = prof.dump && firstEdTick > 0 ? firstEdTick : firstClose + r.range(1, 25);

    // 2. Early in person: tabulated in advance, released shortly after the polls close.
    if (units.some((i) => bm(i, MODE_EARLY) > 0)) {
      const b = newBatch(firstRelease, lr, MODE_EARLY);
      for (const i of units) addChunk(i, MODE_EARLY, b, bm(i, MODE_EARLY));
    }

    // 3. Mail: split each unit's mail into rejected / late / received on Election Day / received earlier.
    const mail = new Map<number, [number, number, number, number]>();
    let early = 0, edRecv = 0, late = 0;
    for (const i of units) {
      const M = bm(i, MODE_MAIL); if (!M) continue;
      const y = inp.young[i]!;
      const pRej = inp.mailReject * (0.7 + 1.5 * y), pLate = R.latePostmarkDays > 0 ? R.lateShare * (0.6 + 2 * y) : 0, pEd = R.edMailShare * (0.7 + 1.5 * y);
      const parts = r.multinomial(M, [pRej, pLate, pEd, Math.max(0, 1 - pRej - pLate - pEd)], new Int32Array(4));
      mail.set(i, [parts[0]!, parts[1]!, parts[2]!, parts[3]!]); sch.mailSplit.set(i, [parts[0]!, parts[1]!, parts[2]!, parts[3]!]);
      late += parts[1]!; edRecv += parts[2]!; early += parts[3]!;
      addChunk(i, MODE_MAIL, -1, parts[0]!);
    }
    // Units in counting order: older, earlier-returning areas first (with noise).
    const order = [...mail.keys()].map((i) => ({ i, key: inp.young[i]! + r.normal(0, 0.04) })).sort((a, b) => a.key - b.key || a.i - b.i).map((x) => x.i);
    const fill = (ticks: { time: number; frac: number }[], idx: 1 | 2 | 3, total: number) => {
      if (!total || !ticks.length) return;
      const batches = ticks.map((t) => newBatch(t.time, lr, MODE_MAIL));
      let cum = 0; const caps = ticks.map((t) => { cum += t.frac; return Math.round(cum * total); });
      caps[caps.length - 1] = total;
      let bIdx = 0, used = 0;
      for (const i of order) {
        let left = mail.get(i)![idx];
        while (left > 0) {
          while (bIdx < caps.length - 1 && used >= caps[bIdx]!) bIdx++;
          const room = bIdx === caps.length - 1 ? left : Math.min(left, caps[bIdx]! - used);
          addChunk(i, MODE_MAIL, batches[bIdx]!, room); used += room; left -= room;
        }
      }
    };
    const hours = prof.mailHours * (1 + 0.3 * Math.log2(1 + (early + edRecv) / 5000));
    if (R.mailPreprocess) fill([{ time: Math.round(firstRelease + r.range(0, 10)), frac: 1 }], 3, early);
    else fill(stream(lastClose + r.range(5, 40), hours * 60, Math.max(prof.cadence, 20), offset, r), 3, early);
    const edStart = R.mailPreprocess ? firstRelease + r.range(60, 150) : lastClose + hours * 60 + r.range(30, 90);
    fill(stream(edStart, prof.mailHours * R.slow * (1 + Math.log2(1 + edRecv / 5000)) * r.range(0.7, 1.3) * 60, Math.max(prof.cadence, 30), offset, r), 2, edRecv);
    if (late > 0) {
      const days = R.latePostmarkDays + 3, w: number[] = [];
      for (let d = 1; d <= days; d++) w.push(Math.exp(-d / (1 + R.latePostmarkDays / 3)));
      const sw = w.reduce((a, b) => a + b, 0);
      fill(w.map((x, d) => ({ time: localAfternoon(edLocalDay, d + 1, offset) + Math.round(r.range(-60, 60)), frac: x / sw })), 1, late);
    }

    // 4. Provisional ballots: adjudicated during the canvass; rejected ones are never counted.
    if (units.some((i) => bm(i, MODE_PROV) > 0)) {
      const day = Math.max(2, Math.round(R.canvassDays * r.range(0.5, 1)));
      const b = newBatch(localAfternoon(edLocalDay, day, offset) + Math.round(r.range(-90, 60)), lr, MODE_PROV);
      for (const i of units) {
        const P = bm(i, MODE_PROV); if (!P) continue;
        const acc = r.binomial(P, 1 - inp.provReject);
        addChunk(i, MODE_PROV, -1, P - acc); addChunk(i, MODE_PROV, b, acc);
      }
    }

    // 5. A rare reporting glitch: an Election-Day batch published short, corrected later.
    if (r.bernoulli(prof.glitch)) {
      const cands = sch.batchTime.map((_, b) => b).filter((b) => sch.batchRj[b] === lr && sch.batchMode[b] === MODE_ED && [...(sch.partRows.get(b)?.values() ?? [])].reduce((a, v) => a + v[0], 0) >= 300);
      if (cands.length) {
        const g = cands[r.int(cands.length)]!;
        sch.batchFlag[g] = FLAG_GLITCH;
        const c = newBatch(sch.batchTime[g]! + r.range(20, 180), lr, MODE_ED, FLAG_CORRECTION);
        sch.glitches.push({ batch: g, correction: c });
      }
    }
  }
  return sch;
}

export interface RaceSpec { contest: number; cd: number; k: number }
export interface ContestCells { units: Int32Array; votesByMode: Int32Array }

export interface Partition {
  /** (batch, race, part) → K votes. */
  rows: Map<number, Int32Array>;
  rejected: Int32Array[];
  rejectedUnits: { units: number[]; modes: number[]; votes: number[] }[];
  key: (batch: number, race: number, part: number) => number;
  unkey: (key: number) => [number, number, number];
}

/** Split every cell's votes across its chunks (multivariate hypergeometric), race by race. */
export function partitionVotes(sch: Schedule, races: RaceSpec[], contests: ContestCells[], unitStart: number, unitCd: ArrayLike<number>, parts: Parts, key: string): Partition {
  const R = races.length, P = parts.count;
  const keyOf = (b: number, race: number, part: number) => (b * R + race) * P + part;
  const unkey = (x: number): [number, number, number] => { const part = x % P, y = (x - part) / P, race = y % R; return [(y - race) / R, race, part]; };
  const rows = new Map<number, Int32Array>();
  const rejected = races.map((rc) => new Int32Array(rc.k));
  const rejectedUnits = races.map(() => ({ units: [] as number[], modes: [] as number[], votes: [] as number[] }));
  const r = Rng.stream(key, 'partition');
  races.forEach((rc, ri) => {
    const c = contests[rc.contest]!; const K = rc.k;
    const rem = new Int32Array(K), draw = new Int32Array(K);
    for (let u = 0; u < c.units.length; u++) {
      const i = c.units[u]! - unitStart;
      if (rc.cd >= 0 && unitCd[i] !== rc.cd) continue;
      const part = parts.of[i]!;
      for (let m = 0; m < N_MODES; m++) {
        let rejRow: Int32Array | null = null;
        const chunks = sch.cells.get(i * N_MODES + m); if (!chunks) continue;
        const base = (u * N_MODES + m) * K;
        for (let j = 0; j < K; j++) rem[j] = c.votesByMode[base + j]!;
        for (let q = 0; q < chunks.length; q++) {
          const ch = chunks[q]!;
          if (q === chunks.length - 1) draw.set(rem); else r.mvHypergeometric(rem, ch.n, draw);
          for (let j = 0; j < K; j++) rem[j]! -= draw[j]!;
          if (ch.batch < 0) {
            if (!rejRow) rejRow = new Int32Array(K);
            for (let j = 0; j < K; j++) { rejected[ri]![j]! += draw[j]!; rejRow[j]! += draw[j]!; }
            continue;
          }
          const kk = keyOf(ch.batch, ri, part);
          let row = rows.get(kk); if (!row) { row = new Int32Array(K); rows.set(kk, row); }
          for (let j = 0; j < K; j++) row[j]! += draw[j]!;
        }
        if (rejRow) { const ru = rejectedUnits[ri]!; ru.units.push(c.units[u]!); ru.modes.push(m); for (let j = 0; j < K; j++) ru.votes.push(rejRow[j]!); }
      }
    }
  });
  // Glitches: one candidate's votes in one row of the glitch batch are published short and restored by the correction.
  const g = Rng.stream(key, 'glitch');
  for (const { batch, correction } of sch.glitches) {
    const keys = [...rows.keys()].filter((x) => unkey(x)[0] === batch).sort((a, b) => a - b);
    if (!keys.length) continue;
    const kk = keys[0]!; const [, race, part] = unkey(kk); const row = rows.get(kk)!; const K = races[race]!.k;
    const opts = Array.from({ length: K - 1 }, (_, j) => j).filter((j) => row[j]! > 0);
    if (!opts.length) continue;
    const j = opts[g.int(opts.length)]!, e = Math.floor(row[j]! * g.range(0.3, 1));
    if (e <= 0) continue;
    row[j]! -= e;
    const fix = new Int32Array(K); fix[j] = e; rows.set(keyOf(correction, race, part), fix);
  }
  return { rows, rejected, rejectedUnits, key: keyOf, unkey };
}
