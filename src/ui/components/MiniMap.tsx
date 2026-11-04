/** A small static county map of one contest (margin colours), framed on the contest's counties. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoMeta } from '../../engine/protocol';
import { MapRenderer, marginColor, type Basemap } from '../map/renderer';
import { getBasemap } from '../night/NightMap';
import { useQuery } from '../screens/Desk';
import { PARTY_COLORS } from './common';

export function MiniMap({ counties, parties, label }: { counties: { county: number; votes: number[] }[]; parties: number[]; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const geo = useQuery<GeoMeta>({ kind: 'geoMeta' });
  useEffect(() => { getBasemap().then(setBasemap).catch(() => {}); }, []);
  const byGeoid = useMemo(() => {
    const m = new Map<string, string | null>(); if (!geo) return m;
    const di = parties.indexOf(1), ri = parties.indexOf(2);
    for (const k of counties) {
      const c = geo.counties[k.county]; if (!c) continue;
      const valid = k.votes.reduce((a, b) => a + b, 0); if (valid <= 0) continue;
      let lead = 0; k.votes.forEach((v, j) => { if (v > k.votes[lead]!) lead = j; });
      const lp = parties[lead];
      m.set(c.geoid, lp !== 1 && lp !== 2 ? PARTY_COLORS[lp ?? 5] ?? null : di >= 0 && ri >= 0 ? marginColor((100 * (k.votes[di]! - k.votes[ri]!)) / valid) : PARTY_COLORS[lp]!);
    }
    return m;
  }, [geo, counties, parties]);
  useEffect(() => {
    const c = ref.current; if (!c || !basemap || !byGeoid.size) return;
    const r = new MapRenderer(c, basemap); r.layer = basemap.counties; r.drawCountyMesh = true;
    const draw = () => {
      r.resize();
      const b = [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number];
      basemap.counties.ids.forEach((id, i) => { if (!byGeoid.has(id)) return; const bb = basemap.counties.bboxes; b[0] = Math.min(b[0], bb[i * 4]!); b[1] = Math.min(b[1], bb[i * 4 + 1]!); b[2] = Math.max(b[2], bb[i * 4 + 2]!); b[3] = Math.max(b[3], bb[i * 4 + 3]!); });
      r.fills = basemap.counties.ids.map((id) => byGeoid.get(id) ?? null);
      if (Number.isFinite(b[0])) r.fitBox(b);
      r.draw();
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(c);
    return () => ro.disconnect();
  }, [basemap, byGeoid]);
  if (!counties.length) return null;
  return <canvas ref={ref} className="mini-map" role="img" aria-label={`County map of ${label}`} />;
}
