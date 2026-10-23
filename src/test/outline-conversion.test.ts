import { describe, expect, it } from 'vitest';
import { parseOutline } from '../shared/assets';
import { convertMarkdownToOutline } from '../shared/outline-conversion';

describe('Markdown to outline conversion', () => {
  it('nests headings by level and keeps body text on the heading item', () => {
    const { outline, warnings } = convertMarkdownToOutline(
      '# Project\nIntro text.\n## Phase One\nFirst phase body.\n## Phase Two\n### Detail\nDeep text.\n',
    );
    expect(warnings).toEqual([]);
    const roots = parseOutline(outline);
    expect(roots).toHaveLength(1);
    expect(roots[0].text).toBe('Project\nIntro text.');
    expect(roots[0].children.map((node) => node.text)).toEqual(['Phase One\nFirst phase body.', 'Phase Two']);
    expect(roots[0].children[1].children[0].text).toBe('Detail\nDeep text.');
  });

  it('omits front matter with a warning', () => {
    const { outline, warnings } = convertMarkdownToOutline('---\ntitle: Draft\ntags: [a]\n---\n# Heading\nBody.\n');
    expect(warnings).toContain('Front matter was omitted from the outline.');
    expect(outline).not.toContain('title: Draft');
    expect(parseOutline(outline)[0].text).toBe('Heading\nBody.');
  });

  it('keeps fenced code verbatim and nests lists under their heading', () => {
    const source = '# Guide\nSteps:\n- Install\n  - Download first\n- Run\n```sh\nnpm run build\n```\n';
    const { outline, warnings } = convertMarkdownToOutline(source);
    expect(warnings).toEqual([]);
    const roots = parseOutline(outline);
    expect(roots[0].children.map((node) => node.text)).toEqual(['Install', 'Run\n```sh\nnpm run build\n```']);
    expect(roots[0].children[0].children[0].text).toBe('Download first');
  });

  it('removes blockquote markers with a warning and keeps the text', () => {
    const { outline, warnings } = convertMarkdownToOutline('# Note\n> Quoted wisdom.\n');
    expect(warnings).toContain('Blockquote markers were removed; the quoted text was kept.');
    expect(parseOutline(outline)[0].text).toBe('Note\nQuoted wisdom.');
  });

  it('warns when heading levels are skipped', () => {
    const { warnings } = convertMarkdownToOutline('# Top\n### Deep\n');
    expect(warnings).toContain('Some heading levels were skipped; the outline nesting was adjusted.');
  });

  it('converts documents without headings into root items', () => {
    const { outline } = convertMarkdownToOutline('Opening paragraph.\n\n- One\n- Two\n');
    const roots = parseOutline(outline);
    expect(roots[0].text).toBe('Opening paragraph.');
    expect(roots[0].children.map((node) => node.text)).toEqual(['One', 'Two']);
  });

  it('promotes setext headings', () => {
    const { outline } = convertMarkdownToOutline('Big Title\n=========\nBody.\n');
    const roots = parseOutline(outline);
    expect(roots[0].text).toBe('Big Title\nBody.');
  });

  it('reports an empty note', () => {
    const { outline, warnings } = convertMarkdownToOutline('  \n\n');
    expect(outline).toBe('');
    expect(warnings).toContain('The note has no content to convert.');
  });
});
