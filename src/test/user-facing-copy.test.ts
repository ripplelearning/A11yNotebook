// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getKeyboardShortcuts } from '../shared/command-registry';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : /\.tsx?$/.test(filename) ? [filename] : [];
  });
}

describe('user-facing library terminology and shortcuts', () => {
  it('keeps legacy vault identifiers but uses library in displayed copy', () => {
    const violations: string[] = [];
    for (const filename of ['electron', 'src/renderer', 'src/shared'].flatMap(sourceFiles)) {
      const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (
          (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) &&
          !ts.isLiteralTypeNode(node.parent) &&
          /\bvaults?\b/i.test(node.text) &&
          (/\s/.test(node.text.trim()) || /^vaults?$/i.test(node.text))
        ) {
          violations.push(`${filename}: ${node.text.trim()}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(violations).toEqual([]);
  });

  it('documents every default command shortcut and alias shown by Help', () => {
    const reference = readFileSync('docs/keyboard-shortcuts.md', 'utf8');
    const rows = reference
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    for (const { label, shortcut } of getKeyboardShortcuts()) {
      expect(rows).toContainEqual([shortcut, label]);
    }
    expect(rows).toContainEqual(['Alt+Q', 'Focus search']);
    expect(readFileSync('docs/user-guide.md', 'utf8')).toMatch(/\| Alt\+Q\s+\| Focus global search/);
    expect(reference + readFileSync('docs/user-guide.md', 'utf8')).not.toContain('Ctrl+L');
  });

  it.each([
    'README.md',
    'CONTRIBUTING.md',
    'FEATURE_STATUS.md',
    'docs/user-guide.md',
    'docs/keyboard-shortcuts.md',
    'docs/security.md',
    'docs/architecture.md',
    'docs/roadmap.md',
    'docs/continuation-plan.md',
    'docs/pdf-semantic-phase1.md',
    'docs/accessibility/testing-strategy.md',
  ])('uses library terminology in %s while retaining documented internal names', (filename) => {
    const prose = readFileSync(filename, 'utf8').replace(/`[^`]*`/g, '');
    expect(prose).not.toMatch(/\bvaults?\b/i);
  });
});
