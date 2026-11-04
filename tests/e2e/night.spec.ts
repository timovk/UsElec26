import { expect, test } from '@playwright/test';

// Watching the 2016 election night live in Chromium (real geography, Broadcast Worker playback).
test('watch election night: coverage, live playback, projections, skip ahead', async ({ page }) => {
  test.setTimeout(600_000);
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

  // Advance to the morning of Election Day (the ballot lock) in one step.
  await page.getByRole('button', { name: '+1 day' }).waitFor();
  const t0 = Date.now();
  await page.evaluate(() => { location.hash = '#/desk'; });
  // Use the clock: advance until 6:01 am ET on November 8 (the lock is at 6:00).
  await page.locator('.timebar').getByRole('button', { name: /Next election/ }).waitFor();
  for (let i = 0; i < 40; i++) {
    const toasts = (await page.locator('.toast').allInnerTexts()).join(' ');
    if (/Polls open: 2016 general election/.test(toasts)) break;
    await page.locator('.timebar').getByRole('button', { name: /Next election/ }).click();
    await page.waitForTimeout(300);
    await page.waitForFunction(() => { const x = [...document.querySelectorAll('.timebar button')].find((y) => /Next election/.test(y.textContent ?? '')); return x && !(x as HTMLButtonElement).disabled; }, null, { timeout: 300_000 });
  }
  console.log(`to the 2016 general ballot lock: ${Date.now() - t0} ms`);
  await expect(page.locator('.timebar .date')).toContainText('November 8, 2016');

  // Election Night: polls are open until coverage starts.
  await page.goto('./#/night');
  await expect(page.getByRole('button', { name: /Start coverage/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Start coverage/ }).click();
  await expect(page.locator('.night-clock')).toContainText('5:00 PM');
  await page.getByLabel('Night playback speed').selectOption('600');
  await page.getByRole('button', { name: 'Play the night' }).click();
  await expect(page.locator('.badge.live')).toBeVisible();
  // Live playback advances the universe clock; projections appear after polls close.
  await expect(page.locator('.night-log')).toContainText('MNN projects', { timeout: 120_000 });
  await page.screenshot({ path: 'test-results/e2e-night-live.png' });
  await page.getByRole('button', { name: 'Pause the night' }).click();
  const tb = await page.locator('.timebar .date').innerText();
  expect(tb).toMatch(/November (8|9), 2016/);

  // During the count, Results show the unofficial count, not the sealed cast ballots.
  await page.goto('./#/results/2016');
  await page.locator('table.data tbody tr', { hasText: 'President' }).first().click();
  await expect(page.getByText('Counting · unofficial')).toBeVisible();
  await expect(page.getByText(/of expected vote counted/)).toBeVisible();

  // Skip ahead to 6 am (confirmed), then rewind: rewinding is a replay of the same record.
  await page.goto('./#/night');
  await page.getByRole('button', { name: /6 am/ }).click();
  await expect(page.locator('.night-clock')).toContainText('6:00 AM', { timeout: 120_000 });
  await expect(page.locator('.timebar .date')).toContainText('November 9, 2016');
  const ev = await page.locator('.night-map').innerText();
  expect(ev).toMatch(/Electoral votes/);
  await page.screenshot({ path: 'test-results/e2e-night-morning.png' });
  // Any counted election can be chosen from the picker.
  const picker = page.getByLabel('Choose an election night');
  await expect(picker.locator('option', { hasText: '2016 general election' })).toHaveCount(1);
  await page.getByRole('button', { name: '⏮' }).click();
  await expect(page.locator('.night-clock')).toContainText('5:00 PM');
  await expect(page.getByText('REPLAY')).toBeVisible();

  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
