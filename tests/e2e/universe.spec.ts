import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function createUniverse(page: Page, name: string, seed: string) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Universes', exact: true })).toBeVisible();
  await page.getByPlaceholder('My America').fill(name);
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByPlaceholder('random').fill(seed);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Create universe' }).click();
  await expect(page.getByRole('heading', { name: 'The Desk', exact: true })).toBeVisible({ timeout: 170_000 });
  return Date.now() - t0;
}

test('create, explore, persist across reload, export and re-import a universe', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const ms = await createUniverse(page, 'E2E America', 'E2E-SEED-1');
  console.log(`universe creation in Chromium: ${ms} ms`);
  await expect(page.getByText('Senate').first()).toBeVisible();
  await expect(page.locator('.officeholder').first()).toContainText('President of the United States');
  await page.screenshot({ path: 'test-results/desk.png' });

  // Advance time one month.
  const dateBefore = await page.locator('.timebar .date').innerText();
  await page.getByRole('button', { name: '+1 month' }).click();
  await expect(page.locator('.timebar .date')).not.toHaveText(dateBefore);
  const dateAfter = await page.locator('.timebar .date').innerText();
  expect(dateAfter).toContain('January 31, 2016');

  // Map renders and responds.
  await page.getByRole('link', { name: 'Map' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box!.x + box!.width * 0.55, box!.y + box!.height * 0.45);
  await expect(page.locator('aside.card h2')).toBeVisible();
  await page.screenshot({ path: 'test-results/map.png' });

  // People and a profile.
  await page.getByRole('link', { name: 'People' }).click();
  await page.locator('table.data tbody tr').first().click();
  await expect(page.getByRole('heading', { name: 'Offices', exact: true })).toBeVisible();

  // Persistence: reload the page; the universe is still there with the advanced date.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Universes', exact: true })).toBeVisible();
  const row = page.locator('tr', { hasText: 'E2E America' });
  await expect(row).toContainText('January 31, 2016');

  // Export (download fallback), then import the file back.
  const dl = page.waitForEvent('download');
  await page.evaluate(() => { (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined; });
  await row.getByRole('button', { name: 'Export' }).click();
  const file = await (await dl).path();
  const bytes = readFileSync(file!);
  expect(bytes.subarray(0, 3).toString()).toBe('ENA');
  await page.locator('input[type=file]').setInputFiles({ name: 'universe.ena', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('tr', { hasText: 'E2E America' })).toHaveCount(2);

  // Open the imported copy and check the integrity report.
  await page.locator('tr', { hasText: 'E2E America' }).nth(0).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'The Desk', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Check the open universe' }).click();
  await expect(page.locator('td', { hasText: /^ok$/ }).first()).toBeVisible();
  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
