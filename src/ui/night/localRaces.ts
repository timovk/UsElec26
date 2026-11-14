/**
 * County races on election night (Phase 7.6): the record's local races, read on demand — a state's list from the
 * engine, and the state of just those races at the playhead from the Broadcast Worker (at most twice a second).
 */
import { useEffect, useRef, useState } from 'react';
import { engine } from '../state/engineClient';
import type { NightLocalRace, NightRaceFrame } from '../../engine/protocol';
import type { NightState } from './useNight';

const EMPTY = new Map<number, NightRaceFrame>();

/** States with county races on the night, by name. */
export function localStates(n: NightState): number[] {
  return Object.keys(n.meta.localByState ?? {}).map(Number).sort((a, b) => (n.meta.states.find((s) => s.idx === a)?.name ?? '').localeCompare(n.meta.states.find((s) => s.idx === b)?.name ?? ''));
}

export function useLocalRaces(n: NightState, state: number | null): { list: NightLocalRace[] | null; frames: Map<number, NightRaceFrame> } {
  // Loaded data is keyed by night and state, so a change of state shows nothing stale.
  const id = n.meta.id, key = `${id}|${state}`;
  const [data, setData] = useState<{ key: string; list: NightLocalRace[] } | null>(null);
  const [fr, setFr] = useState<{ key: string; frames: Map<number, NightRaceFrame> } | null>(null);
  useEffect(() => {
    if (state === null) return;
    let alive = true;
    engine.query<NightLocalRace[]>({ kind: 'nightLocal', id, state }).then((l) => { if (alive) setData({ key: `${id}|${state}`, list: l }); }).catch(() => {});
    return () => { alive = false; };
  }, [id, state]);
  const list = data?.key === key ? data.list : null;
  const tMin = Math.floor(n.t), localFrames = n.localFrames;
  const last = useRef(0);
  useEffect(() => {
    if (!list?.length) return;
    let alive = true;
    const wait = Math.max(0, 500 - (performance.now() - last.current));
    const timer = setTimeout(() => {
      last.current = performance.now();
      void localFrames(list.map((x) => x.i), tMin).then((fs) => { if (alive) setFr({ key, frames: new Map(fs.map((f) => [f.i, f])) }); });
    }, wait);
    return () => { alive = false; clearTimeout(timer); };
  }, [list, tMin, localFrames, key]);
  return { list, frames: fr?.key === key ? fr.frames : EMPTY };
}
