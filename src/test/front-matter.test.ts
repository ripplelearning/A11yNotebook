// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  parseFrontMatter,
  removeEntry,
  serializeFrontMatter,
  setList,
  setScalar,
  suggestKeys,
  suggestTags,
  suggestValues,
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
      { key: 'title', kind: 'scalar', value: 'Trip: West', items: [], raw: '"Trip: West"', scalarType: 'string' },
      { key: 'count', kind: 'scalar', value: '3', items: [], raw: '3', scalarType: 'number' },
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

  it('preserves scalar types on an untouched round trip and on same-type edits', () => {
    const original = '---\ncount: 5\nrating: 4.5\ndraft: true\nreviewed: ~\nlabel: "5"\nempty:\n---\nBody\n';
    const document = parseFrontMatter(original);
    expect(serializeFrontMatter(document.entries, document.body)).toBe(original);
    const edited = document.entries.map((entry) => {
      if (entry.key === 'count') return { ...entry, value: '6' };
      if (entry.key === 'draft') return { ...entry, value: 'false' };
      if (entry.key === 'reviewed') return { ...entry, value: 'null' };
      return entry;
    });
    expect(serializeFrontMatter(edited, document.body)).toBe(
      '---\ncount: 6\nrating: 4.5\ndraft: false\nreviewed: null\nlabel: "5"\nempty:\n---\nBody\n',
    );
  });

  it('falls back to a quoted string when an edited scalar changes type', () => {
    const document = parseFrontMatter('---\ncount: 5\n---\nBody\n');
    const edited = document.entries.map((entry) => ({ ...entry, value: 'five' }));
    expect(serializeFrontMatter(edited, document.body)).toBe('---\ncount: five\n---\nBody\n');
    const cleared = document.entries.map((entry) => ({ ...entry, value: '' }));
    expect(serializeFrontMatter(cleared, document.body)).toBe('---\ncount: ""\n---\nBody\n');
  });

  it('suggests library field names and values, excluding what the note already has', () => {
    const library = { Status: ['draft', 'done'], author: ['Sam', 'Jo'], tags: ['study'] };
    expect(suggestKeys(library, ['status'])).toEqual(['author', 'tags']);
    expect(suggestValues(library, 'status', ['Draft'])).toEqual(['done']);
    expect(suggestValues(library, 'STATUS', [])).toEqual(['draft', 'done']);
    expect(suggestValues(library, 'missing', [])).toEqual([]);
  });
});
