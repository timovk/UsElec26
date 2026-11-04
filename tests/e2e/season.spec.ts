import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 5 acceptance (real geography, Chromium): follow 2016 from the January caucuses through November with
 * live polls and forecasts, then inspect the forecast against the result.
 */
async function advance(page: Page, button: string | RegExp, until: string, timeout = 300_000) {
  await page.locator('.timebar').getByRole('button', { name: button }).click();
  await expect(page.locator('.timebar .date')).toContainText(until, { timeout });
}
/** The simulation starts on January 1, 2016; "+1 month" is 30 days. */
const dayOf2016 = (k: number) => new Date(Date.UTC(2016, 0, 1 + k)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

test('the 2016 campaign: primaries, polls, forecasts, conventions and forecast vs result', async ({ page }) => {
  test.setTimeout(1_200_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error') errors.push(`worker: ${m.text()}`); }));

  await page.goto('./');
  await page.getByPlaceholder('My America').fill('E2E Season');
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByPlaceholder('random').fill('E2E-SEASON-1');
  await page.getByRole('button', { name: 'Create universe' }).click();
  await expect(page.getByRole('heading', { name: 'The Desk', exact: true })).toBeVisible({ timeout: 170_000 });
  const t0 = Date.now();

  // March 1 (Super Tuesday): Iowa, New Hampshire, Nevada and South Carolina have voted.
  await advance(page, '+1 month', dayOf2016(30));
  await advance(page, '+1 month', 'March 1, 2016');
  await page.goto('./#/primaries/2016');
  await expect(page.getByRole('heading', { name: '2016 presidential primaries' })).toBeVisible();
  const open = page.locator('section.card', { has: page.locator('.pr-tracker') });
  await expect(open.first()).toContainText(/[1-9]\d* of \d+ contests held/);
  await expect(open.first().locator('.pr-row').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/e2e-primaries-march.png' });
  // Primary polls exist for the nominating contests.
  await page.goto('./#/polls/2016/polls');
  await expect(page.getByRole('heading', { name: /Latest polls/ })).toBeVisible();
  await expect(page.locator('table.data tbody tr').first()).toBeVisible();

  // June 29: the first forecasts are out (weekly from June) and the general-election polls are tracked.
  for (const k of [90, 120, 150, 180]) await advance(page, '+1 month', dayOf2016(k));
  await page.goto('./#/polls/2016/forecast');
  await expect(page.getByRole('heading', { name: 'President', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Electoral votes for/ })).toBeVisible();
  await page.goto(`./#/polls/2016/race/${encodeURIComponent('PN:2016')}`);
  await expect(page.getByRole('heading', { name: 'Polling average' })).toBeVisible();
  await expect(page.locator('.chart svg path').first()).toBeVisible();

  // July 29: both conventions have met.
  await advance(page, '+1 month', 'July 29, 2016');
  await page.goto('./#/primaries/2016');
  await expect(page.locator('.badge.record', { hasText: 'Nominee:' })).toHaveCount(2, { timeout: 30_000 });
  await page.screenshot({ path: 'test-results/e2e-primaries-final.png' });

  // Election Day morning: the final forecast.
  for (const k of [240, 270, 300]) await advance(page, '+1 month', dayOf2016(k));
  await advance(page, /Next election/, 'November 8, 2016');
  console.log(`January 1 → November 8, 2016 in Chromium: ${Date.now() - t0} ms`);
  await page.goto('./#/polls/2016/forecast');
  await expect(page.getByRole('heading', { name: 'President', exact: true })).toBeVisible();
  const headline = await page.locator('.fc-card').first().innerText();
  console.log(`final forecast: ${headline.replace(/\s+/g, ' ').slice(0, 160)}`);
  await page.screenshot({ path: 'test-results/e2e-forecast.png' });
  // The desk shows the season card.
  await page.goto('./#/desk');
  await expect(page.getByText(/Forecast \(/)).toBeVisible();

  // A month later: forecast vs result (Brier score, reliability, the presidential EV).
  await advance(page, '+1 month', 'December 8, 2016', 600_000);
  await page.goto('./#/polls/2016/result');
  await expect(page.getByRole('heading', { name: 'Brier score' })).toBeVisible();
  const brier = Number(await page.locator('section.card', { has: page.getByRole('heading', { name: 'Brier score' }) }).locator('.fc-big').innerText());
  console.log(`2016 Brier score over decided races: ${brier}`);
  expect(brier).toBeGreaterThanOrEqual(0);
  expect(brier).toBeLessThan(0.2);
  await expect(page.getByText(/Result: \d+ EV for the Democratic ticket/)).toBeVisible();
  await page.screenshot({ path: 'test-results/e2e-forecast-vs-result.png' });

  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
