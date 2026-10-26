import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

const ELECTRON_PATH = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron');

/**
 * End-to-end accessibility pass over the real app shell: launch, landmarks,
 * keyboard focus visibility, 200% zoom reflow, and axe (WCAG 2.1 AA,
 * including color-contrast, which only a real renderer can evaluate).
 *
 * Scope: the shell without an open library. Vault flows (notes, tasks,
 * calendar with data) are covered by the component-level axe harness in
 * src/test/a11y-audit.test.ts. Console errors are collected and reported,
 * not failed on, because dev-mode output includes Vite/React noise.
 */
test('app shell is accessible end to end', async () => {
  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      executablePath: ELECTRON_PATH,
      args: ['.', '--no-sandbox', '--disable-gpu'],
    });
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await expect(page).toHaveTitle(/A11y Notebook/);
    // Landmark map, as built: banner (header), main (workspace),
    // complementary (navigation pane sidebar), contentinfo. The in-app menu
    // bar (<nav> "Main menu") is intentionally off by default
    // (settings.showCommandButtons defaults to false); the native menu
    // provides the same commands, so it must NOT be present here.
    await expect(page.getByRole('banner', { name: 'Application header' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toHaveCount(0);
    await expect(page.getByRole('main', { name: 'Workspace layout' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Navigation pane' })).toBeVisible();
    await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toBeVisible();

    // Keyboard focus must land on a real control and show the focus outline.
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
      };
    });
    expect(focus).not.toBeNull();
    expect(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(focus!.tag)).toBe(true);
    expect(focus!.outlineWidth).toBe('3px');
    expect(focus!.outlineColor).toBe('rgb(125, 211, 252)');

    // 200% zoom (the app's maximum zoom setting) must not need horizontal
    // scrolling: the narrow-width layout stacks the panes.
    const canZoom = await page.evaluate(
      () =>
        typeof (window as unknown as { a11yNotebook?: { setZoomFactor?: unknown } }).a11yNotebook?.setZoomFactor ===
        'function',
    );
    expect(canZoom).toBe(true);
    await page.evaluate(() =>
      (window as unknown as { a11yNotebook: { setZoomFactor: (factor: number) => void } }).a11yNotebook.setZoomFactor(
        2,
      ),
    );
    await page.waitForTimeout(500);
    const overflowAtZoom = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowAtZoom).toBe(false);
    await page.evaluate(() =>
      (window as unknown as { a11yNotebook: { setZoomFactor: (factor: number) => void } }).a11yNotebook.setZoomFactor(
        1,
      ),
    );

    // axe in the real renderer, contrast included.
    await page.addScriptTag({ path: path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
    const results = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run: (context: unknown, options: unknown) => Promise<{ violations: unknown[] }> };
        }
      ).axe;
      return axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      });
    });
    writeFileSync('/tmp/e2e-axe.json', JSON.stringify(results.violations, null, 2), 'utf8');
    writeFileSync('/tmp/e2e-console.json', JSON.stringify({ pageErrors, consoleErrors }, null, 2), 'utf8');
    expect(results.violations).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app?.close();
  }
});
