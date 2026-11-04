import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityDetail, GeoMeta, MapLayer, MapLayerDto, MapMetric } from '../../engine/protocol';
import { LEGEND_MARGIN, MARGIN_STOPS, MapRenderer, loadBasemap, marginColor, partyShareColor, type Basemap } from '../map/renderer';
import { useQuery } from './Desk';
import { OfficeHolder, Truth, fmtLean } from '../components/common';

let basemapPromise: Promise<Basemap> | null = null;
const getBasemap = () => (basemapPromise ??= loadBasemap(import.meta.env.BASE_URL));

const METRICS: { id: MapMetric; label: string }[] = [
  { id: 'lean', label: 'Underlying lean' }, { id: 'governor', label: 'Governor' }, { id: 'senate', label: 'U.S. Senate' }, { id: 'house', label: 'U.S. House' },
];
const LAYERS: { id: MapLayer; label: string }[] = [{ id: 'state', label: 'States' }, { id: 'county', label: 'Counties' }, { id: 'cd', label: 'Districts' }];

export function MapScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('county');
  const [metric, setMetric] = useState<MapMetric>('lean');
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [selected, setSelected] = useState<{ layer: MapLayer; idx: number } | null>(null);
  const meta = useQuery<GeoMeta>({ kind: 'geoMeta' });
  const data = useQuery<MapLayerDto>({ kind: 'mapLayer', layer, metric });
  const detail = useQuery<EntityDetail | null>(selected ? { kind: 'entity', layer: selected.layer, idx: selected.idx } : { kind: 'geoMeta' }, [selected?.idx, selected?.layer]);

  useEffect(() => { getBasemap().then(setBasemap).catch((e: Error) => setError(e.message)); }, []);

  // map feature order (topology) → engine index
  const idToIdx = useMemo(() => {
    if (!meta) return null;
    return {
      state: new Map(meta.states.map((s) => [s.fips, s.idx])), county: new Map(meta.counties.map((c) => [c.geoid, c.idx])), cd: new Map(meta.cds.map((c) => [c.geoid, c.idx])),
    };
  }, [meta]);

  const geomFor = (l: MapLayer) => (basemap ? (l === 'state' ? basemap.states : l === 'county' ? basemap.counties : basemap.cds) : null);

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
    if (!r || !geom || !data || !idToIdx || data.layer !== layer || data.metric !== metric) return;
    const map = idToIdx[layer];
    r.layer = geom;
    r.fills = geom.ids.map((id) => { const i = map.get(id); const v = i === undefined ? null : data.values[i] ?? null; return metric === 'lean' ? marginColor(v) : partyShareColor(v); });
    r.drawCountyMesh = layer === 'county'; r.outlineMesh = layer === 'cd' ? null : null;
    r.highlight = selected && selected.layer === layer ? geom.ids.findIndex((id) => map.get(id) === selected.idx) : -1;
    r.draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layer, metric, idToIdx, basemap, selected]);

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
      const name = layer === 'state' ? meta.states[idx]!.name : layer === 'county' ? `${meta.counties[idx]!.name}, ${meta.states[meta.counties[idx]!.stateIdx]!.usps}` : meta.cds[idx]!.label;
      setTip({ x: e.offsetX + 14, y: e.offsetY + 12, text: `${name} — ${valueLabel(data.values[idx] ?? null)}` });
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
  }, [basemap, idToIdx, layer, meta, data, metric]);

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
          <div className="seg" role="group" aria-label="Metric">{METRICS.map((m) => <button key={m.id} className={metric === m.id ? 'on' : ''} onClick={() => setMetric(m.id)}>{m.label}</button>)}</div>
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
            {metric === 'lean' ? (
              <div className="legend" aria-label="Legend">
                <span>R+30</span>{[...LEGEND_MARGIN.r].reverse().map((c) => <span key={c} className="sw" style={{ background: c }} />)}
                {LEGEND_MARGIN.d.map((c) => <span key={c} className="sw" style={{ background: c }} />)}<span>D+30</span>
                <span style={{ marginLeft: 8 }}>bins: {MARGIN_STOPS.join(' / ')} pts</span>
              </div>
            ) : (
              <div className="legend"><span className="sw" style={{ background: '#1f5fd6' }} /> Democratic <span className="sw" style={{ background: '#8a5fc4', marginLeft: 8 }} /> Split <span className="sw" style={{ background: '#d7263d', marginLeft: 8 }} /> Republican</div>
            )}
            <div className="row">{data?.provenance === 'simulationTruth' ? <Truth /> : <span className="badge record">Officeholders on this date</span>}<span className="tiny muted">{data?.legend}</span></div>
          </div>
          <p className="tiny muted">Boundaries: U.S. Census Bureau cartographic boundary files (2016 vintage), 115th Congress districts. Scroll or use ＋/－ to zoom, drag to pan, click for details.</p>
        </div>
        <aside className="card">
          {!entity ? <p className="muted">Click a state, county or district to see its details and officeholders.</p> : (
            <>
              <div className="kicker">{entity.layer === 'cd' ? 'Congressional district' : entity.layer}</div>
              <h2 style={{ marginBottom: 2 }}>{entity.title}</h2>
              <div className="small muted" style={{ marginBottom: 10 }}>{entity.subtitle}</div>
              <button className="btn small" onClick={zoomToSelected}>Zoom to</button>
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
