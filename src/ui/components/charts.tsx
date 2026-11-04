/**
 * Small SVG charts for polls and forecasts: a time series with bands and poll dots, a histogram with a
 * threshold, and the "snake" of states by margin. One y-axis each, 2 px lines, recessive grid, hover readouts.
 */
import { useMemo, useRef, useState } from 'react';
import { formatDay } from '../../core/time';

/** Categorical colours for candidates of one party (validated for the dark surface; always labelled directly). */
export const CANDIDATE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export interface Series { key: string; label: string; color: string; points: { x: number; y: number; lo?: number; hi?: number }[] }
export interface Dot { x: number; y: number; color: string; title: string; r?: number }

const short = (d: number) => formatDay(d).replace(/, \d{4}$/, '');

/** A time series chart (days on x): lines with optional bands, poll dots, a zero line, and a crosshair readout. */
export function TimeChart({ series, dots = [], height = 220, yLabel, zero = false, yDomain, markers = [], fmt = (v: number) => v.toFixed(1) }: {
  series: Series[]; dots?: Dot[]; height?: number; yLabel?: string; zero?: boolean; yDomain?: [number, number]; markers?: { x: number; label: string }[]; fmt?: (v: number) => string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hx, setHx] = useState<number | null>(null);
  const W = 720, L = 44, R = 110, T = 12, B = 26;
  const xs = [...series.flatMap((s) => s.points.map((p) => p.x)), ...dots.map((d) => d.x)];
  if (!xs.length) return <p className="muted small">No data yet.</p>;
  const x0 = Math.min(...xs), x1 = Math.max(x0 + 1, ...xs);
  const ys = [...series.flatMap((s) => s.points.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y])), ...dots.map((d) => d.y), ...(zero ? [0] : [])];
  let [y0, y1] = yDomain ?? [Math.min(...ys), Math.max(...ys)];
  if (!yDomain) { const pad = Math.max(1, (y1 - y0) * 0.08); y0 -= pad; y1 += pad; }
  const H = height;
  const X = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R), Y = (y: number) => T + ((y1 - y) / (y1 - y0)) * (H - T - B);
  const ticks = niceTicks(y0, y1, 5);
  const xt = niceDays(x0, x1);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const band = (pts: Series['points']) => {
    const b = pts.filter((p) => p.lo !== undefined && p.hi !== undefined);
    if (b.length < 2) return null;
    return `${b.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.hi!).toFixed(1)}`).join('')}${[...b].reverse().map((p) => `L${X(p.x).toFixed(1)},${Y(p.lo!).toFixed(1)}`).join('')}Z`;
  };
  const near = (s: Series) => (hx === null || !s.points.length ? null : s.points.reduce((a, p) => (Math.abs(p.x - hx) < Math.abs(a.x - hx) ? p : a)));
  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={yLabel ?? 'Chart'}
        onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHx(x0 + ((px - L) / (W - L - R)) * (x1 - x0)); }} onMouseLeave={() => setHx(null)}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} stroke="var(--line-soft)" strokeWidth={t === 0 && zero ? 1.5 : 1} /><text x={L - 6} y={Y(t) + 4} textAnchor="end" className="an-ax">{fmt(t)}</text></g>)}
        {xt.map((d) => <text key={d} x={X(d)} y={H - 8} textAnchor="middle" className="an-ax">{short(d)}</text>)}
        {markers.map((m, i) => <g key={i}><line x1={X(m.x)} x2={X(m.x)} y1={T} y2={H - B} stroke="var(--line)" strokeDasharray="3 3" /><text x={X(m.x) + 3} y={T + 10} className="an-ax">{m.label}</text></g>)}
        {series.map((s) => { const b = band(s.points); return b ? <path key={`b${s.key}`} d={b} fill={s.color} opacity={0.16} /> : null; })}
        {dots.map((d, i) => <circle key={i} cx={X(d.x)} cy={Y(d.y)} r={d.r ?? 3} fill={d.color} opacity={0.45}><title>{d.title}</title></circle>)}
        {series.map((s) => <path key={s.key} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />)}
        {series.map((s) => { const p = s.points[s.points.length - 1]; return p ? <text key={`l${s.key}`} x={X(p.x) + 6} y={Y(p.y) + 4} className="chart-lbl">{s.label} {fmt(p.y)}</text> : null; })}
        {hx !== null && <line x1={X(Math.max(x0, Math.min(x1, hx)))} x2={X(Math.max(x0, Math.min(x1, hx)))} y1={T} y2={H - B} stroke="var(--text-2)" />}
        {hx !== null && series.map((s) => { const p = near(s); return p ? <circle key={`h${s.key}`} cx={X(p.x)} cy={Y(p.y)} r={4} fill={s.color} stroke="var(--bg-1)" strokeWidth={2} /> : null; })}
      </svg>
      <div className="tiny muted chart-readout">{hx !== null ? <>{short(Math.round(hx))}: {series.map((s) => { const p = near(s); return p ? <span key={s.key} style={{ marginRight: 10 }}><span className="party-dot" style={{ background: s.color }} /> {s.label} {fmt(p.y)}{p.lo !== undefined ? ` (${fmt(p.lo)}–${fmt(p.hi!)})` : ''}</span> : null; })}</> : yLabel}</div>
    </div>
  );
}

/** A histogram of counts by integer value, coloured by side of a threshold (e.g. electoral votes vs 270). */
export function Histogram({ counts, threshold, colorAbove, colorBelow, label, from = 0, to }: { counts: number[]; threshold: number; colorAbove: string; colorBelow: string; label: string; from?: number; to?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const lo = from, hi = to ?? counts.length - 1;
  const binW = Math.max(1, Math.ceil((hi - lo + 1) / 120));
  const bins = useMemo(() => { const b: { x: number; n: number }[] = []; for (let x = lo; x <= hi; x += binW) { let n = 0; for (let k = x; k < Math.min(hi + 1, x + binW); k++) n += counts[k] ?? 0; b.push({ x, n }); } return b; }, [counts, lo, hi, binW]);
  const max = Math.max(1, ...bins.map((b) => b.n)), total = counts.reduce((a, b) => a + b, 0) || 1;
  const W = 720, H = 150, L = 10, R = 10, T = 10, B = 22, bw = (W - L - R) / bins.length;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {bins.map((b, i) => { const h = ((H - T - B) * b.n) / max; return <rect key={i} x={L + i * bw + 1} y={H - B - h} width={Math.max(1, bw - 2)} height={h} rx={Math.min(2, bw / 3)} fill={b.x >= threshold ? colorAbove : colorBelow} opacity={hover === null || hover === i ? 0.9 : 0.5} onMouseEnter={() => setHover(i)} />; })}
        <line x1={L + ((threshold - lo) / binW) * bw} x2={L + ((threshold - lo) / binW) * bw} y1={T} y2={H - B} stroke="var(--gold)" strokeWidth={2} />
        {[lo, Math.round((lo + hi) / 2), hi].map((v) => <text key={v} x={L + ((v - lo) / binW) * bw} y={H - 6} textAnchor="middle" className="an-ax">{v}</text>)}
      </svg>
      <div className="tiny muted chart-readout">{hover !== null ? `${bins[hover]!.x}${binW > 1 ? `–${bins[hover]!.x + binW - 1}` : ''}: ${((100 * bins[hover]!.n) / total).toFixed(1)}% of simulations` : label}</div>
    </div>
  );
}

/** States in order of forecast margin, each as wide as its electoral votes: the path to 270. */
export function Snake({ states, colorOf }: { states: { key: string; label: string; ev: number; mean: number; pD: number; tipping: number }[]; colorOf: (margin: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = [...states].sort((a, b) => b.mean - a.mean);
  const total = sorted.reduce((a, s) => a + s.ev, 0) || 1;
  const W = 720, H = 46;
  const starts = sorted.reduce<number[]>((a, s, i) => { a.push(i === 0 ? 0 : a[i - 1]! + sorted[i - 1]!.ev); return a; }, []);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="States ordered by forecast margin" onMouseLeave={() => setHover(null)}>
        {sorted.map((s, i) => { const x = (starts[i]! / total) * W, w = (s.ev / total) * W; return (
          <g key={s.key} onMouseEnter={() => setHover(i)}>
            <rect x={x + 0.5} y={8} width={Math.max(1, w - 1)} height={26} fill={colorOf(s.mean)} opacity={hover === null || hover === i ? 1 : 0.6} />
            {s.tipping >= 0.08 && <rect x={x + 0.5} y={36} width={Math.max(1, w - 1)} height={4} fill="var(--gold)" />}
            {w > 20 && <text x={x + w / 2} y={25} textAnchor="middle" className="chart-snake">{s.label}</text>}
          </g>); })}
        <line x1={W / 2} x2={W / 2} y1={2} y2={44} stroke="var(--gold)" strokeWidth={2} />
      </svg>
      <div className="tiny muted chart-readout">{hover !== null ? (() => { const s = sorted[hover]!; return `${s.label} (${s.ev} EV): ${s.mean >= 0 ? 'D' : 'R'}+${Math.abs(s.mean).toFixed(1)} · Democratic win ${Math.round(100 * s.pD)}% · tipping point ${Math.round(100 * s.tipping)}%`; })() : 'Ordered from most Democratic to most Republican, each state as wide as its electoral votes; the line marks 270. Gold underline: frequent tipping-point states.'}</div>
    </div>
  );
}

function niceTicks(a: number, b: number, n: number): number[] {
  const span = b - a, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), f = step0 / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out: number[] = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
function niceDays(a: number, b: number): number[] {
  const span = b - a, step = span > 300 ? 60 : span > 120 ? 30 : span > 50 ? 14 : 7;
  const out: number[] = []; for (let v = a; v <= b; v += step) out.push(Math.round(v));
  return out;
}
