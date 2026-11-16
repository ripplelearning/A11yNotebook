import { defineConfig } from '@playwright/test';

// End-to-end tests launch the real Electron app against the Vite dev server.
// Run `npm run build:electron` first (the test:e2e script does this), then
// `npx playwright test`. Under a headless Linux session, prefix xvfb-run.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  // Keep a screenshot when a test fails: the CI failure evidence
  // otherwise contains only the error context, with no visual record of
  // what the app was showing when the step failed. Keep a trace too:
  // the Windows-only notebook-silo failure needs click coordinates and
  // grid state at the moment of the double-click to diagnose.
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:renderer',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
