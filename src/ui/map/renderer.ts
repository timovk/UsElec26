/**
 * Canvas2D map renderer for pre-projected TopoJSON (Albers USA, 975×610 viewBox).
 * Fills are redrawn only when data or view change; during pan/zoom gestures a cached bitmap is
 * transformed and the crisp redraw happens when the gesture settles (docs/architecture/06 §6.7).
 */
import Flatbush from 'flatbush';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, Geometry } from 'geojson';

export interface MapLayerGeometry { ids: string[]; paths: Path2D[]; index: Flatbush; bboxes: Float64Array; /** Simpler outlines for zoomed-out views (Phase 7.5's towns). */ coarse?: Path2D[] }

/** A set of lines split into map tiles with their bounding boxes, so that a zoomed view strokes only what it shows. */
export interface TiledPath { paths: Path2D[]; bboxes: Float64Array; coarse?: TiledPath }

/**
 * `units` (Phase 7.5) is the county layer as each state reports: counties, except New England's towns and Alaska's
 * State House districts, whose ids are `rj:<reporting-jurisdiction index>`; `unitMesh` draws its inner borders.
 */
export interface Basemap { counties: MapLayerGeometry; states: MapLayerGeometry; cds: MapLayerGeometry | null; stateMesh: TiledPath; countyMesh: TiledPath; nation: Path2D; units: MapLayerGeometry; unitMesh: TiledPath }

/** States drawn by reporting unit (rj.topo.json): New England's six and Alaska. */
const UNIT_FIPS = new Set(['09', '23', '25', '33', '44', '50', '02']);

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

function layerFrom(topo: Topology, name: string): MapLayerGeometry { return layerOf((feature(topo, topo.objects[name] as GeometryCollection) as unknown as { features: Feature[] }).features); }

function layerOf(features: Feature[]): MapLayerGeometry {
  const fc = { features };
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

const TILES_X = 16, TILES_Y = 10;

/** Lines grouped into a 16 × 10 grid of tiles over the 975 × 610 map, each line in the tile of its centre. */
function tiled(lines: number[][][]): TiledPath {
  const n = TILES_X * TILES_Y, paths = Array.from({ length: n }, () => new Path2D()), b = new Float64Array(n * 4), used = new Uint8Array(n);
  for (let t = 0; t < n; t++) b.set([Infinity, Infinity, -Infinity, -Infinity], t * 4);
  for (const line of lines) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of line) { if (x! < x0) x0 = x!; if (x! > x1) x1 = x!; if (y! < y0) y0 = y!; if (y! > y1) y1 = y!; }
    const tx = Math.min(TILES_X - 1, Math.max(0, Math.floor(((x0 + x1) / 2 / 975) * TILES_X))), ty = Math.min(TILES_Y - 1, Math.max(0, Math.floor(((y0 + y1) / 2 / 610) * TILES_Y)));
    const t = ty * TILES_X + tx, p = paths[t]!; used[t] = 1;
    line.forEach(([x, y], i) => (i ? p.lineTo(x!, y!) : p.moveTo(x!, y!)));
    b[t * 4] = Math.min(b[t * 4]!, x0); b[t * 4 + 1] = Math.min(b[t * 4 + 1]!, y0); b[t * 4 + 2] = Math.max(b[t * 4 + 2]!, x1); b[t * 4 + 3] = Math.max(b[t * 4 + 3]!, y1);
  }
  const keep = [...used.keys()].filter((t) => used[t]);
  return { paths: keep.map((t) => paths[t]!), bboxes: Float64Array.from(keep.flatMap((t) => [...b.subarray(t * 4, t * 4 + 4)])) };
}

function meshPath(topo: Topology, name: string, filter?: (a: unknown, b: unknown) => boolean): TiledPath {
  return tiled((mesh(topo, topo.objects[name] as GeometryCollection, filter as never) as unknown as { coordinates: number[][][] }).coordinates);
}

/**
 * A copy of a quantized topology with each arc thinned (a point is kept only if it lies `eps` map units or more from
 * the last kept one; arc ends are always kept), so neighbouring areas still share their borders exactly.
 */
function thinned(topo: Topology, eps: number): Topology {
  const t = topo.transform; if (!t) return topo;
  const [sx, sy] = t.scale, e2 = eps * eps;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0, kx = 0, ky = 0, px = 0, py = 0;
    const abs = arc.map(([dx, dy]) => [x += dx!, y += dy!] as const), out: number[][] = [];
    abs.forEach(([ax, ay], i) => {
      const last = i === abs.length - 1;
      if (i === 0 || last || ((ax - kx) * sx) ** 2 + ((ay - ky) * sy) ** 2 >= e2) { out.push([ax - px, ay - py]); px = ax; py = ay; kx = ax; ky = ay; }
    });
    return out;
  });
  return { ...topo, arcs } as Topology;
}

const meshLines = (topo: Topology, name: string, filter?: (a: unknown, b: unknown) => boolean) =>
  (mesh(topo, topo.objects[name] as GeometryCollection, filter as never) as unknown as { coordinates: number[][][] }).coordinates;

export async function loadBasemap(base: string): Promise<Basemap> {
  const [c, d, u] = await Promise.all([
    fetch(`${base}geo-packs/2016.1/topo/counties.topo.json`).then((r) => { if (!r.ok) throw new Error('Map geometry unavailable'); return r.json() as Promise<Topology>; }),
    fetch(`${base}geo-packs/2016.1/topo/cd115.topo.json`).then((r) => (r.ok ? (r.json() as Promise<Topology>) : null)).catch(() => null),
    fetch(`${base}geo-packs/2016.1/topo/rj.topo.json`).then((r) => (r.ok ? (r.json() as Promise<Topology>) : null)).catch(() => null),
  ]);
  const nation = new Path2D();
  const nat = layerFrom(c, 'nation'); for (const p of nat.paths) nation.addPath(p);
  const countyFeatures = (feature(c, c.objects.counties as GeometryCollection) as unknown as { features: Feature[] }).features;
  const countyMesh = meshPath(c, 'counties', (a, b) => a !== b);
  // Reporting units (Phase 7.5): New England's towns and Alaska's districts in place of their counties.
  let units: MapLayerGeometry, unitMesh: TiledPath;
  if (u) {
    const unitFeatures = ['towns', 'akhd'].flatMap((o) => (feature(u, u.objects[o] as GeometryCollection) as unknown as { features: Feature[] }).features.map((f) => ({ ...f, id: `rj:${f.id}` })));
    const others = countyFeatures.filter((f) => !UNIT_FIPS.has(String(f.id).slice(0, 2)));
    units = layerOf([...others, ...unitFeatures]);
    const countyLines = meshLines(c, 'counties', (a, b) => a !== b && !(UNIT_FIPS.has(String((a as { id: string }).id).slice(0, 2)) && UNIT_FIPS.has(String((b as { id: string }).id).slice(0, 2))));
    unitMesh = tiled([...countyLines, ...['towns', 'akhd'].flatMap((o) => meshLines(u, o, (a, b) => a !== b))]);
    // Zoomed out, towns are a few pixels across: thinned outlines (within 0.4 map units) draw them at about half the cost.
    const uc = thinned(u, 0.4);
    units.coarse = [...units.paths.slice(0, others.length), ...['towns', 'akhd'].flatMap((o) => (feature(uc, uc.objects[o] as GeometryCollection) as unknown as { features: Feature[] }).features.map((f) => pathOf(f.geometry, [Infinity, Infinity, -Infinity, -Infinity])))];
    unitMesh.coarse = tiled([...countyLines, ...['towns', 'akhd'].flatMap((o) => meshLines(uc, o, (a, b) => a !== b))]);
  } else { units = layerOf(countyFeatures); unitMesh = countyMesh; }
  return {
    counties: layerOf(countyFeatures), states: layerFrom(c, 'states'), cds: d ? layerFrom(d, 'cd115') : null,
    stateMesh: meshPath(c, 'states', (a, b) => a !== b), countyMesh, nation, units, unitMesh,
  };
}

/** Below this zoom (relative to the national view), layers with simpler outlines use them. */
const COARSE_BELOW = 2;

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
  /** The inner borders drawn with `drawCountyMesh` (the county mesh unless a layer sets its own, e.g. reporting units). */
  mesh: TiledPath | null = null;

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

  /** Optional overlay drawn after the fills (in map units), e.g. a dimmed outside for a state view. */
  dimOutside: Path2D | null = null;
  /** Areas outlined in gold (e.g. counties with vote still outstanding). */
  outlines: Path2D | null = null;
  /** Areas flashing after a change (a new projection): path, colour and the time the flash ends. */
  flashes: { path: Path2D; color: string; start: number; end: number }[] = [];
  private flashRaf = 0;
  /** Start a flash and keep redrawing until every flash has faded. */
  flash(path: Path2D, color: string, ms: number): void {
    const now = performance.now();
    this.flashes.push({ path, color, start: now, end: now + ms });
    if (this.flashRaf) return;
    const step = () => {
      const t = performance.now(); this.flashes = this.flashes.filter((f) => f.end > t);
      this.draw();
      this.flashRaf = this.flashes.length ? requestAnimationFrame(step) : 0;
    };
    this.flashRaf = requestAnimationFrame(step);
  }

  draw(): void {
    const t0 = performance.now();
    this.drawInner();
    perfSample('draw', performance.now() - t0);
  }

  private drawInner(): void {
    const c = this.ctx, { s, tx, ty } = this.view;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#070c1b'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(s, 0, 0, s, tx, ty);
    c.fillStyle = '#1a2142'; c.fill(this.basemap.nation);
    const layer = this.layer;
    // Only what the view shows is drawn: areas and border tiles outside it are skipped.
    const x0 = -tx / s, y0 = -ty / s, x1 = (this.canvas.width - tx) / s, y1 = (this.canvas.height - ty) / s;
    const inView = (b: Float64Array, i: number) => b[i * 4]! <= x1 && b[i * 4 + 2]! >= x0 && b[i * 4 + 1]! <= y1 && b[i * 4 + 3]! >= y0;
    const coarse = this.zoom < COARSE_BELOW;
    const stroke = (m: TiledPath) => { const t = coarse && m.coarse ? m.coarse : m; for (let i = 0; i < t.paths.length; i++) if (inView(t.bboxes, i)) c.stroke(t.paths[i]!); };
    const paths = layer && coarse && layer.coarse ? layer.coarse : layer?.paths;
    if (layer && paths) for (let i = 0; i < paths.length; i++) { const f = this.fills[i]; if (f && inView(layer.bboxes, i)) { c.fillStyle = f; c.fill(paths[i]!); } }
    if (this.dimOutside) { c.fillStyle = 'rgba(7,12,27,0.72)'; c.fill(this.dimOutside, 'evenodd'); }
    if (this.flashes.length) {
      const now = performance.now();
      for (const f of this.flashes) { const u = Math.min(1, Math.max(0, (now - f.start) / (f.end - f.start))); c.globalAlpha = 0.85 * (1 - u); c.fillStyle = '#ffffff'; c.fill(f.path); c.globalAlpha = 1; }
    }
    c.lineJoin = 'round';
    const px = 1 / s; // one canvas pixel in map units
    if (this.drawCountyMesh) { c.strokeStyle = 'rgba(7,12,27,0.55)'; c.lineWidth = Math.min(0.6, 0.5 * px * Math.sqrt(this.zoom)); stroke(this.mesh ?? this.basemap.countyMesh); }
    if (this.outlineMesh) { c.strokeStyle = 'rgba(7,12,27,0.8)'; c.lineWidth = px; c.stroke(this.outlineMesh); }
    c.strokeStyle = '#e8ecff'; c.lineWidth = 1.2 * px * Math.min(2, Math.sqrt(this.zoom)); stroke(this.basemap.stateMesh);
    if (this.outlines) { c.strokeStyle = '#ffc53d'; c.lineWidth = 1.6 * px; c.stroke(this.outlines); }
    if (layer && this.highlight >= 0) { c.strokeStyle = '#ffc53d'; c.lineWidth = 3 * px; c.stroke(layer.paths[this.highlight]!); }
  }

  /** The view that fits a box (map units), without applying it. */
  viewFor(b: [number, number, number, number]): View {
    const keep = this.view; this.fitBox(b); const v = this.view; this.view = keep; return v;
  }
  nationalView(): View { const keep = this.view; this.reset(); const v = this.view; this.view = keep; return v; }

  private anim = 0;
  /** Fly to a view (scale interpolated geometrically), redrawing the vector map each frame. */
  animateTo(target: View, ms: number, done?: () => void): void {
    cancelAnimationFrame(this.anim);
    if (ms <= 0) { this.view = target; this.draw(); done?.(); return; }
    const a = { ...this.view }, t0 = performance.now();
    // Keep the point under the centre moving in a straight line on screen while the scale changes smoothly.
    const W = this.canvas.width / 2, H = this.canvas.height / 2;
    const ca = [(W - a.tx) / a.s, (H - a.ty) / a.s], cb = [(W - target.tx) / target.s, (H - target.ty) / target.s];
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const sc = a.s * Math.pow(target.s / a.s, e), cx = ca[0]! + (cb[0]! - ca[0]!) * e, cy = ca[1]! + (cb[1]! - ca[1]!) * e;
      this.view = { s: sc, tx: W - cx * sc, ty: H - cy * sc };
      const f0 = performance.now(); this.drawInner(); perfSample('frame', performance.now() - f0);
      if (u < 1) this.anim = requestAnimationFrame(step); else { this.view = target; this.draw(); done?.(); }
    };
    this.anim = requestAnimationFrame(step);
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

/** Frame-time samples for the performance benchmarks (enabled by setting window.__enaPerf = {}). */
function perfSample(kind: string, ms: number): void {
  const g = globalThis as unknown as { __enaPerf?: Record<string, number[]> };
  if (g.__enaPerf) (g.__enaPerf[kind] ??= []).push(ms);
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
