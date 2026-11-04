/**
 * Canvas2D map renderer for pre-projected TopoJSON (Albers USA, 975×610 viewBox).
 * Fills are redrawn only when data or view change; during pan/zoom gestures a cached bitmap is
 * transformed and the crisp redraw happens when the gesture settles (docs/architecture/06 §6.7).
 */
import Flatbush from 'flatbush';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, Geometry } from 'geojson';

export interface MapLayerGeometry { ids: string[]; paths: Path2D[]; index: Flatbush; bboxes: Float64Array }

export interface Basemap { counties: MapLayerGeometry; states: MapLayerGeometry; cds: MapLayerGeometry | null; stateMesh: Path2D; countyMesh: Path2D; nation: Path2D }

function pathOf(geom: Geometry, bbox: number[]): Path2D {
  const p = new Path2D();
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.type === 'MultiPolygon' ? geom.coordinates.flat() : [];
  for (const ring of rings) {
    ring.forEach(([x, y], i) => {
      if (x! < bbox[0]!) bbox[0] = x!; if (y! < bbox[1]!) bbox[1] = y!; if (x! > bbox[2]!) bbox[2] = x!; if (y! > bbox[3]!) bbox[3] = y!;
      if (i === 0) p.moveTo(x!, y!); else p.lineTo(x!, y!);
    });
    p.closePath();
  }
  return p;
}

function layerFrom(topo: Topology, name: string): MapLayerGeometry {
  const fc = feature(topo, topo.objects[name] as GeometryCollection) as unknown as { features: Feature[] };
  const ids: string[] = []; const paths: Path2D[] = [];
  const bboxes = new Float64Array(fc.features.length * 4);
  const index = new Flatbush(Math.max(1, fc.features.length));
  fc.features.forEach((f, i) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    paths.push(pathOf(f.geometry, b)); ids.push(String(f.id));
    bboxes.set(b, i * 4); index.add(b[0]!, b[1]!, b[2]!, b[3]!);
  });
  if (fc.features.length === 0) index.add(0, 0, 0, 0);
  index.finish();
  return { ids, paths, index, bboxes };
}

function meshPath(topo: Topology, name: string, filter?: (a: unknown, b: unknown) => boolean): Path2D {
  const m = mesh(topo, topo.objects[name] as GeometryCollection, filter as never) as unknown as { coordinates: number[][][] };
  const p = new Path2D();
  for (const line of m.coordinates) line.forEach(([x, y], i) => (i ? p.lineTo(x!, y!) : p.moveTo(x!, y!)));
  return p;
}

export async function loadBasemap(base: string): Promise<Basemap> {
  const [c, d] = await Promise.all([
    fetch(`${base}geo-packs/2016.1/topo/counties.topo.json`).then((r) => { if (!r.ok) throw new Error('Map geometry unavailable'); return r.json() as Promise<Topology>; }),
    fetch(`${base}geo-packs/2016.1/topo/cd115.topo.json`).then((r) => (r.ok ? (r.json() as Promise<Topology>) : null)).catch(() => null),
  ]);
  const nation = new Path2D();
  const nat = layerFrom(c, 'nation'); for (const p of nat.paths) nation.addPath(p);
  return {
    counties: layerFrom(c, 'counties'), states: layerFrom(c, 'states'), cds: d ? layerFrom(d, 'cd115') : null,
    stateMesh: meshPath(c, 'states', (a, b) => a !== b), countyMesh: meshPath(c, 'counties', (a, b) => a !== b), nation,
  };
}

/** Affine view: canvas pixel = s · map + (tx, ty). */
export interface View { s: number; tx: number; ty: number }

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private snapshot: HTMLCanvasElement | null = null;
  private snapView: View | null = null;
  view: View = { s: 1, tx: 0, ty: 0 };
  private baseS = 1;
  fills: (string | null)[] = [];
  layer: MapLayerGeometry | null = null;
  highlight = -1;
  outlineMesh: Path2D | null = null;
  drawCountyMesh = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly basemap: Basemap) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr)); this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.baseS = Math.min(this.canvas.width / 975, this.canvas.height / 610) * 0.97;
    this.reset();
  }

  /** Zoom level relative to the national view. */
  get zoom(): number { return this.view.s / this.baseS; }

  draw(): void {
    const c = this.ctx, { s, tx, ty } = this.view;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#070c1b'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(s, 0, 0, s, tx, ty);
    c.fillStyle = '#1a2142'; c.fill(this.basemap.nation);
    const layer = this.layer;
    if (layer) for (let i = 0; i < layer.paths.length; i++) { const f = this.fills[i]; if (f) { c.fillStyle = f; c.fill(layer.paths[i]!); } }
    c.lineJoin = 'round';
    const px = 1 / s; // one canvas pixel in map units
    if (this.drawCountyMesh) { c.strokeStyle = 'rgba(7,12,27,0.55)'; c.lineWidth = Math.min(0.6, 0.5 * px * Math.sqrt(this.zoom)); c.stroke(this.basemap.countyMesh); }
    if (this.outlineMesh) { c.strokeStyle = 'rgba(7,12,27,0.8)'; c.lineWidth = px; c.stroke(this.outlineMesh); }
    c.strokeStyle = '#e8ecff'; c.lineWidth = 1.2 * px * Math.min(2, Math.sqrt(this.zoom)); c.stroke(this.basemap.stateMesh);
    if (layer && this.highlight >= 0) { c.strokeStyle = '#ffc53d'; c.lineWidth = 3 * px; c.stroke(layer.paths[this.highlight]!); }
  }

  /** Begin a gesture: snapshot the current frame to transform it cheaply. */
  beginGesture(): void {
    if (!this.snapshot) this.snapshot = document.createElement('canvas');
    this.snapshot.width = this.canvas.width; this.snapshot.height = this.canvas.height;
    this.snapshot.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.snapView = { ...this.view };
  }

  drawGesture(): void {
    if (!this.snapshot || !this.snapView) { this.draw(); return; }
    const a = this.snapView, b = this.view, f = b.s / a.s;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#070c1b'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(f, 0, 0, f, b.tx - a.tx * f, b.ty - a.ty * f);
    c.drawImage(this.snapshot, 0, 0);
  }

  endGesture(): void { this.snapshot = null; this.snapView = null; this.draw(); }

  toMap(px: number, py: number): [number, number] { const { s, tx, ty } = this.view; return [(px - tx) / s, (py - ty) / s]; }

  hit(px: number, py: number): number {
    const layer = this.layer; if (!layer) return -1;
    const [mx, my] = this.toMap(px, py);
    const cands = layer.index.search(mx, my, mx, my);
    const { s, tx, ty } = this.view;
    this.ctx.setTransform(s, 0, 0, s, tx, ty);
    for (const i of cands) if (this.ctx.isPointInPath(layer.paths[i]!, px, py)) return i;
    return -1;
  }

  zoomAt(px: number, py: number, factor: number): void {
    const target = Math.min(this.baseS * 60, Math.max(this.baseS, this.view.s * factor));
    const f = target / this.view.s;
    this.view = { s: target, tx: px - (px - this.view.tx) * f, ty: py - (py - this.view.ty) * f };
    if (target === this.baseS) this.reset();
  }

  panBy(dx: number, dy: number): void { this.view = { ...this.view, tx: this.view.tx + dx, ty: this.view.ty + dy }; }

  fitBox(b: [number, number, number, number]): void {
    const w = Math.max(b[2] - b[0], 1e-3), h = Math.max(b[3] - b[1], 1e-3);
    const s = Math.min(this.baseS * 60, Math.max(this.baseS, 0.8 * Math.min(this.canvas.width / w, this.canvas.height / h)));
    this.view = { s, tx: this.canvas.width / 2 - (b[0] + b[2]) / 2 * s, ty: this.canvas.height / 2 - (b[1] + b[3]) / 2 * s };
  }

  reset(): void { const s = this.baseS; this.view = { s, tx: (this.canvas.width - 975 * s) / 2, ty: (this.canvas.height - 610 * s) / 2 }; }
}

// ---- Colour scales -------------------------------------------------------------------------------
const D_BINS = ['#dbe6fd', '#a9c4fb', '#6f9cf3', '#3f76e6', '#1f5fd6', '#123f99'];
const R_BINS = ['#fde0e3', '#f7b0b8', '#ef7d8b', '#e24a5e', '#d7263d', '#97122a'];
export const MARGIN_STOPS = [1, 5, 10, 20, 30];

export function marginColor(m: number | null): string | null {
  if (m === null || Number.isNaN(m)) return null;
  const a = Math.abs(m); let i = 0; while (i < MARGIN_STOPS.length && a >= MARGIN_STOPS[i]!) i++;
  return (m >= 0 ? D_BINS : R_BINS)[i]!;
}

export function partyShareColor(v: number | null): string | null {
  if (v === null) return null;
  if (v >= 0.999) return '#1f5fd6'; if (v <= -0.999) return '#d7263d';
  if (Math.abs(v) < 1e-9) return '#8a5fc4';
  return v > 0 ? (v > 0.5 ? '#4f86ef' : '#9bb7f2') : (v < -0.5 ? '#ec5a6b' : '#f2a3ad');
}
export const LEGEND_MARGIN = { d: D_BINS, r: R_BINS };
