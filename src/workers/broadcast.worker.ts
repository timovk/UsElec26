/// <reference lib="webworker" />
/**
 * Broadcast Worker (docs/architecture/08 §8.7): plays a sealed night record. The state at time t is a pure
 * function of the record; the worker sends compact frames, with only the races that changed since the
 * previous frame unless a full frame is requested.
 */
import { decodeNightRecord } from '../counting/record';
import { Playback } from '../broadcast/playback';
import type { BroadcastRequest, NightFrameDto, NightRaceFrame } from '../engine/protocol';

declare const self: DedicatedWorkerGlobalScope;

let pb: Playback | null = null;
let last: string[] = [];

function frame(t: number, focus: number | null, full: boolean): NightFrameDto {
  const snap = pb!.at(t);
  const races: NightRaceFrame[] = [];
  snap.races.forEach((r, i) => {
    const f: NightRaceFrame = { i, s: r.status, o: r.option, o2: r.option2, p: r.prob, b: r.ballots, e: r.expected, pr: r.precincts, v: Array.from(r.votes), ca: r.calledAt, pc: r.pollClose };
    const key = JSON.stringify(f);
    if (full || last[i] !== key) { races.push(f); last[i] = key; }
  });
  return {
    t, full, races, president: snap.president, senate: snap.senate, house: snap.house, control: snap.control,
    focus: focus !== null && focus >= 0 && focus < pb!.raceCount ? { race: focus, byRj: [...pb!.raceByRj(focus, t)].map(([rj, v]) => [rj, Array.from(v)]), expected: [...pb!.rjExpected(focus, t)] } : null,
  };
}

self.onmessage = async (ev: MessageEvent<{ id: number; req: BroadcastRequest }>) => {
  const { id, req } = ev.data;
  try {
    let result: unknown = null;
    if (req.type === 'load') { pb = new Playback(await decodeNightRecord(req.payload)); last = []; result = { races: pb.raceCount }; }
    else if (!pb) throw new Error('No night record loaded');
    else if (req.type === 'frame') result = frame(req.t, req.focus, !!req.full);
    else if (req.type === 'markers') result = pb.markers();
    else if (req.type === 'raceDetail') result = { ...pb.raceDetail(req.race, req.t), final: req.truth ? pb.finalVotes(req.race) : null };
    else if (req.type === 'localFrame') result = req.races.filter((i) => i >= 0 && i < pb!.localCount).map((i): NightRaceFrame => {
      const r = pb!.localState(i, req.t);
      return { i, s: r.status, o: r.option, o2: r.option2, p: r.prob, b: r.ballots, e: r.expected, pr: r.precincts, v: Array.from(r.votes), ca: r.calledAt, pc: r.pollClose };
    });
    else if (req.type === 'localDetail') result = { ...pb.localDetail(req.race, req.t), final: null };
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
