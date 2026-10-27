import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * High-contrast-theme stylesheet regression tests.
 *
 * The original bug: the only high-contrast rules lived inside a
 * `@media (forced-colors: active)` block, so choosing High contrast in
 * Settings changed nothing in ordinary mode — the same dead-control bug
 * the light theme had. These tests read the real stylesheet, strip every
 * forced-colors:active block (balanced braces, so the nested block inside
 * it is stripped too), and assert the high-contrast rules survive in
 * normal CSS. Unlike the light theme, the trapped rules are deliberately
 * KEPT: they are the forced-colors-mode fallback, and the new ordinary-mode
 * block is wrapped in (forced-colors: none) so the two never fight.
 * Contrast values themselves are verified by the computed-ratio table in
 * the block's header comment and by axe with contrast enabled in the
 * Playwright high-contrast test.
 */
function stripMediaBlocks(css: string, query: string): string {
  let result = css;
  let start = result.indexOf(query);
  while (start !== -1) {
    const open = result.indexOf('{', start);
    if (open === -1) break;
    let depth = 0;
    let end = open;
    for (; end < result.length; end++) {
      if (result[end] === '{') depth++;
      else if (result[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    result = result.slice(0, start) + result.slice(end + 1);
    start = result.indexOf(query);
  }
  return result;
}

function forcedColorsBlocks(css: string): string {
  const query = '@media (forced-colors: active)';
  const blocks: string[] = [];
  let rest = css;
  let start = rest.indexOf(query);
  while (start !== -1) {
    const open = rest.indexOf('{', start);
    if (open === -1) break;
    let depth = 0;
    let end = open;
    for (; end < rest.length; end++) {
      if (rest[end] === '{') depth++;
      else if (rest[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(rest.slice(start, end + 1));
    rest = rest.slice(end + 1);
    start = rest.indexOf(query);
  }
  return blocks.join('\n');
}

async function stylesheet(): Promise<string> {
  return readFile(path.join(process.cwd(), 'src', 'renderer', 'styles.css'), 'utf8');
}

describe('high contrast theme stylesheet', () => {
  it('applies the high contrast palette in normal CSS', async () => {
    const css = await stylesheet();
    const normal = stripMediaBlocks(css, '@media (forced-colors: active)');
    expect(normal).toContain('@media (forced-colors: none)');
    expect(normal).toMatch(/:root\[data-theme='high-contrast'\]\s*\{\s*color-scheme: dark;/);
    expect(normal).toMatch(/:root\[data-theme='high-contrast'\][^{]*:focus-visible[^{]*\{\s*outline-color: #ffff00;/);
    expect(normal).toMatch(/:root\[data-theme='high-contrast'\]\s+\.tab\.active-tab\s*\{\s*background: #ffff00;/);
    expect(normal).toMatch(/:root\[data-theme='high-contrast'\][^{]*a\s*\{\s*color: #ffff00;/);
    expect(normal).toMatch(/:root\[data-theme='high-contrast'\]\s*::placeholder\s*\{\s*color: #ccc;/);
  });

  it('keeps the trapped rules as the forced-colors-mode fallback', async () => {
    const css = await stylesheet();
    expect(forcedColorsBlocks(css)).toContain("data-theme='high-contrast'");
  });
});
