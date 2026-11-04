import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/** Median and 95th percentile of samples (ms). */
const stats = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, median: s[Math.floor(s.length / 2)] ?? 0, p95: s[Math.floor(s.length * 0.95)] ?? 0 }; };

/** Real frame intervals for a stretch of time (requestAnimationFrame), in ms. */
async function frameIntervals(page: Page, ms: number): Promise<number[]> {
  return page.evaluate((dur) => new Promise<number[]>((resolve) => {
    const out: number[] = []; let last = performance.now(); const end = last + dur;
    const step = (now: number) => { out.push(now - last); last = now; if (now < end) requestAnimationFrame(step); else resolve(out.slice(1)); };
    requestAnimationFrame(step);
  }), ms);
}

// Watching the 2016 election night live in Chromium (real geography): Broadcast Mode, Analyst, Desk, Results Explorer.
test('election night: broadcast live, magic wall, alerts and commentary, analyst, explorer', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error') errors.push(`worker: ${m.text()}`); }));
  page.on('dialog', (d) => void d.accept());

  await page.goto('./');
  await page.getByPlaceholder('My America').fill('E2E Night');
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByPlaceholder('random').fill('E2E-NIGHT-1');
  await page.getByRole('button', { name: 'Create universe' }).click();
  await expect(page.getByRole('heading', { name: 'The Desk', exact: true })).toBeVisible({ timeout: 170_000 });

  // Advance to the morning of Election Day (the ballot lock).
  await page.getByRole('button', { name: '+1 day' }).waitFor();
  const t0 = Date.now();
  await page.evaluate(() => { location.hash = '#/desk'; });
  await page.locator('.timebar').getByRole('button', { name: /Next election/ }).waitFor();
  let lastStep = 0;
  for (let i = 0; i < 160; i++) { // every primary day (presidential, congressional and state) stops here first
    const toasts = (await page.locator('.toast').allInnerTexts()).join(' ');
    if (/Polls open: 2016 general election/.test(toasts)) break;
    const s0 = Date.now();
    // Time spent per engine progress step (shown in the time bar while busy).
    await page.evaluate(() => {
      const w = window as unknown as { __steps: Record<string, number>; __obs?: MutationObserver };
      w.__steps = {}; w.__obs?.disconnect();
      let cur = '', since = performance.now();
      const bar = document.querySelector('.timebar')!;
      const tick = () => { const el = [...bar.querySelectorAll('span.small.muted')].find((x) => /…/.test(x.textContent ?? '')); const step = el ? (el.textContent ?? '').split('…')[0]! : ''; if (step !== cur) { const now = performance.now(); if (cur) w.__steps[cur] = (w.__steps[cur] ?? 0) + now - since; cur = step; since = now; } };
      w.__obs = new MutationObserver(tick); w.__obs.observe(bar, { subtree: true, childList: true, characterData: true });
    });
    await page.locator('.timebar').getByRole('button', { name: /Next election/ }).click();
    await page.waitForTimeout(300);
    await page.waitForFunction(() => { const x = [...document.querySelectorAll('.timebar button')].find((y) => /Next election/.test(y.textContent ?? '')); return x && !(x as HTMLButtonElement).disabled; }, null, { timeout: 300_000 });
    lastStep = Date.now() - s0;
  }
  const steps = await page.evaluate(() => (window as unknown as { __steps: Record<string, number> }).__steps);
  console.log(`to the 2016 general ballot lock: ${Date.now() - t0} ms (the Election Day step itself: ${lastStep} ms: ${Object.entries(steps).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(', ')})`);
  await expect(page.locator('.timebar .date')).toContainText('November 8, 2016');

  // Broadcast Mode is the default view; polls are open until coverage starts.
  await page.goto('./#/night');
  await expect(page.getByRole('button', { name: /Start coverage/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Start coverage/ }).click();
  await expect(page.locator('.bc-clock')).toContainText('5:00 PM');
  await page.getByLabel('Night playback speed').selectOption('600');
  await page.getByRole('button', { name: 'Play the night' }).click();
  await expect(page.locator('.bc-live.on')).toBeVisible();
  // Live playback advances the universe clock; alerts and commentary arrive as polls close and races are called.
  await expect(page.locator('.bc-banner')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.bc-l3 .text')).toContainText(/polls|MNN|votes/i, { timeout: 120_000 });
  await page.screenshot({ path: 'test-results/e2e-broadcast-live.png' });
  // Animation smoothness while the night plays (banners, counters, ticker): real frame intervals.
  const live = stats(await frameIntervals(page, 3000));
  console.log(`broadcast playback frames: median ${live.median.toFixed(1)} ms, p95 ${live.p95.toFixed(1)} ms over ${live.n} frames`);
  await page.getByRole('button', { name: 'Pause the night' }).click();
  expect(live.median).toBeLessThanOrEqual(20); // ≥ 50 fps

  // The magic wall: fly into a state and back; frame draw times and map recolour times are recorded.
  await page.evaluate(() => { (window as unknown as { __enaPerf: Record<string, number[]> }).__enaPerf = {}; });
  const canvas = page.locator('.nmap canvas');
  const box = (await canvas.boundingBox())!;
  const fly = frameIntervals(page, 1400);
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.55); // a state in the middle of the map
  const flyIn = stats(await fly);
  await expect(page.getByRole('button', { name: '◀ National' })).toBeVisible();
  await expect(page.locator('.bc-card h2').first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/e2e-broadcast-state.png' });
  await page.getByLabel('Map mode').selectOption('reporting');
  await page.getByLabel('Map mode').selectOption('margin');
  const perf = await page.evaluate(() => (window as unknown as { __enaPerf: Record<string, number[]> }).__enaPerf);
  const draw = stats(perf.draw ?? []), frame = stats(perf.frame ?? []);
  console.log(`zoom flight: ${flyIn.n} frames, median interval ${flyIn.median.toFixed(1)} ms; vector frame draw median ${frame.median.toFixed(1)} ms p95 ${frame.p95.toFixed(1)} ms; map recolour median ${draw.median.toFixed(1)} ms p95 ${draw.p95.toFixed(1)} ms (${draw.n} recolours)`);
  expect(draw.p95).toBeLessThanOrEqual(50);
  expect(frame.median).toBeLessThanOrEqual(20);
  await page.getByRole('button', { name: '◀ National' }).click();
  // Sound can be muted (remembered on this device); reduced motion stills the animations.
  await page.getByRole('button', { name: 'Mute sound' }).click();
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toBeVisible();
  await page.getByRole('button', { name: 'Reduced motion' }).click();
  await expect(page.locator('.bc.reduced')).toBeVisible();

  // During the count, Results show the unofficial count, not the sealed cast ballots.
  await page.goto('./#/results/2016');
  await expect(page.getByText('Calls timeline')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Turnout:/)).toHaveCount(0); // the sealed turnout stays sealed while counting
  await page.getByLabel('Search contests and winners').fill('President');
  await page.locator('.rx-table tbody tr', { hasText: 'President' }).first().click({ timeout: 30_000 });
  await expect(page.getByText('Counting · unofficial')).toBeVisible();
  await expect(page.getByText(/of expected vote counted/)).toBeVisible();

  // Skip ahead to 6 am (confirmed): the next morning, with every alert of the night in the record.
  await page.goto('./#/night');
  await page.getByRole('button', { name: /6 am/ }).click();
  await expect(page.locator('.bc-clock')).toContainText('6:00 AM', { timeout: 120_000 });
  await expect(page.locator('.timebar .date')).toContainText('November 9, 2016');
  await expect(page.locator('.bc-ev')).toBeVisible();
  await page.waitForTimeout(1500);
  // Visual regression: the broadcast at 6 am, reduced motion (no animation), is a pure function of the record.
  await expect(page.locator('.bc')).toHaveScreenshot('broadcast-6am.png', { maxDiffPixelRatio: 0.03 });

  // Replay determinism: the same moment, reached twice, renders identically.
  const tl = (await page.locator('.bc-timeline').boundingBox())!;
  await page.mouse.click(tl.x + tl.width * 0.4, tl.y + tl.height / 2);
  await page.waitForTimeout(1500);
  // (Clipped short of the side panel's scrollbar gutter, whose overlay thumb may fade in and out.)
  const mb = (await page.locator('.bc-main').boundingBox())!;
  const clip = { x: mb.x, y: mb.y, width: mb.width - 16, height: mb.height };
  const a = await page.screenshot({ clip });
  await page.mouse.click(tl.x + tl.width * 0.8, tl.y + tl.height / 2);
  await page.waitForTimeout(1500);
  await page.mouse.click(tl.x + tl.width * 0.4, tl.y + tl.height / 2);
  await page.waitForTimeout(1500);
  const b = await page.screenshot({ clip });
  if (!a.equals(b)) { writeFileSync('test-results/replay-a.png', a); writeFileSync('test-results/replay-b.png', b); }
  expect(a.equals(b)).toBe(true);
  await expect(page.locator('.bc-live')).toContainText('REPLAY');

  // Analyst Mode: the data behind one race.
  await page.getByRole('tab', { name: 'Analyst' }).click();
  await expect(page.getByRole('heading', { name: 'The count over time' })).toBeVisible();
  await expect(page.locator('.an-chart svg').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Outstanding vote' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Voter survey' })).toBeVisible();
  await page.screenshot({ path: 'test-results/e2e-analyst.png', fullPage: true });

  // The Desk view and the night picker.
  await page.getByRole('tab', { name: 'Desk' }).click();
  await expect(page.locator('.night-clock')).toBeVisible();
  const picker = page.getByLabel('Choose an election night');
  await expect(picker.locator('option', { hasText: '2016 general election' })).toHaveCount(1);
  await page.getByRole('button', { name: '⏮' }).click();
  await expect(page.locator('.night-clock')).toContainText('5:00 PM');
  await expect(page.getByText('REPLAY')).toBeVisible();

  // Results Explorer facets and the map modes on the archive map.
  await page.goto('./#/results/2016');
  const before = await page.locator('.rx').locator('..').locator('h2').innerText();
  await page.locator('.rx-opt', { hasText: 'U.S. Senate' }).click();
  await expect(page.locator('.rx').locator('..').locator('h2')).not.toHaveText(before);
  await page.goto('./#/map/results/2016');
  await page.getByLabel('Map mode').selectOption('turnout');
  await expect(page.locator('.legend')).toContainText('%');

  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
