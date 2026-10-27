import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';

const ELECTRON_PATH = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron');

/**
 * Fresh Electron user-data dir per launch. Settings (including the theme)
 * persist to userData defaults, so sharing one dir across tests would leak
 * one test's saved settings into the next — the light-theme test's save
 * used to turn every later run's shell light, breaking the dark test's
 * focus-color assertion. Each test gets its own dir, removed on close.
 */
function launchOptions() {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'a11y-e2e-'));
  return {
    userDataDir,
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  };
}

async function closeApp(app: ElectronApplication | null, userDataDir: string) {
  await app?.close();
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Best effort: a leftover temp dir never fails the test.
  }
}

/**
 * End-to-end accessibility pass over the real app shell: launch, landmarks,
 * keyboard focus visibility, 200% zoom reflow, and axe (WCAG 2.2 AA,
 * including color-contrast, which only a real renderer can evaluate).
 * The light-theme test drives the real user path (Settings dialog, Theme,
 * Save) and additionally checks the light focus color, computed light
 * styles, and that focused elements are not obscured (2.4.11, which axe
 * does not cover in this version). The high-contrast test mirrors it for
 * the High contrast theme: black header, white input border, yellow focus
 * outline, and axe with contrast enabled.
 *
 * Scope: the shell without an open library. Vault flows (notes, tasks,
 * calendar with data) are covered by the component-level axe harness in
 * src/test/a11y-audit.test.ts. Console errors are collected and reported,
 * not failed on, because dev-mode output includes Vite/React noise.
 */
test('app shell is accessible end to end', async () => {
  let app: ElectronApplication | null = null;
  const { userDataDir, args } = launchOptions();
  try {
    app = await electron.launch({
      executablePath: ELECTRON_PATH,
      args,
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
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
    });
    // Diagnostic reports only: a failed write must not mask the verdicts below.
    try {
      writeFileSync(
        path.join(tmpdir(), 'e2e-axe.json'),
        JSON.stringify(results.violations, null, 2),
        'utf8',
      );
      writeFileSync(
        path.join(tmpdir(), 'e2e-console.json'),
        JSON.stringify({ pageErrors, consoleErrors }, null, 2),
        'utf8',
      );
    } catch (error) {
      console.warn('Could not write the E2E reports:', error);
    }
    expect(results.violations).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, userDataDir);
  }
});

test('app shell is accessible in the light theme', async () => {
  let app: ElectronApplication | null = null;
  const { userDataDir, args } = launchOptions();
  try {
    app = await electron.launch({
      executablePath: ELECTRON_PATH,
      args,
    });
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await expect(page).toHaveTitle(/A11y Notebook/);
    await expect(page.getByRole('banner', { name: 'Application header' })).toBeVisible();

    // Real user path: Settings dialog, Theme select, Save. The dialog is
    // reachable from the welcome shell; settings save to the app userData
    // defaults when no library is open.
    // The shortcut listener attaches after mount; retry the keypress until
    // the dialog actually opens instead of racing it.
    for (let attempt = 0; attempt < 6; attempt++) {
      if ((await page.getByRole('dialog', { name: 'Settings' }).count()) > 0) break;
      await page.keyboard.press('Control+Alt+S');
      await page.waitForTimeout(500);
    }
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    // The wrapping label's text includes the option texts, so locate the
    // Theme select by its Light option instead of by label.
    const themeSelect = page.locator('select').filter({ has: page.locator('option[value="light"]') });
    await expect(themeSelect).toBeVisible();
    await themeSelect.selectOption('light');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');

    // Computed styles prove the light stylesheet applied, not just the
    // attribute: white header, slate input border (dark values would be
    // near-black backgrounds and a pale blue border).
    const headerBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('.app-header') as HTMLElement).backgroundColor,
    );
    expect(headerBg).toBe('rgb(255, 255, 255)');
    const searchBorder = await page.evaluate(() => {
      const input = document.querySelector('.global-search input') as HTMLElement | null;
      return input ? getComputedStyle(input).borderColor : null;
    });
    expect(searchBorder).toBe('rgb(100, 116, 139)');

    // Keyboard focus must land on a real control and show the LIGHT focus
    // outline (dark sky blue #7dd3fc is 1.67:1 on white and must not appear).
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
    expect(focus!.outlineColor).toBe('rgb(3, 105, 161)');

    // Focus not obscured (WCAG 2.4.11, no axe rule in this axe version):
    // tab through the shell; each focused element's center point must hit
    // the element itself or one of its descendants.
    const seen = new Set<string>();
    const obscured: string[] = [];
    for (let i = 0; i < 24; i++) {
      const info = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return null;
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return { key: '', obscured: false };
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        ) as HTMLElement | null;
        return {
          key: `${element.tagName}:${element.className}:${(element.textContent ?? '').slice(0, 30)}`,
          obscured: !(hit && (hit === element || element.contains(hit))),
          hitTag: hit?.tagName ?? 'null',
        };
      });
      if (!info || info.key === '') {
        await page.keyboard.press('Tab');
        continue;
      }
      if (seen.has(info.key)) break;
      seen.add(info.key);
      if (info.obscured) obscured.push(`${info.key} (center hit ${info.hitTag})`);
      await page.keyboard.press('Tab');
    }
    expect(obscured).toEqual([]);

    // 200% zoom reflow in the light theme, same bar as the dark shell.
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

    // axe in the real renderer, contrast included, light theme applied.
    await page.addScriptTag({ path: path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
    const results = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run: (context: unknown, options: unknown) => Promise<{ violations: unknown[] }> };
        }
      ).axe;
      return axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
    });
    try {
      writeFileSync(
        path.join(tmpdir(), 'e2e-axe-light.json'),
        JSON.stringify(results.violations, null, 2),
        'utf8',
      );
      writeFileSync(
        path.join(tmpdir(), 'e2e-console-light.json'),
        JSON.stringify({ pageErrors, consoleErrors }, null, 2),
        'utf8',
      );
    } catch (error) {
      console.warn('Could not write the light-theme E2E reports:', error);
    }
    expect(results.violations).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, userDataDir);
  }
});

test('app shell is accessible in the high contrast theme', async () => {
  let app: ElectronApplication | null = null;
  const { userDataDir, args } = launchOptions();
  try {
    app = await electron.launch({
      executablePath: ELECTRON_PATH,
      args,
    });
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await expect(page).toHaveTitle(/A11y Notebook/);
    await expect(page.getByRole('banner', { name: 'Application header' })).toBeVisible();

    // Real user path: Settings dialog, Theme select, Save — the same path
    // as the light test, which previously proved the theme select itself
    // was a dead control for High contrast in ordinary mode.
    for (let attempt = 0; attempt < 6; attempt++) {
      if ((await page.getByRole('dialog', { name: 'Settings' }).count()) > 0) break;
      await page.keyboard.press('Control+Alt+S');
      await page.waitForTimeout(500);
    }
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    const themeSelect = page.locator('select').filter({ has: page.locator('option[value="high-contrast"]') });
    await expect(themeSelect).toBeVisible();
    await themeSelect.selectOption('high-contrast');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('high-contrast');

    // Computed styles prove the high contrast stylesheet applied, not just
    // the attribute: black header, white input border (the dark theme
    // would show a near-black header too, but a pale blue input border).
    const headerBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('.app-header') as HTMLElement).backgroundColor,
    );
    expect(headerBg).toBe('rgb(0, 0, 0)');
    const searchBorder = await page.evaluate(() => {
      const input = document.querySelector('.global-search input') as HTMLElement | null;
      return input ? getComputedStyle(input).borderColor : null;
    });
    expect(searchBorder).toBe('rgb(255, 255, 255)');

    // Keyboard focus must show the HIGH CONTRAST focus outline (yellow),
    // not the dark sky blue.
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
    expect(focus!.outlineColor).toBe('rgb(255, 255, 0)');

    // 200% zoom reflow in the high contrast theme, same bar as the others.
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

    // axe in the real renderer, contrast included, high contrast applied.
    await page.addScriptTag({ path: path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
    const results = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run: (context: unknown, options: unknown) => Promise<{ violations: unknown[] }> };
        }
      ).axe;
      return axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
    });
    try {
      writeFileSync(
        path.join(tmpdir(), 'e2e-axe-high-contrast.json'),
        JSON.stringify(results.violations, null, 2),
        'utf8',
      );
      writeFileSync(
        path.join(tmpdir(), 'e2e-console-high-contrast.json'),
        JSON.stringify({ pageErrors, consoleErrors }, null, 2),
        'utf8',
      );
    } catch (error) {
      console.warn('Could not write the high-contrast E2E reports:', error);
    }
    expect(results.violations).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(app, userDataDir);
  }
});

test('focus mode hides chrome and leaves only header, search, and document tabbable', async () => {
  let app: ElectronApplication | null = null;
  const { userDataDir, args } = launchOptions();
  try {
    app = await electron.launch({
      executablePath: ELECTRON_PATH,
      args,
    });
    const page = await app.firstWindow();
    await expect(page).toHaveTitle(/A11y Notebook/);
    await expect(page.getByRole('banner', { name: 'Application header' })).toBeVisible();

    // The shell test has no library open, so Focus Mode cannot be entered
    // through the UI here; the state machine is covered by the jsdom App
    // tests. This test verifies the exact class the app applies, in the
    // real renderer: hidden panes, full-width document, and a Tab order
    // that never lands inside a hidden pane.
    const displayOf = async (selector: string) =>
      page.evaluate((sel) => {
        const element = document.querySelector(sel) as HTMLElement | null;
        return element ? getComputedStyle(element).display : 'missing';
      }, selector);
    const contentWidth = async () =>
      page.evaluate(() => {
        const panel = document.querySelector('.content-panel') as HTMLElement | null;
        return panel ? panel.getBoundingClientRect().width : 0;
      });
    const windowWidth = await page.evaluate(() => window.innerWidth);

    expect(await displayOf('.panel')).not.toBe('none');
    await page.evaluate(() => document.querySelector('.app-shell')?.classList.add('focus-mode'));
    expect(await displayOf('.panel')).toBe('none');
    expect(await displayOf('.tab-bar')).toBe('none');
    expect(await displayOf('.side-panel')).toBe('none');
    expect(await displayOf('.status-bar')).toBe('none');
    expect(await displayOf('.app-header')).not.toBe('none');
    expect(await displayOf('.global-search input')).not.toBe('none');
    expect(await displayOf('.document')).not.toBe('none');
    // Single-column workspace: the content panel spans the window.
    expect(await contentWidth()).toBeGreaterThan(windowWidth - 50);

    // Tab through the shell: no stop may sit inside a hidden pane.
    const landedHidden: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const hidden = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return null;
        const container = element.closest('.panel, .tab-bar, .side-panel, .status-bar');
        return container ? container.className : null;
      });
      if (hidden) landedHidden.push(hidden);
    }
    expect(landedHidden).toEqual([]);

    // Removing the class restores the full layout.
    await page.evaluate(() => document.querySelector('.app-shell')?.classList.remove('focus-mode'));
    expect(await displayOf('.panel')).not.toBe('none');
    expect(await displayOf('.tab-bar')).not.toBe('none');
    expect(await contentWidth()).toBeLessThan(windowWidth - 300);
  } finally {
    await closeApp(app, userDataDir);
  }
});
