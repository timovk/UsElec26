import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityDetail, GeoMeta, MapLayer, MapLayerDto, MapMetric, ResultsMapDto, ResultsOffice } from '../../engine/protocol';
import { LEGEND_MARGIN, MARGIN_STOPS, MapRenderer, loadBasemap, marginColor, partyShareColor, type Basemap } from '../map/renderer';
import { useQuery } from './Desk';
import { OfficeHolder, PARTY_COLORS, PARTY_NAME, Truth, districtHref, fmtInt, fmtLean } from '../components/common';
import { MODES, MODE_CAPTION, areaColor, areaValue, legendOf, type Area, type MapMode } from '../night/mapModes';

let basemapPromise: Promise<Basemap> | null = null;
const getBasemap = () => (basemapPromise ??= loadBasemap(import.meta.env.BASE_URL));

const METRICS: { id: MapMetric; label: string }[] = [
  { id: 'lean', label: 'Underlying lean' }, { id: 'governor', label: 'Governor' }, { id: 'senate', label: 'U.S. Senate' }, { id: 'house', label: 'U.S. House' },
];
const LAYERS: { id: MapLayer; label: string }[] = [{ id: 'state', label: 'States' }, { id: 'county', label: 'Counties' }, { id: 'cd', label: 'Districts' }];

const RESULT_OFFICES: { id: ResultsOffice; label: string }[] = [{ id: 'president', label: 'President' }, { id: 'us_senator', label: 'Senate' }, { id: 'governor', label: 'Governor' }, { id: 'us_representative', label: 'House' }];

export function MapScreen({ initial }: { initial?: { year: number } } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('county');
  const [metric, setMetric] = useState<MapMetric>('lean');
  const [view, setView] = useState<'current' | 'results'>(initial ? 'results' : 'current');
  const years = useQuery<number[]>({ kind: 'electionYears' });
  const [year, setYear] = useState<number | null>(initial?.year ?? null);
  const [office, setOffice] = useState<ResultsOffice>('president');
  const [mode, setMode] = useState<MapMode>('margin');
  const [shareParty, setShareParty] = useState(1);
  const resYear = year ?? years?.find((y) => y % 2 === 0) ?? null;
  const results = useQuery<ResultsMapDto | null>(view === 'results' && resYear ? { kind: 'resultsMap', year: resYear, office, layer } : { kind: 'electionYears' }, [view, resYear, office, layer]);
  const res = results && !Array.isArray(results) && 'values' in results ? results : null;
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [selected, setSelected] = useState<{ layer: MapLayer; idx: number } | null>(null);
  const meta = useQuery<GeoMeta>({ kind: 'geoMeta' });
  const data = useQuery<MapLayerDto>({ kind: 'mapLayer', layer, metric });
  const detail = useQuery<EntityDetail | null>(selected ? { kind: 'entity', layer: selected.layer, idx: selected.idx } : { kind: 'geoMeta' }, [selected?.idx, selected?.layer]);

  useEffect(() => { getBasemap().then(setBasemap).catch((e: Error) => setError(e.message)); }, []);

  // map feature order (topology) → engine index
  const idToIdx = useMemo(() => {
    if (!meta) return null;
    // The county layer also holds New England's towns and Alaska's districts (ids rj:<index>), after the counties (Phase 7.5).
    const county = new Map<string, number>(meta.counties.map((c) => [c.geoid, c.idx]));
    for (const x of meta.units) county.set(`rj:${x.idx}`, meta.unitOffset + x.idx);
    return {
      state: new Map(meta.states.map((s) => [s.fips, s.idx])), county, cd: new Map(meta.cds.map((c) => [c.geoid, c.idx])),
    };
  }, [meta]);

  const geomFor = (l: MapLayer) => (basemap ? (l === 'state' ? basemap.states : l === 'county' ? basemap.units : basemap.cds) : null);
  const unitByArea = useMemo(() => new Map(meta?.units.map((x) => [meta.unitOffset + x.idx, x]) ?? []), [meta]);
  /** An area's name: a state, a county ("Kent County, DE"), a town ("Bethel, CT") or an Alaska district. */
  const areaName = (l: MapLayer, idx: number): string => {
    if (!meta) return '';
    if (l === 'state') return meta.states[idx]!.name;
    if (l === 'cd') return meta.cds[idx]!.label;
    const unit = unitByArea.get(idx);
    if (unit) return unit.kind === 'town' ? `${unit.name}, ${meta.states[unit.stateIdx]!.usps}` : `Alaska ${unit.name}`;
    return `${meta.counties[idx]!.name}, ${meta.states[meta.counties[idx]!.stateIdx]!.usps}`;
  };

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !basemap) return;
    const r = new MapRenderer(canvas, basemap); rendererRef.current = r;
    r.resize(); r.draw();
    const ro = new ResizeObserver(() => { r.resize(); r.draw(); }); ro.observe(canvas);
    return () => ro.disconnect();
  }, [basemap]);

  const valueLabel = (v: number | null): string => {
    if (v === null) return 'No data';
    if (metric === 'lean') return `${fmtLean(v)} underlying lean`;
    if (metric === 'governor') return v > 0 ? 'Democratic governor' : v < 0 ? 'Republican governor' : 'Other / vacant';
    if (metric === 'senate') return v >= 1 ? 'Two Democratic senators' : v <= -1 ? 'Two Republican senators' : v === 0 ? 'Split delegation' : 'Mixed / vacancy';
    return v >= 0.999 ? 'Democratic representative' : v <= -0.999 ? 'Republican representative' : `${Math.round((v + 1) * 50)}% of residents represented by Democrats`;
  };

  useEffect(() => {
    const r = rendererRef.current, geom = geomFor(layer);
    if (!r || !geom || !idToIdx) return;
    const map = idToIdx[layer];
    if (view === 'results') {
      if (!res || res.layer !== layer) return;
      r.layer = geom;
      r.fills = geom.ids.map((id) => { const i = map.get(id); if (i === undefined) return null; const a = resultArea(res, i); return a ? areaColor(mode, a, shareParty) : res.cells ? null : marginColor(res.values[i] ?? null); });
      r.drawCountyMesh = layer === 'county'; r.mesh = layer === 'county' ? basemap!.unitMesh : null;
      r.highlight = selected && selected.layer === layer ? geom.ids.findIndex((id) => map.get(id) === selected.idx) : -1;
      r.draw(); return;
    }
    if (!data || data.layer !== layer || data.metric !== metric) return;
    r.layer = geom;
    r.fills = geom.ids.map((id) => { const i = map.get(id); const v = i === undefined ? null : data.values[i] ?? null; return metric === 'lean' ? marginColor(v) : partyShareColor(v); });
    r.drawCountyMesh = layer === 'county'; r.mesh = layer === 'county' ? basemap!.unitMesh : null; r.outlineMesh = layer === 'cd' ? null : null;
    r.highlight = selected && selected.layer === layer ? geom.ids.findIndex((id) => map.get(id) === selected.idx) : -1;
    r.draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layer, metric, idToIdx, basemap, selected, view, res, mode, shareParty]);

  // interactions
  useEffect(() => {
    const canvas = canvasRef.current, r = rendererRef.current; if (!canvas || !r) return;
    let drag: { x: number; y: number; moved: boolean } | null = null; let settle: ReturnType<typeof setTimeout> | null = null;
    const scale = () => canvas.width / canvas.getBoundingClientRect().width;
    const gesture = () => { if (settle) clearTimeout(settle); else r.beginGesture(); r.drawGesture(); settle = setTimeout(() => { settle = null; r.endGesture(); }, 140); };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const s = scale(); r.zoomAt(e.offsetX * s, e.offsetY * s, e.deltaY < 0 ? 1.25 : 0.8); gesture(); };
    const onDown = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); };
    const onMove = (e: PointerEvent) => {
      const s = scale();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) { drag.moved = true; r.panBy(dx * s, dy * s); drag.x = e.clientX; drag.y = e.clientY; gesture(); setTip(null); }
        return;
      }
      const i = r.hit(e.offsetX * s, e.offsetY * s);
      const geom = r.layer; const map = idToIdx?.[layer];
      if (i < 0 || !geom || !map || !meta || !data) { setTip(null); return; }
      const idx = map.get(geom.ids[i]!);
      if (idx === undefined) { setTip(null); return; }
      const name = areaName(layer, idx);
      const ra = view === 'results' && res ? resultArea(res, idx) : null;
      setTip({ x: e.offsetX + 14, y: e.offsetY + 12, text: view === 'results' ? `${name} — ${ra ? modeLabel(mode, ra, shareParty) : 'No contest'}` : `${name} — ${valueLabel(data.values[idx] ?? null)}` });
    };
    const onUp = (e: PointerEvent) => {
      canvas.classList.remove('dragging');
      if (drag && !drag.moved) {
        const s = scale(); const i = r.hit(e.offsetX * s, e.offsetY * s); const map = idToIdx?.[layer];
        if (i >= 0 && r.layer && map) { const idx = map.get(r.layer.ids[i]!); if (idx !== undefined) setSelected({ layer, idx }); }
      }
      drag = null;
    };
    const onLeave = () => setTip(null);
    canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointerleave', onLeave);
    return () => { canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, idToIdx, layer, meta, data, metric, view, res, mode, shareParty]);

  const zoom = (f: number) => { const r = rendererRef.current, c = canvasRef.current; if (!r || !c) return; r.zoomAt(c.width / 2, c.height / 2, f); r.draw(); };
  const zoomToSelected = () => {
    const r = rendererRef.current, geom = geomFor(selected?.layer ?? layer), map = idToIdx?.[selected?.layer ?? layer];
    if (!r || !geom || !map || !selected) return;
    const i = geom.ids.findIndex((id) => map.get(id) === selected.idx); if (i < 0) return;
    r.fitBox([geom.bboxes[i * 4]!, geom.bboxes[i * 4 + 1]!, geom.bboxes[i * 4 + 2]!, geom.bboxes[i * 4 + 3]!]); r.draw();
  };

  const entity = selected && detail && 'title' in (detail as object) ? (detail as EntityDetail) : null;

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <div><div className="kicker">Interactive map</div><h1 className="screen-title">The political map</h1></div>
        <div className="row wrap">
          <div className="seg" role="group" aria-label="Geography">{LAYERS.map((l) => <button key={l.id} className={layer === l.id ? 'on' : ''} onClick={() => setLayer(l.id)} disabled={l.id === 'cd' && !basemap?.cds}>{l.label}</button>)}</div>
          <div className="seg" role="group" aria-label="View"><button className={view === 'current' ? 'on' : ''} onClick={() => setView('current')}>Today</button><button className={view === 'results' ? 'on' : ''} onClick={() => setView('results')} disabled={!years?.length}>Election results</button></div>
          {view === 'current' ? <div className="seg" role="group" aria-label="Metric">{METRICS.map((m) => <button key={m.id} className={metric === m.id ? 'on' : ''} onClick={() => setMetric(m.id)}>{m.label}</button>)}</div> : <>
            <select value={resYear ?? ''} onChange={(e) => setYear(Number(e.target.value))} aria-label="Election year">{years?.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <div className="seg" role="group" aria-label="Office">{RESULT_OFFICES.map((o) => <button key={o.id} className={office === o.id ? 'on' : ''} onClick={() => setOffice(o.id)}>{o.label}</button>)}</div>
            <select aria-label="Map mode" value={mode} onChange={(e) => setMode(e.target.value as MapMode)}>{MODES.filter((m) => m.needs !== 'expected').map((m) => <option key={m.id} value={m.id} disabled={(m.needs === 'baseline' && !res?.cells?.base) || (m.needs === 'eligible' && !res?.cells?.eligible)}>{m.label}{m.needs === 'baseline' && !res?.cells?.base ? ' (no earlier election)' : ''}</option>)}</select>
            {mode === 'share' && <select aria-label="Candidate party" value={shareParty} onChange={(e) => setShareParty(Number(e.target.value))}><option value={1}>Democratic share</option><option value={2}>Republican share</option></select>}</>}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 330px', alignItems: 'start' }}>
        <div>
          <div className="map-wrap" style={{ height: 'min(62vh, 620px)' }}>
            {error ? <p className="muted" style={{ padding: 20 }}>Map geometry could not be loaded: {error}</p> : <canvas ref={canvasRef} aria-label={`Map of ${layer} by ${metric}`} />}
            {tip && <div className="map-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
            <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button className="btn small" onClick={() => zoom(1.5)} aria-label="Zoom in">＋</button>
              <button className="btn small" onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">－</button>
              <button className="btn small" onClick={() => { rendererRef.current?.reset(); rendererRef.current?.draw(); }} aria-label="Reset view">⟲</button>
            </div>
          </div>
          <div className="row between wrap" style={{ marginTop: 8 }}>
            {view === 'results' && res?.cells ? (
              <div className="legend" aria-label="Legend">{legendOf(mode, shareParty).map((l, i) => <span key={i} className="row" style={{ gap: 3 }}><span className="sw" style={{ background: l.color }} />{l.label}</span>)}
                {(mode === 'swing' || mode === 'turnoutChange') && res.cells.base && <span style={{ marginLeft: 8 }}>vs {res.cells.base.label}</span>}</div>
            ) : view === 'results' || metric === 'lean' ? (
              <div className="legend" aria-label="Legend">
                <span>R+30</span>{[...LEGEND_MARGIN.r].reverse().map((c) => <span key={c} className="sw" style={{ background: c }} />)}
                {LEGEND_MARGIN.d.map((c) => <span key={c} className="sw" style={{ background: c }} />)}<span>D+30</span>
                <span style={{ marginLeft: 8 }}>bins: {MARGIN_STOPS.join(' / ')} pts</span>
              </div>
            ) : (
              <div className="legend"><span className="sw" style={{ background: '#1f5fd6' }} /> Democratic <span className="sw" style={{ background: '#8a5fc4', marginLeft: 8 }} /> Split <span className="sw" style={{ background: '#d7263d', marginLeft: 8 }} /> Republican</div>
            )}
            <div className="row">{view === 'results' ? <span className="badge record">Archived results · {resYear}</span> : data?.provenance === 'simulationTruth' ? <Truth /> : <span className="badge record">Officeholders on this date</span>}<span className="tiny muted">{view === 'results' ? (mode === 'margin' || !res?.cells ? res?.legend : `${MODE_CAPTION[mode]}${res.legend.includes('so far') ? ' · count in progress (unofficial)' : ''}`) : data?.legend}</span></div>
          </div>
          <p className="tiny muted">Boundaries: U.S. Census Bureau cartographic boundary files (2016 vintage), 115th Congress districts; New England by town and Alaska by State House district, as they report. Scroll or use ＋/－ to zoom, drag to pan, click for details.</p>
        </div>
        <aside className="card">
          {view === 'results' && res?.ev && res.ev.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="kicker">{resYear} presidential election</div>
              {res.ev.map((x) => <div key={x.name} className="row between" style={{ padding: '4px 0' }}><span style={{ color: PARTY_COLORS[x.party], fontWeight: 600 }}>{x.name}</span><span className="num"><strong>{x.ev}</strong> EV</span></div>)}
              {res.national && <div className="tiny muted">Popular vote: {res.national.slice(0, 3).map((n) => `${PARTY_NAME[n.party]} ${fmtInt(n.votes)}`).join(' · ')}</div>}
            </div>
          )}
          {!entity ? <p className="muted">Click a state, county or district to see its details and officeholders.</p> : (
            <>
              <div className="kicker">{entity.layer === 'cd' ? 'Congressional district' : entity.layer === 'county' && meta && entity.idx >= meta.unitOffset ? (unitByArea.get(entity.idx)?.kind === 'town' ? 'town' : 'Alaska House district') : entity.layer}</div>
              <h2 style={{ marginBottom: 2 }}>{entity.title}</h2>
              <div className="small muted" style={{ marginBottom: 10 }}>{entity.subtitle}</div>
              <div className="row"><button className="btn small" onClick={zoomToSelected}>Zoom to</button>{entity.layer === 'county' && <a className="btn small" href={meta && entity.idx >= meta.unitOffset ? `#/town/${entity.idx - meta.unitOffset}` : `#/county/${entity.idx}`}>Election history</a>}{entity.layer === 'state' && <a className="btn small" href={`#/archive/${entity.idx}`}>Election history</a>}{entity.layer === 'cd' && /^[A-Z]{2}-(AL|\d{2})/.test(entity.subtitle) && <a className="btn small" href={districtHref(entity.subtitle.slice(0, 5))}>Election history</a>}</div>
              <table className="data" style={{ marginTop: 10 }}><tbody>{entity.stats.map((s) => <tr key={s.label}><td className="muted">{s.label}</td><td className="num">{s.value}{s.provenance && <span className="badge truth" style={{ marginLeft: 6 }}>◆</span>}</td></tr>)}</tbody></table>
              <h3>Officials</h3>
              {entity.officials.map((o) => <OfficeHolder key={o.officeId} o={o} />)}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

/** One area of an archived results map as a map-mode area (certified results: the leader is the winner). */
function resultArea(res: ResultsMapDto, i: number): Area | null {
  const c = res.cells; if (!c || !c.has[i]) return null;
  const d = c.d[i]!, r = c.r[i]!, valid = c.valid[i]!, other = Math.max(0, valid - d - r), lead = c.lead[i]!;
  const parties = [1, 2, lead !== 1 && lead !== 2 && lead ? lead : 5];
  const b = c.base && c.base.has[i] ? { d: c.base.d[i]!, r: c.base.r[i]!, valid: c.base.valid[i]!, ballots: c.base.ballots?.[i] ?? 0, eligible: c.base.eligible?.[i] ?? 0 } : null;
  return { votes: [d, r, other, 0], parties, expected: c.ballots?.[i] ?? 0, called: lead === 1 ? 0 : lead === 2 ? 1 : lead ? 2 : -1, closed: true, eligible: c.eligible?.[i] ?? 0, base: b };
}

function modeLabel(mode: MapMode, a: Area, shareParty: number): string {
  const v = areaValue(mode === 'winner' ? 'margin' : mode, a, shareParty);
  if (v === null) return 'no data';
  switch (mode) {
    case 'winner': case 'margin': return fmtLean(v);
    case 'swing': return `${v >= 0 ? 'D' : 'R'} +${Math.abs(v).toFixed(1)} swing`;
    case 'turnout': return `${v.toFixed(1)}% turnout`;
    case 'turnoutChange': return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pts turnout`;
    case 'share': return `${v.toFixed(1)}% ${shareParty === 1 ? 'Democratic' : 'Republican'}`;
    default: return '';
  }
}
