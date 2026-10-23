// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  parseFrontMatter,
  removeEntry,
  serializeFrontMatter,
  setList,
  setScalar,
  suggestTags,
  tagsOf,
} from '../shared/front-matter';

describe('front matter', () => {
  it('parses scalars, flow lists, comma values, and block lists; the body is preserved', () => {
    const content = [
      '---',
      'title: "Trip: West"',
      'count: 3',
      'tags: [alpha, beta]',
      'authors:',
      '  - Sam',
      "  - 'Jo Lee'",
      '---',
      '# Body',
      '',
      'Text.',
    ].join('\n');
    const document = parseFrontMatter(content);
    expect(document.supported).toBe(true);
    expect(document.hadFrontMatter).toBe(true);
    expect(document.body).toBe('# Body\n\nText.');
    expect(document.entries).toEqual([
      { key: 'title', kind: 'scalar', value: 'Trip: West', items: [] },
      { key: 'count', kind: 'scalar', value: '3', items: [] },
      { key: 'tags', kind: 'list', value: '', items: ['alpha', 'beta'] },
      { key: 'authors', kind: 'list', value: '', items: ['Sam', 'Jo Lee'] },
    ]);
    expect(tagsOf(document)).toEqual(['alpha', 'beta']);
  });

  it('reads comma-style tags and reports notes without front matter', () => {
    expect(tagsOf(parseFrontMatter('---\ntags: one, two\n---\nBody'))).toEqual(['one', 'two']);
    const plain = parseFrontMatter('# Just a heading\n');
    expect(plain).toMatchObject({ supported: true, hadFrontMatter: false, entries: [] });
    expect(plain.body).toBe('# Just a heading\n');
  });

  it('refuses structured editing for nested or unclosed blocks instead of guessing', () => {
    const nested = parseFrontMatter('---\nauthor:\n  name: Sam\n---\nBody');
    expect(nested.supported).toBe(false);
    expect(nested.unsupportedReason).toContain('Indented');
    expect(parseFrontMatter('---\ntitle: x\nBody without a closing line').supported).toBe(false);
    expect(parseFrontMatter('---\nsummary: |\n  multi\n---\nBody').supported).toBe(false);
  });

  it('round-trips edits: set, list, and remove touch only the block', () => {
    const original = '---\ntitle: Old\ntags: [a]\n---\nBody stays.\n';
    let entries = parseFrontMatter(original).entries;
    entries = setScalar(entries, 'title', 'New: Title');
    entries = setList(entries, 'tags', ['a', 'b c']);
    entries = setScalar(entries, 'status', 'draft');
    entries = removeEntry(entries, 'status');
    const rewritten = serializeFrontMatter(entries, parseFrontMatter(original).body);
    expect(rewritten).toBe('---\ntitle: "New: Title"\ntags:\n  - a\n  - b c\n---\nBody stays.\n');
    // And the rewritten note parses back to the same entries.
    expect(parseFrontMatter(rewritten).entries).toEqual(entries);
    // Removing every entry removes the block entirely.
    expect(serializeFrontMatter([], 'Body stays.\n')).toBe('Body stays.\n');
  });

  it('suggests library tags the note does not already have, case-insensitively', () => {
    expect(suggestTags(['Research', 'travel', 'Admin'], ['research'])).toEqual(['travel', 'Admin']);
    expect(suggestTags([], ['a'])).toEqual([]);
  });
});
