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

export class Playback {
  private offs: Int32Array;               // per race: offset into the flat vote array
  private width: number;
  private checkpoints: { batch: number; votes: Float64Array; precincts: Float64Array }[] = [];
  private racesOfPart: number[][];
  private eventsByRace: number[][];
  private wireByRace: number[][];

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
