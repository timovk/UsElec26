import { expect, test } from '@playwright/test';

// Full 2016 cycle in the browser on the real geography with the Compute Worker pool.
test('simulate the 2016 cycle and inspect results from the nation down to a county', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error') errors.push(`worker: ${m.text()}`); }));

  await page.goto('./');
  await page.getByPlaceholder('My America').fill('E2E Elections');
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByPlaceholder('random').fill('E2E-ELECT-1');
  await page.getByRole('button', { name: 'Create universe' }).click();
  await expect(page.getByRole('heading', { name: 'The Desk', exact: true })).toBeVisible({ timeout: 170_000 });
  await expect(page.getByText('Upcoming elections')).toBeVisible();

  // One year: every 2016 primary, the conventions and the November general.
  const t0 = Date.now();
  await page.getByRole('button', { name: '+1 year' }).click();
  await expect(page.locator('.timebar .date')).toContainText('December 31, 2016', { timeout: 540_000 });
  console.log(`2016 primaries + general in Chromium: ${Date.now() - t0} ms`);

  // Results: the presidential race summed to 538 electoral votes.
  await page.goto('./#/results/2016');
  await expect(page.getByRole('heading', { name: '2016 elections' })).toBeVisible();
  const pres = page.locator('section.card', { has: page.getByRole('heading', { name: 'President', exact: true }) });
  await expect(pres).toContainText('EV');
  const evs = (await pres.locator('.bignum').allInnerTexts()).map(Number);
  expect(evs.reduce((a, b) => a + b, 0)).toBe(538);
  await page.screenshot({ path: 'test-results/e2e-results.png' });

  // Archive audit: every 2016 election passes (since Phase 6 it also re-checks about 5,000 state legislative contests).
  const ta = Date.now();
  await page.getByRole('button', { name: 'Audit the 2016 archive' }).click();
  await expect(page.getByText(/All \d+ elections passed/)).toBeVisible({ timeout: 300_000 });
  console.log(`2016 archive audit in Chromium: ${Date.now() - ta} ms`);

  // A contest page, then one of its counties.
  await page.locator('table.data tbody tr').first().click();
  await expect(page.getByRole('heading', { name: 'By county' })).toBeVisible();
  await page.screenshot({ path: 'test-results/e2e-contest.png' });
  await page.locator('section.card', { has: page.getByRole('heading', { name: 'By county' }) }).locator('tbody a').first().click();
  await expect(page.getByRole('heading', { name: 'All contests' })).toBeVisible();

  // Results map.
  await page.goto('./#/map/results/2016');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/e2e-map-results.png' });

  // The President-elect takes office on January 20, 2017.
  await page.getByRole('button', { name: '+1 month' }).click();
  await expect(page.locator('.timebar .date')).toContainText('January 30, 2017', { timeout: 120_000 });
  await page.goto('./#/desk');
  await expect(page.getByText('Latest results · 2016')).toBeVisible();

  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
