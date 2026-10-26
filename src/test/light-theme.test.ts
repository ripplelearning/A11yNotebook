import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Light-theme stylesheet regression tests.
 *
 * The original bug: the light-theme rules lived inside a
 * `@media (forced-colors: active)` block, so choosing Light in Settings
 * changed nothing in ordinary mode. These tests read the real stylesheet,
 * strip every forced-colors:active block (balanced braces, so the nested
 * block inside it is stripped too), and assert the light rules survive in
 * normal CSS — plus that no light rule remains inside a forced-colors
 * block. Contrast values themselves are verified by the computed-ratio
 * table in the light-theme audit report and by axe with contrast enabled
 * in the Playwright light-theme test.
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

describe('light theme stylesheet', () => {
  it('keeps light rules out of forced-colors blocks', async () => {
    const css = await stylesheet();
    expect(forcedColorsBlocks(css)).not.toContain("data-theme='light'");
  });

  it('applies the light palette in normal CSS', async () => {
    const css = await stylesheet();
    const normal = stripMediaBlocks(css, '@media (forced-colors: active)');
    expect(normal).toContain('@media (forced-colors: none)');
    expect(normal).toMatch(/:root\[data-theme='light'\]\s*\{\s*color-scheme: light;/);
    // Dark values that fail on white must not carry over: focus sky blue
    // (1.67:1), placeholder pale slate (1.48:1), pale input border (2.56:1).
    expect(normal).toMatch(/:root\[data-theme='light'\][^{]*:focus-visible[^{]*\{\s*outline-color: #0369a1;/);
    expect(normal).toMatch(/:root\[data-theme='light'\] ::placeholder \{\s*color: #475569;/);
    expect(normal).toMatch(
      /:root\[data-theme='light'\] \.global-search input,\s*:root\[data-theme='light'\] \.command-palette input \{\s*border-color: #64748b;/,
    );
    expect(normal).toMatch(
      /:root\[data-theme='light'\] \.global-context-menu \{\s*border-color: #64748b;\s*background: #fff;/,
    );
    expect(normal).toMatch(/:root\[data-theme='light'\] \.command-list button \{\s*color: #0f172a;/);
    expect(normal).toMatch(
      /:root\[data-theme='light'\] \.modal-actions button:first-child \{\s*background: #1d4ed8;\s*border-color: #1e40af;\s*color: #fff;/,
    );
  });
});
