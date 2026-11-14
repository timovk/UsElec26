/**
 * Election-night playback state shared by the night's views (Broadcast, Desk, Analyst): the record is played
 * in the Broadcast Worker; live viewing follows the universe clock (playing at the live edge advances the
 * universe), going back is a replay of the original record, and skipping ahead asks first.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { engine } from '../state/engineClient';
import { BroadcastClient } from '../state/broadcastClient';
import { useApp } from '../state/store';
import type { GeoMeta, NightFrameDto, NightMarker, NightMetaDto, NightRaceFrame, NightTally, RaceDetailDto } from '../../engine/protocol';
import { formatDate, formatTime } from '../../core/time';

export const ET = 'America/New_York';
export const SPEEDS = [1, 10, 30, 60, 120, 300, 600];
export const ST = { NONE: 0, EARLY: 1, CLOSE: 2, CALLED: 3, WITHDRAWN: 4, RUNOFF: 5 };
export const clock = (t: number) => formatTime(Math.floor(t), ET);

export type RaceMeta = NightMetaDto['races'][number];
export interface Tally { president: NightTally; senate: NightTally; house: NightTally; control: NightFrameDto['control'] }
export interface Focus { race: number; byRj: Map<number, number[]>; expected: Map<number, number> }

export interface NightState {
  meta: NightMetaDto; geo: GeoMeta | null; markers: NightMarker[];
  t: number; edge: number; live: boolean; beforeCoverage: boolean;
  playing: boolean; setPlaying: (p: boolean) => void; speed: number; setSpeed: (s: number) => void;
  races: NightRaceFrame[]; tally: Tally | null;
  focus: number | null; setFocus: (r: number | null) => void; focusData: Focus | null;
  seek: (t: number) => Promise<void>;
  startCoverage: () => void;
  /** One race in detail from the Broadcast Worker (Analyst Mode). */
  raceDetail: (race: number, t: number, truth: boolean) => Promise<RaceDetailDto | null>;
  /** County races (Phase 7.6): frames of some local races at t, and one local race in detail. */
  localFrames: (races: number[], t: number) => Promise<NightRaceFrame[]>;
  localDetail: (race: number, t: number) => Promise<RaceDetailDto | null>;
}

export const leaderOf = (r: NightRaceFrame | undefined, k: number) => {
  if (!r) return -1;
  let best = -1, bv = 0; for (let j = 0; j < k - 1; j++) if ((r.v[j] ?? 0) > bv) { bv = r.v[j]!; best = j; }
  return best;
};
export const validOf = (r: NightRaceFrame | undefined, k: number) => (r ? r.v.slice(0, k - 1).reduce((a, b) => a + b, 0) : 0);
/** Lead of the first over the second option, in points of the valid vote. */
export const marginOf = (r: NightRaceFrame | undefined, k: number) => {
  const v = validOf(r, k); if (!r || v <= 0) return 0;
  const s = [...r.v.slice(0, k - 1)].sort((a, b) => b - a);
  return (100 * ((s[0] ?? 0) - (s[1] ?? 0))) / v;
};
export const pctIn = (r: NightRaceFrame | undefined) => (r && r.e ? Math.min(1, r.b / r.e) : 0);

export function useNight(nightId: number): NightState | null {
  const { time: edge, toast } = useApp();
  const [meta, setMeta] = useState<NightMetaDto | null>(null);
  const [geo, setGeo] = useState<GeoMeta | null>(null);
  const bc = useRef<BroadcastClient | null>(null);
  const [ready, setReady] = useState(false);
  const [markers, setMarkers] = useState<NightMarker[]>([]);
  const [userT, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [races, setRaces] = useState<NightRaceFrame[]>([]);
  const [tally, setTally] = useState<Tally | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [focusData, setFocusData] = useState<Focus | null>(null);
  const advancing = useRef(false);

  useEffect(() => {
    const c = new BroadcastClient(); bc.current = c;
    let alive = true;
    Promise.all([engine.query<NightMetaDto>({ kind: 'nightMeta', id: nightId }), engine.query<GeoMeta>({ kind: 'geoMeta' }), engine.query<{ bytes: Uint8Array }>({ kind: 'nightPayload', id: nightId })])
      .then(async ([m, g, p]) => { if (!alive) return; setMeta(m); setGeo(g); await c.load(p.bytes); setMarkers(await c.markers()); setReady(true); })
      .catch((e: Error) => toast(e.message, 'error'));
    return () => { alive = false; c.terminate(); bc.current = null; };
  }, [nightId, toast]);

  // Start position (until the user moves): the live edge clamped to coverage, or the start of coverage for a replay.
  const start = meta && edge !== null ? (edge >= meta.feedEnd ? meta.coverageStart : Math.max(meta.coverageStart, Math.min(edge, meta.feedEnd))) : null;
  const pos = userT ?? start;
  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; }, [start]);

  // Frames for the current position (one request in flight; the latest wanted position wins).
  const tMin = pos === null ? null : Math.floor(pos);
  const inFlight = useRef(false), wanted = useRef<{ t: number; focus: number | null } | null>(null);
  useEffect(() => {
    if (!ready || tMin === null || !bc.current) return;
    wanted.current = { t: Math.min(tMin, edge ?? tMin), focus };
    const pump = async () => {
      if (inFlight.current || !wanted.current || !bc.current) return;
      const w = wanted.current; wanted.current = null; inFlight.current = true;
      try {
        const f = await bc.current.frame(w.t, w.focus);
        setRaces((prev) => { const next = prev.length ? [...prev] : []; for (const r of f.races) next[r.i] = r; return next; });
        setTally({ president: f.president, senate: f.senate, house: f.house, control: f.control });
        setFocusData(f.focus ? { race: f.focus.race, byRj: new Map(f.focus.byRj), expected: new Map(f.focus.expected) } : null);
      } catch { /* the worker was replaced */ } finally { inFlight.current = false; if (wanted.current) void pump(); }
    };
    void pump();
  }, [ready, tMin, focus, edge]);

  // Playback: 10 ticks a second; at the live edge the universe clock is advanced ahead of the playhead.
  useEffect(() => {
    if (!playing || !meta) return;
    const iv = setInterval(() => {
      setT((prev) => {
        const cur = prev ?? startRef.current;
        if (cur === null) return prev;
        const next = Math.min(cur + (speed * 0.1) / 60, meta.feedEnd);
        if (next >= meta.feedEnd) setPlaying(false);
        if (edge !== null && next > edge) {
          if (!advancing.current) {
            advancing.current = true;
            const target = Math.min(meta.feedEnd + 1, Math.ceil(next + (speed * 2) / 60));
            engine.request({ type: 'advance', target: { kind: 'until', time: target } }).catch((e: Error) => toast(e.message, 'error')).finally(() => { advancing.current = false; });
          }
          return Math.max(cur, Math.min(next, edge));
        }
        return next;
      });
    }, 100);
    return () => clearInterval(iv);
  }, [playing, speed, meta, edge, toast]);

  const seek = useCallback(async (x: number) => {
    if (!meta) return;
    const target = Math.max(meta.coverageStart - 60, Math.min(meta.feedEnd, x));
    if (edge !== null && target > edge + 1) {
      if (!confirm(`Skip ahead to ${formatDate(target, ET)} ${clock(target)}? This advances the universe and reveals the count up to then.`)) return;
      setPlaying(false);
      try { await engine.request({ type: 'advance', target: { kind: 'until', time: Math.ceil(target) } }); } catch (e) { toast((e as Error).message, 'error'); return; }
    }
    setT(target);
  }, [meta, edge, toast]);

  const startCoverage = useCallback(() => {
    if (!meta) return;
    void engine.request({ type: 'advance', target: { kind: 'until', time: meta.coverageStart } }).then(() => setT(meta.coverageStart));
  }, [meta]);

  const raceDetail = useCallback(async (race: number, at: number, truth: boolean) => (bc.current && ready ? bc.current.raceDetail(race, at, truth) : null), [ready]);
  const localFrames = useCallback(async (list: number[], at: number) => (bc.current && ready && list.length ? bc.current.localFrame(at, list) : []), [ready]);
  const localDetail = useCallback(async (race: number, at: number) => (bc.current && ready ? bc.current.localDetail(race, at) : null), [ready]);

  if (!meta || pos === null || edge === null) return null;
  const live = edge < meta.feedEnd && pos >= edge - Math.max(2, (speed * 3) / 60);
  return {
    meta, geo, markers, t: pos, edge, live, beforeCoverage: edge < meta.coverageStart,
    playing, setPlaying, speed, setSpeed, races, tally, focus, setFocus, focusData, seek, startCoverage, raceDetail, localFrames, localDetail,
  };
}
