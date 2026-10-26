import { defineConfig } from '@playwright/test';

// End-to-end tests launch the real Electron app against the Vite dev server.
// Run `npm run build:electron` first (the test:e2e script does this), then
// `npx playwright test`. Under a headless Linux session, prefix xvfb-run.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'npm run dev:renderer',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
