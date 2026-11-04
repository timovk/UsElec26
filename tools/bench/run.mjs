// Benchmark harness: drives the production build in Chromium with DevTools CPU throttling (default 4×)
// to approximate a Chromebook-class CPU, and records measured timings in tools/bench/results/.
// Usage: npx vite build && node tools/bench/run.mjs [throttle]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const throttle = Number(process.argv[2] ?? 4);
const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const results = { date: new Date().toISOString(), throttle, cpu: (await import('node:os')).cpus()[0]?.model, measurements: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto('http://localhost:4174/UsElec26/');
  await page.getByRole('button', { name: 'Create universe' }).waitFor();
  let t0 = Date.now();
  await page.getByRole('button', { name: 'Create universe' }).click();
  await page.getByRole('heading', { name: 'The Desk', exact: true }).waitFor({ timeout: 600_000 });
  results.measurements.createUniverseMs = Date.now() - t0;
  const before = await page.locator('.timebar .date').innerText();
  t0 = Date.now();
  await page.getByRole('button', { name: '+1 month' }).click();
  await page.locator('.timebar .date').filter({ hasNotText: before }).waitFor();
  results.measurements.advanceMonthMs = Date.now() - t0;
  t0 = Date.now();
  await page.getByRole('link', { name: 'Map' }).click();
  await page.waitForFunction(() => document.querySelector('canvas')?.width > 1, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  results.measurements.mapScreenMs = Date.now() - t0;
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Run diagnostics' }).click();
  await page.locator('table.data td', { hasText: 'County map redraw' }).waitFor({ timeout: 600_000 });
  results.measurements.diagnostics = await page.$$eval('section.card:has(h2:text("Diagnostics")) table tr', (rows) => rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent)));
} finally { await browser.close(); server.kill(); }
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/bench-throttle${throttle}x.json`, import.meta.url);
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
