// Phase 0 feasibility spike — NOT application code.
// Measures Canvas2D fill/stroke cost for all 3,142 counties (us-atlas counties-albers-10m,
// derived from Census 2017 cartographic boundaries) in headless Chromium.
// Usage: node tools/spikes/map-render-bench.mjs <dir containing counties-albers-10m.json and topojson-client.min.js>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const topo = readFileSync(join(dir, 'counties-albers-10m.json'), 'utf8');
const lib = readFileSync(join(dir, 'topojson-client.min.js'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.setContent('<canvas id="c" width="1950" height="1220"></canvas>');
await page.addScriptTag({ content: lib });
const result = await page.evaluate(async (topoText) => {
  const t0 = performance.now();
  const topo = JSON.parse(topoText);
  const fc = topojson.feature(topo, topo.objects.counties);
  const paths = fc.features.map((f) => {
    const p = new Path2D();
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      ring.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath();
    }
    return p;
  });
  const buildMs = performance.now() - t0;
  const ctx = document.getElementById('c').getContext('2d');
  const colors = paths.map((_, i) => `hsl(${(i * 37) % 360} 60% 50%)`);
  const frame = () => {
    ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, 975, 610);
    for (let i = 0; i < paths.length; i++) { ctx.fillStyle = colors[i]; ctx.fill(paths[i]); }
    ctx.lineWidth = 0.25; ctx.strokeStyle = '#fff'; for (const p of paths) ctx.stroke(p);
  };
  frame(); ctx.getImageData(0, 0, 1, 1); // warm-up + flush
  const times = [];
  for (let r = 0; r < 20; r++) { const a = performance.now(); frame(); ctx.getImageData(0, 0, 1, 1); times.push(performance.now() - a); }
  times.sort((a, b) => a - b);
  return { counties: paths.length, parseAndBuildMs: Math.round(buildMs), frameMedianMs: +times[10].toFixed(1), frameP90Ms: +times[18].toFixed(1) };
}, topo);
console.log(JSON.stringify({ ...result, renderer: 'headless Chromium, software raster (no GPU)', bytes: topo.length }, null, 2));
await browser.close();
