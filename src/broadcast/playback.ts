/**
 * Playback of a Night Record (docs/architecture/08 §8.7). The state at time t is a pure function of the
 * record: cumulative feed up to t, desk statuses and expected vote at t, control projections up to t.
 * Seeking uses checkpoints of cumulative counts every 1,000 batches plus binary search.
 */
import type { ControlEvent, NightRecord } from '../counting/record';
import { ST_CALLED, ST_NONE } from '../counting/types';

export interface RaceState {
  votes: Float64Array;       // counted votes per option incl. undervote (K)
  ballots: number; precincts: number; expected: number;
  status: number; option: number; option2: number; prob: number; calledAt: number; pollClose: boolean;
}

export interface Snapshot {
  t: number;
  races: RaceState[];
  president: { called: Record<number, number>; leading: Record<number, number> };
  senate: { called: Record<number, number>; leading: Record<number, number> };
  house: { called: Record<number, number>; leading: Record<number, number> };
  control: ControlEvent[];
}

const CHECK = 1000;

export interface RaceDetail {
  batches: { time: number; rj: number; mode: number; votes: number[] }[];
  byMode: number[][];
  events: { time: number; status: number; option: number; prob: number; ballots: number; expected: number }[];
  history: { time: number; ballots: number; votes: number[] }[];
}

export class Playback {
  private offs: Int32Array;               // per race: offset into the flat vote array
  private width: number;
  private checkpoints: { batch: number; votes: Float64Array; precincts: Float64Array }[] = [];
  private racesOfPart: number[][];
  private eventsByRace: number[][];
  private wireByRace: number[][];
  private wireByPart: number[][];

  constructor(readonly rec: NightRecord) {
    const R = rec.races.length;
    this.offs = new Int32Array(R + 1);
    for (let r = 0; r < R; r++) this.offs[r + 1] = this.offs[r]! + rec.races[r]!.k;
    this.width = this.offs[R]!;
    this.racesOfPart = Array.from({ length: rec.parts.rj.length }, () => []);
    rec.races.forEach((race, r) => { for (const p of race.parts) this.racesOfPart[p]!.push(r); });
    this.eventsByRace = Array.from({ length: R }, () => []);
    for (let i = 0; i < rec.events.time.length; i++) this.eventsByRace[rec.events.race[i]!]!.push(i);
    this.wireByRace = Array.from({ length: R }, () => []);
    for (let i = 0; i < rec.wire.time.length; i++) this.wireByRace[rec.wire.race[i]!]!.push(i);
    this.wireByPart = Array.from({ length: rec.parts.rj.length }, () => []);
    for (let i = 0; i < rec.partWire.time.length; i++) this.wireByPart[rec.partWire.part[i]!]!.push(i);
    // Checkpoints of cumulative votes and precincts.
    const votes = new Float64Array(this.width), prec = new Float64Array(R);
    const nb = rec.batches.time.length;
    this.checkpoints.push({ batch: 0, votes: votes.slice(), precincts: prec.slice() });
    for (let b = 0; b < nb; b++) {
      this.applyBatch(b, votes, prec);
      if ((b + 1) % CHECK === 0) this.checkpoints.push({ batch: b + 1, votes: votes.slice(), precincts: prec.slice() });
    }
  }

  get raceCount(): number { return this.rec.races.length; }

  private applyBatch(b: number, votes: Float64Array, prec: Float64Array): void {
    const rr = this.rec.raceRows, pr = this.rec.partRows;
    for (let i = this.rec.batches.rowStart[b]!; i < this.rec.batches.rowStart[b + 1]!; i++) {
      const r = rr.race[i]!, k = this.rec.races[r]!.k, o = this.offs[r]!, src = rr.off[i]!;
      for (let j = 0; j < k; j++) votes[o + j]! += rr.votes[src + j]!;
    }
    for (let i = this.rec.batches.partStart[b]!; i < this.rec.batches.partStart[b + 1]!; i++) {
      const n = pr.precincts[i]!; if (!n) continue;
      for (const r of this.racesOfPart[pr.part[i]!]!) prec[r]! += n;
    }
  }

  /** Index of the first batch with time > t. */
  batchesUpTo(t: number): number {
    const a = this.rec.batches.time; let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= t) lo = m + 1; else hi = m; }
    return lo;
  }

  private lastAtOrBefore(idx: number[], times: Int32Array, t: number): number {
    let lo = 0, hi = idx.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (times[idx[m]!]! <= t) lo = m + 1; else hi = m; }
    return lo - 1;
  }

  at(t: number): Snapshot {
    const end = this.batchesUpTo(t);
    const cp = this.checkpoints[Math.min(Math.floor(end / CHECK), this.checkpoints.length - 1)]!;
    const votes = cp.votes.slice(), prec = cp.precincts.slice();
    for (let b = cp.batch; b < end; b++) this.applyBatch(b, votes, prec);
    const ev = this.rec.events, wire = this.rec.wire;
    const races: RaceState[] = this.rec.races.map((race, r) => {
      const v = votes.subarray(this.offs[r]!, this.offs[r + 1]!);
      let ballots = 0; for (let j = 0; j < race.k; j++) ballots += v[j]!;
      const ei = this.lastAtOrBefore(this.eventsByRace[r]!, ev.time, t);
      const wi = this.lastAtOrBefore(this.wireByRace[r]!, wire.time, t);
      let calledAt = -1;
      if (ei >= 0) { const id = this.eventsByRace[r]![ei]!; if (ev.status[id] === ST_CALLED) calledAt = ev.time[id]!; }
      const id = ei >= 0 ? this.eventsByRace[r]![ei]! : -1;
      return {
        votes: Float64Array.from(v), ballots, precincts: prec[r]!, expected: wi >= 0 ? wire.expected[this.wireByRace[r]![wi]!]! : 0,
        status: id >= 0 ? ev.status[id]! : ST_NONE, option: id >= 0 ? ev.option[id]! : -1, option2: id >= 0 ? ev.option2[id]! : -1,
        prob: id >= 0 ? ev.prob[id]! / 10000 : 0, calledAt, pollClose: id >= 0 && (ev.flags[id]! & 1) === 1 && ev.status[id] === ST_CALLED,
      };
    });
    const tally = () => ({ called: {} as Record<number, number>, leading: {} as Record<number, number> });
    const president = tally(), senate = tally(), house = tally();
    this.rec.races.forEach((race, r) => {
      const st = races[r]!;
      const target = race.office === 'president' ? president : race.office === 'us_senator' ? senate : race.office === 'us_representative' ? house : null;
      if (!target) return;
      const w = race.office === 'president' ? race.ev : 1;
      if (!w) return;
      if (st.status === ST_CALLED && st.option >= 0) { const p = race.parties[st.option]!; target.called[p] = (target.called[p] ?? 0) + w; return; }
      // Leading: the option ahead in the count so far.
      let best = -1, bv = 0; for (let j = 0; j < race.k - 1; j++) if (st.votes[j]! > bv) { bv = st.votes[j]!; best = j; }
      if (best >= 0) { const p = race.parties[best]!; target.leading[p] = (target.leading[p] ?? 0) + w; }
    });
    const control = this.rec.control.filter((c) => c.time <= t);
    return { t, races, president, senate, house, control };
  }

  /** Counted votes of one race by reporting jurisdiction up to t (for county tables and maps). */
  raceByRj(r: number, t: number): Map<number, Float64Array> {
    const out = new Map<number, Float64Array>(), end = this.batchesUpTo(t), k = this.rec.races[r]!.k;
    const rr = this.rec.raceRows;
    for (let b = 0; b < end; b++) {
      for (let i = this.rec.batches.rowStart[b]!; i < this.rec.batches.rowStart[b + 1]!; i++) {
        if (rr.race[i] !== r) continue;
        const rj = this.rec.parts.rj[rr.part[i]!]!;
        let v = out.get(rj); if (!v) { v = new Float64Array(k); out.set(rj, v); }
        for (let j = 0; j < k; j++) v[j]! += rr.votes[rr.off[i]! + j]!;
      }
    }
    return out;
  }

  /** The wire's expected ballots of one race by reporting jurisdiction at t (records without part-level wire: empty). */
  rjExpected(r: number, t: number): Map<number, number> {
    const out = new Map<number, number>(), pw = this.rec.partWire;
    for (const p of this.rec.races[r]!.parts) {
      const idx = this.wireByPart[p]!; const i = this.lastAtOrBefore(idx, pw.time, t);
      if (i < 0) continue;
      const rj = this.rec.parts.rj[p]!;
      out.set(rj, (out.get(rj) ?? 0) + pw.expected[idx[i]!]!);
    }
    return out;
  }

  /** Counted votes of one race by part (reporting jurisdiction × district) up to t. */
  raceByPart(r: number, t: number): Map<number, Float64Array> {
    const out = new Map<number, Float64Array>(), end = this.batchesUpTo(t), k = this.rec.races[r]!.k;
    const rr = this.rec.raceRows;
    for (let b = 0; b < end; b++) for (let i = this.rec.batches.rowStart[b]!; i < this.rec.batches.rowStart[b + 1]!; i++) {
      if (rr.race[i] !== r) continue;
      let v = out.get(rr.part[i]!); if (!v) { v = new Float64Array(k); out.set(rr.part[i]!, v); }
      for (let j = 0; j < k; j++) v[j]! += rr.votes[rr.off[i]! + j]!;
    }
    return out;
  }

  /**
   * One race in detail up to t (Analyst Mode): its batches (latest first, at most `limit`), votes by voting
   * mode, and the desk's status changes with the share of the expected vote counted at each.
   */
  raceDetail(r: number, t: number, limit = 300): RaceDetail {
    const race = this.rec.races[r]!, k = race.k, rr = this.rec.raceRows, B = this.rec.batches;
    const end = this.batchesUpTo(t);
    const byMode = Array.from({ length: 4 }, () => new Array<number>(k).fill(0));
    const batches: RaceDetail['batches'] = [];
    const evIdx = this.eventsByRace[r]!, ev = this.rec.events;
    const events: RaceDetail['events'] = [];
    let ei = 0, cum = 0;
    const totals = new Array<number>(k).fill(0), hist: RaceDetail['history'] = [];
    const flushEvents = (upTo: number) => {
      while (ei < evIdx.length && ev.time[evIdx[ei]!]! <= upTo && ev.time[evIdx[ei]!]! <= t) {
        const id = evIdx[ei]!, wi = this.lastAtOrBefore(this.wireByRace[r]!, this.rec.wire.time, ev.time[id]!);
        events.push({ time: ev.time[id]!, status: ev.status[id]!, option: ev.option[id]!, prob: ev.prob[id]! / 10000, ballots: cum, expected: wi >= 0 ? this.rec.wire.expected[this.wireByRace[r]![wi]!]! : 0 });
        ei++;
      }
    };
    for (let b = 0; b < end; b++) {
      flushEvents(B.time[b]! - 1);
      let row: { time: number; rj: number; mode: number; votes: number[] } | null = null;
      for (let i = B.rowStart[b]!; i < B.rowStart[b + 1]!; i++) {
        if (rr.race[i] !== r) continue;
        if (!row) row = { time: B.time[b]!, rj: B.rj[b]!, mode: B.mode[b]!, votes: new Array<number>(k).fill(0) };
        for (let j = 0; j < k; j++) { const v = rr.votes[rr.off[i]! + j]!; row.votes[j]! += v; byMode[B.mode[b]!]![j]! += v; cum += v; }
      }
      if (row) {
        batches.push(row); if (batches.length > limit * 2) batches.splice(0, batches.length - limit);
        for (let j = 0; j < k; j++) totals[j]! += row.votes[j]!;
        const last = hist[hist.length - 1];
        if (last && last.time === row.time) { last.ballots = cum; last.votes = totals.slice(); } else hist.push({ time: row.time, ballots: cum, votes: totals.slice() });
      }
    }
    flushEvents(t);
    // The count's history, thinned to at most 400 points (keeping the latest).
    const step = Math.max(1, Math.ceil(hist.length / 400));
    const history = hist.filter((_, i) => i % step === 0 || i === hist.length - 1);
    return { batches: batches.slice(-limit).reverse(), byMode, events, history };
  }

  // ---- County races (Phase 7.6): the record's local races, read on demand ----------------------------------

  get localCount(): number { return this.rec.local?.races.length ?? 0; }
  private localByContest: Map<number, number> | null = null;
  /** The local race counting a contest (−1: none). */
  localOf(contestId: number): number {
    if (!this.localByContest) this.localByContest = new Map((this.rec.local?.races ?? []).map((r, i) => [r.contestId, i]));
    return this.localByContest.get(contestId) ?? -1;
  }
  private localEvents: number[][] | null = null;
  private localWire: number[][] | null = null;
  private partRowIdx: number[][] | null = null;
  private localIndex(): void {
    if (this.localEvents) return;
    const L = this.rec.local!, R = L.races.length;
    this.localEvents = Array.from({ length: R }, () => []); for (let i = 0; i < L.events.time.length; i++) this.localEvents[L.events.race[i]!]!.push(i);
    this.localWire = Array.from({ length: R }, () => []); for (let i = 0; i < L.wire.time.length; i++) this.localWire[L.wire.race[i]!]!.push(i);
    this.partRowIdx = Array.from({ length: this.rec.parts.rj.length }, () => []);
    for (let i = 0; i < this.rec.partRows.part.length; i++) this.partRowIdx[this.rec.partRows.part[i]!]!.push(i);
  }

  /** A county race's state at t: votes counted, precincts reporting, expected vote and the desk's status. */
  localState(r: number, t: number): RaceState {
    this.localIndex();
    const L = this.rec.local!, race = L.races[r]!, k = race.k, end = this.batchesUpTo(t);
    const votes = new Float64Array(k);
    for (let i = L.start[r]!; i < L.start[r + 1]!; i++) { if (L.rows.batch[i]! >= end) break; for (let j = 0; j < k; j++) votes[j]! += L.rows.votes[L.rows.off[i]! + j]!; }
    let ballots = 0; for (let j = 0; j < k; j++) ballots += votes[j]!;
    let precincts = 0;
    for (const p of race.parts) for (const i of this.partRowIdx![p]!) if (this.rec.partRows.batch[i]! < end) precincts += this.rec.partRows.precincts[i]!;
    const ev = L.events, ei = this.lastAtOrBefore(this.localEvents![r]!, ev.time, t), id = ei >= 0 ? this.localEvents![r]![ei]! : -1;
    const wi = this.lastAtOrBefore(this.localWire![r]!, L.wire.time, t);
    const calledAt = id >= 0 && ev.status[id] === ST_CALLED ? ev.time[id]! : -1;
    return {
      votes, ballots, precincts, expected: wi >= 0 ? L.wire.expected[this.localWire![r]![wi]!]! : 0,
      status: id >= 0 ? ev.status[id]! : ST_NONE, option: id >= 0 ? ev.option[id]! : -1, option2: id >= 0 ? ev.option2[id]! : -1,
      prob: id >= 0 ? ev.prob[id]! / 10000 : 0, calledAt, pollClose: id >= 0 && (ev.flags[id]! & 1) === 1 && ev.status[id] === ST_CALLED,
    };
  }

  /** A county race's counted votes by reporting jurisdiction up to t. */
  localByRj(r: number, t: number): Map<number, Float64Array> {
    const L = this.rec.local!, k = L.races[r]!.k, end = this.batchesUpTo(t), out = new Map<number, Float64Array>();
    for (let i = L.start[r]!; i < L.start[r + 1]!; i++) {
      if (L.rows.batch[i]! >= end) break;
      const rj = this.rec.parts.rj[L.rows.part[i]!]!;
      let v = out.get(rj); if (!v) { v = new Float64Array(k); out.set(rj, v); }
      for (let j = 0; j < k; j++) v[j]! += L.rows.votes[L.rows.off[i]! + j]!;
    }
    return out;
  }

  /** One county race in detail up to t (Analyst Mode), as `raceDetail`. */
  localDetail(r: number, t: number, limit = 300): RaceDetail {
    this.localIndex();
    const L = this.rec.local!, k = L.races[r]!.k, B = this.rec.batches, end = this.batchesUpTo(t);
    const byMode = Array.from({ length: 4 }, () => new Array<number>(k).fill(0));
    const batches: RaceDetail['batches'] = [], hist: RaceDetail['history'] = [], totals = new Array<number>(k).fill(0);
    let cum = 0;
    for (let i = L.start[r]!; i < L.start[r + 1]!; i++) {
      const b = L.rows.batch[i]!; if (b >= end) break;
      const row = { time: B.time[b]!, rj: B.rj[b]!, mode: B.mode[b]!, votes: new Array<number>(k).fill(0) };
      for (let j = 0; j < k; j++) { const v = L.rows.votes[L.rows.off[i]! + j]!; row.votes[j] = v; byMode[row.mode]![j]! += v; totals[j]! += v; cum += v; }
      batches.push(row);
      const last = hist[hist.length - 1];
      if (last && last.time === row.time) { last.ballots = cum; last.votes = totals.slice(); } else hist.push({ time: row.time, ballots: cum, votes: totals.slice() });
    }
    const ev = L.events, events: RaceDetail['events'] = [];
    for (const id of this.localEvents![r]!) {
      if (ev.time[id]! > t) break;
      let ballots = 0; for (const h of hist) if (h.time <= ev.time[id]!) ballots = h.ballots;
      const wi = this.lastAtOrBefore(this.localWire![r]!, L.wire.time, ev.time[id]!);
      events.push({ time: ev.time[id]!, status: ev.status[id]!, option: ev.option[id]!, prob: ev.prob[id]! / 10000, ballots, expected: wi >= 0 ? L.wire.expected[this.localWire![r]![wi]!]! : 0 });
    }
    return { batches: batches.slice(-limit).reverse(), byMode, events, history: hist };
  }

  /** Final counted votes of a race (the end of the feed): the certified count — simulation truth until then. */
  finalVotes(r: number): number[] { return Array.from(this.at(this.rec.feedEnd).races[r]!.votes); }

  /** Times of notable moments for the timeline: poll closings and projections. */
  markers(): { time: number; kind: 'close' | 'call' | 'control'; race: number }[] {
    const out: { time: number; kind: 'close' | 'call' | 'control'; race: number }[] = [];
    const closes = new Set<number>(); for (const s of this.rec.states) closes.add(s.closeLast);
    for (const t of closes) out.push({ time: t, kind: 'close', race: -1 });
    for (let i = 0; i < this.rec.events.time.length; i++) if (this.rec.events.status[i] === ST_CALLED) out.push({ time: this.rec.events.time[i]!, kind: 'call', race: this.rec.events.race[i]! });
    this.rec.control.forEach((c, i) => out.push({ time: c.time, kind: 'control', race: i })); // race = index of the control event
    return out.sort((a, b) => a.time - b.time);
  }
}
