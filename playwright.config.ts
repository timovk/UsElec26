import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173/UsElec26/', viewport: { width: 1366, height: 768 }, acceptDownloads: true },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/UsElec26/', reuseExistingServer: true, timeout: 60_000 },
});
