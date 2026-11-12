/**
 * The night's map: the nation by state (or by district for the House), and a state by county when one is
 * selected — the camera flies in and out ("magic wall"). Colours come from the map mode; the map recolours
 * on every frame of the count without relayout.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BaselineCountiesDto, GeoMeta, NightContextDto, NightMetaDto, NightRaceFrame } from '../../engine/protocol';
import { MapRenderer, loadBasemap, type Basemap } from '../map/renderer';
import { areaColor, areaValue, type Area, type MapMode } from './mapModes';
import { ST, leaderOf, pctIn, type Focus } from './useNight';

let basemapPromise: Promise<Basemap> | null = null;
export const getBasemap = () => (basemapPromise ??= loadBasemap(import.meta.env.BASE_URL));

export interface NightMapProps {
  meta: NightMetaDto; geo: GeoMeta | null; races: NightRaceFrame[];
  /** Race shown in each state for the national view (statewide office), by state index. */
  byState: Map<number, number>;
  /** House races by congressional district index (national House view). */
  byDistrict: Map<number, number> | null;
  level: number | null; onLevel: (stateIdx: number | null) => void;
  focus: Focus | null; focusRace: number | null;
  mode: MapMode; shareParty: number;
  ctx: NightContextDto | null; baseCounties: BaselineCountiesDto;
  reduced: boolean; className?: string;
  /** A district picked in a state's House view. */
  onPickRace?: (race: number) => void;
}

export function NightMap(p: NightMapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rend = useRef<MapRenderer | null>(null);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const shown = useRef<number | null>(null); // the level the camera is at (or flying to)
  useEffect(() => { getBasemap().then(setBasemap).catch(() => {}); }, []);
  const stateFips = useMemo(() => new Map(p.geo?.states.map((s) => [s.fips, s.idx]) ?? []), [p.geo]);
  const cdIdx = useMemo(() => new Map(p.geo?.cds.map((c) => [c.geoid, c.idx]) ?? []), [p.geo]);
  // A state's areas: counties, or New England's towns and Alaska's districts (ids rj:<index>; Phase 7.5).
  const unitArea = useMemo(() => {
    const m = new Map<string, { area: number; stateIdx: number; name: string }>();
    for (const c of p.geo?.counties ?? []) m.set(c.geoid, { area: c.idx, stateIdx: c.stateIdx, name: c.name });
    for (const x of p.geo?.units ?? []) m.set(`rj:${x.idx}`, { area: p.geo!.unitOffset + x.idx, stateIdx: x.stateIdx, name: x.kind === 'town' ? x.name : `Alaska ${x.name}` });
    return m;
  }, [p.geo]);
  const national = p.byDistrict && basemap?.cds ? 'cds' : 'states';

  useEffect(() => {
    const c = ref.current; if (!c || !basemap) return;
    const r = new MapRenderer(c, basemap); r.layer = basemap.states; rend.current = r; r.resize(); r.draw();
    const ro = new ResizeObserver(() => { r.resize(); if (shown.current !== null) { const b = stateBox(basemap, stateFips, shown.current); if (b) r.view = r.viewFor(b); } r.draw(); });
    ro.observe(c);
    return () => ro.disconnect();
  }, [basemap, stateFips]);

  // Fills for the current layer.
  const paint = () => {
    const r = rend.current; if (!r || !basemap) return;
    const lvl = shown.current;
    if (lvl === null) {
      const layer = national === 'cds' ? basemap.cds! : basemap.states;
      r.layer = layer; r.drawCountyMesh = false; r.dimOutside = null; r.outlines = null;
      r.fills = layer.ids.map((id) => {
        const i = national === 'cds' ? (cdIdx.has(id) ? p.byDistrict!.get(cdIdx.get(id)!) : undefined) : (stateFips.has(id) ? p.byState.get(stateFips.get(id)!) : undefined);
        if (i === undefined) return '#1a2142';
        return areaColor(p.mode, raceArea(p, i), p.shareParty);
      });
    } else if (national === 'cds') {
      // House: the state's districts, zoomed.
      r.layer = basemap.cds!; r.drawCountyMesh = false; r.outlines = null;
      r.fills = basemap.cds!.ids.map((id) => {
        const cd = cdIdx.get(id); const c = p.geo?.cds.find((x) => x.idx === cd);
        if (cd === undefined || !c || c.stateIdx !== lvl) return null;
        const i = p.byDistrict!.get(cd); return i === undefined ? '#2a3156' : areaColor(p.mode, raceArea(p, i), p.shareParty);
      });
      r.dimOutside = dimPath(basemap, stateFips, lvl);
    } else {
      r.layer = basemap.units; r.mesh = basemap.unitMesh; r.drawCountyMesh = true;
      const data = p.focus && p.focusRace !== null && p.focus.race === p.focusRace ? countyAreas(p, p.focusRace) : null;
      const max = data ? Math.max(0, ...[...data.values()].map((a) => Math.max(0, a.expected - sumArr(a.votes)))) : 0;
      // Areas with a meaningful share of their expected vote still out are outlined (winner and margin views; towns from 500 votes).
      const out = new Path2D(); let anyOut = false;
      r.fills = basemap.units.ids.map((id, fi) => {
        const c = unitArea.get(id); if (!c || c.stateIdx !== lvl) return null;
        const a = data?.get(c.area);
        if (a && a.expected > 0 && a.votes && (p.mode === 'winner' || p.mode === 'margin')) { const counted = sumArr(a.votes); if (counted < 0.9 * a.expected && a.expected - counted > (id.startsWith('rj:') ? 500 : 2000)) { out.addPath(basemap.units.paths[fi]!); anyOut = true; } }
        return a ? areaColor(p.mode === 'winner' ? 'margin' : p.mode, a, p.shareParty, max) : '#2a3156';
      });
      r.outlines = anyOut ? out : null;
      r.dimOutside = dimPath(basemap, stateFips, lvl);
    }
    r.draw();
  };
  const paintRef = useRef(paint);
  useLayoutEffect(() => { paintRef.current = paint; });

  // Recolour on data or mode changes.
  useEffect(() => { if (shown.current === p.level) paintRef.current(); }, [p.races, p.focus, p.mode, p.shareParty, p.ctx, p.baseCounties, basemap, p.level, p.byState, p.byDistrict]);

  // A state flashes as its projection comes in (national view; not on seeks or with reduced motion).
  const calledRef = useRef<Map<number, number> | null>(null);
  useEffect(() => {
    const r = rend.current; if (!r || !basemap) return;
    const now = new Map<number, number>();
    for (const [s, i] of p.byState) { const f = p.races[i]; if (f?.s === ST.CALLED) now.set(s, f.ca); }
    const prev = calledRef.current; calledRef.current = now;
    if (!prev || p.reduced || shown.current !== null || national !== 'states') return;
    const fresh = [...now].filter(([s]) => !prev.has(s));
    if (fresh.length === 0 || fresh.length > 6) return; // a seek, not a projection coming in
    for (const [s] of fresh) { const i = basemap.states.ids.findIndex((id) => stateFips.get(id) === s); if (i >= 0) r.flash(basemap.states.paths[i]!, '#fff', 900); }
  }, [p.races, p.byState, basemap, stateFips, p.reduced, national]);

  // Fly between the nation and a state.
  useEffect(() => {
    const r = rend.current; if (!r || !basemap || shown.current === p.level) return;
    const ms = p.reduced ? 0 : 750;
    if (p.level !== null) {
      const b = stateBox(basemap, stateFips, p.level); if (!b) return;
      shown.current = null; paintRef.current(); // fly over the national map, then switch to counties
      r.animateTo(r.viewFor(b), ms, () => { shown.current = p.level; paintRef.current(); });
    } else {
      shown.current = null; paintRef.current();
      r.animateTo(r.nationalView(), ms);
    }
  }, [p.level, basemap, stateFips, p.reduced]);

  const at = (e: React.MouseEvent) => {
    const r = rend.current, c = ref.current; if (!r || !c || !basemap) return null;
    const b = c.getBoundingClientRect(), dpr = c.width / b.width;
    return { i: r.hit((e.clientX - b.left) * dpr, (e.clientY - b.top) * dpr), x: e.clientX - b.left, y: e.clientY - b.top, layer: r.layer };
  };
  const click = (e: React.MouseEvent) => {
    const h = at(e); if (!h || !basemap) return;
    if (shown.current === null) {
      if (h.i < 0) return;
      const id = h.layer!.ids[h.i]!;
      const s = national === 'cds' ? p.geo?.cds.find((c) => c.geoid === id)?.stateIdx : stateFips.get(id);
      if (s !== undefined) p.onLevel(s);
    } else if (national === 'cds') {
      const id = h.i >= 0 ? h.layer!.ids[h.i] : undefined, c = id !== undefined ? p.geo?.cds.find((x) => x.geoid === id) : undefined;
      if (!c || c.stateIdx !== shown.current) { p.onLevel(null); return; }
      const race = p.byDistrict!.get(c.idx); if (race !== undefined) p.onPickRace?.(race);
    } else {
      const c = h.i >= 0 ? unitArea.get(basemap.units.ids[h.i]!) : undefined;
      if (!c || c.stateIdx !== shown.current) p.onLevel(null);
    }
  };
  const move = (e: React.MouseEvent) => {
    const h = at(e); if (!h || !basemap || h.i < 0) { setTip(null); return; }
    const id = h.layer!.ids[h.i]!;
    let text = '';
    if (shown.current === null || national === 'cds') {
      const i = national === 'cds' ? p.byDistrict!.get(cdIdx.get(id) ?? -1) : p.byState.get(stateFips.get(id) ?? -1);
      if (i !== undefined) text = describe(p, i);
    } else {
      const c = unitArea.get(id);
      if (c && c.stateIdx === shown.current && p.focusRace !== null) {
        const a = countyAreas(p, p.focusRace)?.get(c.area);
        const v = a ? areaValue(p.mode, a, p.shareParty) : null;
        text = `${c.name}${a ? ` · ${modeText(p, a, v)}` : ''}`;
      }
    }
    setTip(text ? { x: h.x, y: h.y, text } : null);
  };
  return (
    <div className={`nmap ${p.className ?? ''}`} onMouseLeave={() => setTip(null)}>
      <canvas ref={ref} onClick={click} onMouseMove={move} aria-label={p.level === null ? 'National map: select a state to zoom in' : 'State map by county (by town in New England, by district in Alaska): select outside the state to zoom out'} role="img" />
      {tip && <div className="map-tip" style={{ left: Math.min(tip.x + 12, 9999), top: tip.y + 12 }}>{tip.text}</div>}
    </div>
  );
}

const unitCache = new WeakMap<object, Map<number, number>>();
/** Reporting jurisdiction → its map area, for New England's towns and Alaska's districts. */
function unitAreas(p: NightMapProps): Map<number, number> {
  const g = p.geo; if (!g) return new Map();
  let m = unitCache.get(g); if (!m) { m = new Map(g.units.map((x) => [x.idx, g.unitOffset + x.idx])); unitCache.set(g, m); }
  return m;
}

const sumArr = (v: ArrayLike<number> | null) => { if (!v) return 0; let s = 0; for (let j = 0; j < v.length; j++) s += v[j]!; return s; };

function raceArea(p: NightMapProps, i: number): Area {
  const f = p.races[i], m = p.meta.races[i]!;
  return {
    votes: f && f.b > 0 ? f.v : null, parties: m.candidates.map((c) => c.party), expected: f?.e ?? 0,
    called: f?.s === ST.CALLED ? f.o : -1, closed: !!f && f.s !== ST.NONE,
    eligible: m.cd < 0 && m.office !== 'us_representative' ? p.ctx?.eligibleState[m.stateIdx] ?? 0 : 0, base: p.ctx?.baselines[i] ?? null,
  };
}

/**
 * The focused race by area: reporting jurisdictions summed into their county, except New England's towns and
 * Alaska's districts, which are areas of their own (after the counties; Phase 7.5).
 */
function countyAreas(p: NightMapProps, race: number): Map<number, Area> | null {
  const f = p.focus; if (!f || f.race !== race) return null;
  const m = p.meta.races[race]!, K = m.k, parties = m.candidates.map((c) => c.party), closed = (p.races[race]?.s ?? 0) !== ST.NONE;
  const out = new Map<number, Area>();
  const get = (c: number) => { let a = out.get(c); if (!a) { a = { votes: new Array<number>(K).fill(0), parties, expected: 0, called: -1, closed, eligible: m.office !== 'us_representative' ? p.ctx?.eligibleCounty[c] ?? 0 : 0, base: null }; const b = p.baseCounties?.[c]; if (b) a.base = { d: b[0], r: b[1], valid: b[2], ballots: b[3], eligible: b[4] }; out.set(c, a); } return a; };
  const units = unitAreas(p);
  const areaOf = (rj: number) => (units.has(rj) ? units.get(rj)! : p.meta.rjCounty[rj]);
  for (const [rj, v] of f.byRj) { const c = areaOf(rj); if (c === undefined) continue; const a = get(c); const av = a.votes as number[]; for (let j = 0; j < K; j++) av[j]! += v[j] ?? 0; }
  for (const [rj, e] of f.expected) { const c = areaOf(rj); if (c === undefined) continue; get(c).expected += e; }
  for (const a of out.values()) if (sumArr(a.votes) <= 0) a.votes = null;
  return out;
}

function modeText(p: NightMapProps, a: Area, v: number | null): string {
  if (v === null) return a.closed ? 'no votes yet' : 'polls open';
  switch (p.mode) {
    case 'winner': case 'margin': { const s = sumArr(a.votes); const lead = a.votes ? Array.from(a.votes).slice(0, a.parties.length).indexOf(Math.max(...Array.from(a.votes).slice(0, a.parties.length))) : -1; return lead >= 0 ? `${['', 'D', 'R', 'L', 'G', 'I'][a.parties[lead]!] ?? 'I'} ahead · ${Math.round(s).toLocaleString('en-US')} votes` : ''; }
    case 'swing': return `${v >= 0 ? 'D' : 'R'} +${Math.abs(v).toFixed(1)} swing`;
    case 'turnout': return `${v.toFixed(1)}% turnout (expected)`;
    case 'turnoutChange': return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pts turnout`;
    case 'reporting': return `${Math.floor(v)}% of expected vote counted`;
    case 'outstanding': return `about ${Math.round(v).toLocaleString('en-US')} votes outstanding`;
    case 'share': return `${v.toFixed(1)}% share`;
  }
}

function describe(p: NightMapProps, i: number): string {
  const m = p.meta.races[i]!, f = p.races[i];
  if (!f || f.s === ST.NONE) return `${m.short} · polls open`;
  const l = f.s === ST.CALLED ? f.o : leaderOf(f, m.k);
  const c = l >= 0 ? m.candidates[l] : undefined;
  return `${m.short} · ${c ? `${c.name} ${f.s === ST.CALLED ? '✓ projected' : 'leads'}` : 'no votes yet'} · ${Math.floor(100 * pctIn(f))}% in`;
}

function stateBox(basemap: Basemap, fips: Map<string, number>, s: number): [number, number, number, number] | null {
  const i = basemap.states.ids.findIndex((id) => fips.get(id) === s); if (i < 0) return null;
  const b = basemap.states.bboxes; return [b[i * 4]!, b[i * 4 + 1]!, b[i * 4 + 2]!, b[i * 4 + 3]!];
}

const dimCache = new Map<number, Path2D>();
function dimPath(basemap: Basemap, fips: Map<string, number>, s: number): Path2D | null {
  const hit = dimCache.get(s); if (hit) return hit;
  const i = basemap.states.ids.findIndex((id) => fips.get(id) === s); if (i < 0) return null;
  const p = new Path2D(); p.rect(-2000, -2000, 5000, 5000); p.addPath(basemap.states.paths[i]!);
  dimCache.set(s, p); return p;
}
