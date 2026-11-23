// @vitest-environment node
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import type { BookmarkAnchor } from '../shared/types';
import {
  alignRenderedSegmentsToSourceLines,
  headingAnchorAt,
  headingAnchorAtSourceIndex,
  headingAnchorForRenderedText,
  headingSourceIndex,
  headingTextSpan,
  lineQueryOccurrence,
  lineSpanAt,
  listHeadings,
  normalizeHeadingText,
  orderBookmarksByOffset,
  readingJumpHeading,
  renderedFormOfSourceLine,
  renderedLineAtOffset,
  resolveBookmarkAnchor,
  sameAnchor,
  sanitizeBookmarkAnchor,
  sourceOffsetForRenderedSegment,
  surroundingText,
} from '../shared/bookmark-anchors';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

const markdown = ['# Title', '', 'Intro.', '', '## Setup', '', 'Steps.', '', '## Setup', '', 'Again.'].join('\n');

describe('bookmark anchors', () => {
  it('lists Markdown headings in order, ignoring fenced code', () => {
    const content = ['# Real', '', '```md', '# Fake', '```', '', '## Next'].join('\n');
    expect(listHeadings(content, false).map((hit) => hit.text)).toEqual(['Real', 'Next']);
  });

  it('lists HTML headings with inner markup stripped', () => {
    expect(listHeadings('<h1>Top</h1><p>x</p><h2 id="a">Sub <em>part</em></h2>', true)).toEqual([
      { text: 'Top', start: 0 },
      { text: 'Sub part', start: 20 },
    ]);
  });

  it('anchors the heading at or before the caret, counting duplicate occurrences', () => {
    const secondSetup = markdown.lastIndexOf('## Setup');
    expect(headingAnchorAt(markdown, false, secondSetup + 3)).toEqual({
      kind: 'heading',
      text: 'Setup',
      occurrence: 1,
    });
    expect(headingAnchorAt(markdown, false, 0)).toEqual({ kind: 'heading', text: 'Title', occurrence: 0 });
    expect(headingAnchorAt('plain text only', false, 4)).toBeNull();
  });

  it('resolves heading anchors by occurrence, falls back to the first match, and reports gone headings', () => {
    const anchor = { kind: 'heading', text: 'Setup', occurrence: 1 } as const;
    expect(resolveBookmarkAnchor(markdown, false, anchor)).toBe(markdown.lastIndexOf('## Setup'));
    expect(resolveBookmarkAnchor(markdown.replace('## Setup\n\nAgain.', '## Other'), false, anchor)).toBe(
      markdown.indexOf('## Setup'),
    );
    expect(resolveBookmarkAnchor('# Only\n', false, anchor)).toBeNull();
    expect(resolveBookmarkAnchor(markdown, false, { kind: 'offset', offset: 9999 })).toBe(markdown.length);
    // A PDF page anchor has no meaning inside note text.
    expect(resolveBookmarkAnchor(markdown, false, { kind: 'page', page: 2, offset: 10 })).toBeNull();
  });

  it('sanitizes untrusted anchor values', () => {
    expect(sanitizeBookmarkAnchor({ kind: 'heading', text: 'A', occurrence: 2 })).toEqual({
      kind: 'heading',
      text: 'A',
      occurrence: 2,
    });
    expect(sanitizeBookmarkAnchor({ kind: 'offset', offset: 12.7 })).toEqual({ kind: 'offset', offset: 12 });
    expect(sanitizeBookmarkAnchor({ kind: 'page', page: 3, offset: 42.9 })).toEqual({
      kind: 'page',
      page: 3,
      offset: 42,
    });
    expect(sanitizeBookmarkAnchor({ kind: 'heading', text: '', occurrence: 0 })).toBeUndefined();
    expect(sanitizeBookmarkAnchor({ kind: 'offset', offset: -1 })).toBeUndefined();
    expect(sanitizeBookmarkAnchor({ kind: 'page', page: 0, offset: 0 })).toBeUndefined();
    expect(sanitizeBookmarkAnchor({ kind: 'page', page: 1, offset: -1 })).toBeUndefined();
    expect(sanitizeBookmarkAnchor({ kind: 'page', page: 1.5, offset: 0 })).toBeUndefined();
    expect(sanitizeBookmarkAnchor('heading')).toBeUndefined();
  });

  it('persists anchored bookmarks idempotently and removes them by id', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-bookmarks-'));
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    await service.createNote('Guide.md');
    await service.saveNote('Guide.md', markdown);
    const anchor = { kind: 'heading', text: 'Setup', occurrence: 1 } as const;
    const added = await service.addBookmark('Guide.md', anchor);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ path: 'Guide.md', title: 'Setup', anchor });
    expect(await service.addBookmark('Guide.md', anchor)).toHaveLength(1); // duplicate is a no-op
    const withPosition = await service.addBookmark('Guide.md', { kind: 'offset', offset: 5 });
    expect(withPosition).toHaveLength(2);
    const reloaded = await service.getBookmarks();
    expect(reloaded.find((bookmark) => bookmark.anchor?.kind === 'heading')?.anchor).toEqual(anchor);
    const remaining = await service.removeBookmark(added[0].id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].anchor).toEqual({ kind: 'offset', offset: 5 });
    // Anchored bookmarks follow the note when it moves.
    await service.moveEntry('Guide.md', 'Moved.md');
    const migrated = await service.getBookmarks();
    expect(migrated.every((bookmark) => bookmark.path === 'Moved.md')).toBe(true);
  });

  it('stores a chosen name and the surrounding text for a position bookmark', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-bookmarks-'));
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    await service.createNote('Guide.md');
    await service.saveNote('Guide.md', markdown);
    const named = await service.addBookmark(
      'Guide.md',
      { kind: 'heading', text: 'Setup', occurrence: 0 },
      'My setup section',
    );
    expect(named[0]).toMatchObject({ title: 'Setup', name: 'My setup section' });
    const positioned = await service.addBookmark(
      'Guide.md',
      { kind: 'offset', offset: markdown.indexOf('Steps.') },
      'Where the steps start',
      'Steps.',
    );
    expect(positioned[1]).toMatchObject({
      title: 'Guide',
      name: 'Where the steps start',
      context: 'Steps.',
    });
    const reloaded = await service.getBookmarks();
    expect(reloaded[0]).toMatchObject({ name: 'My setup section' });
    expect(reloaded[1]).toMatchObject({ name: 'Where the steps start', context: 'Steps.' });
  });

  it('stores PDF page bookmarks, keeps them across reloads, and follows the file on move', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-bookmarks-'));
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    await copyFile(
      fileURLToPath(new URL('./fixtures/chrome-tagged-sample.pdf', import.meta.url)),
      path.join(temporaryDirectory, 'Guide.pdf'),
    );
    const added = await service.addBookmark('Guide.pdf', { kind: 'page', page: 2, offset: 120 }, 'Methods section');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      path: 'Guide.pdf',
      title: 'Guide',
      name: 'Methods section',
      anchor: { kind: 'page', page: 2, offset: 120 },
    });
    expect(
      await service.addBookmark('Guide.pdf', { kind: 'page', page: 2, offset: 120 }, 'Methods section'),
    ).toHaveLength(1); // duplicate is a no-op
    const other = await service.addBookmark('Guide.pdf', { kind: 'page', page: 1, offset: 0 }, 'Page 1');
    expect(other).toHaveLength(2);
    const reloaded = await service.getBookmarks();
    expect(reloaded.map((bookmark) => bookmark.anchor)).toEqual([
      { kind: 'page', page: 2, offset: 120 },
      { kind: 'page', page: 1, offset: 0 },
    ]);
    // A PDF bookmark follows the file when it moves, like a note bookmark.
    await service.moveEntry('Guide.pdf', 'Renamed.pdf');
    const migrated = await service.getBookmarks();
    expect(migrated.every((bookmark) => bookmark.path === 'Renamed.pdf')).toBe(true);
    expect(migrated.every((bookmark) => bookmark.title === 'Renamed')).toBe(true);
    const remaining = await service.removeBookmark(migrated[0].id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].anchor).toEqual({ kind: 'page', page: 1, offset: 0 });
  });
});

describe('sameAnchor and orderBookmarksByOffset', () => {
  it('compares anchors by value, not by object identity', () => {
    expect(
      sameAnchor({ kind: 'heading', text: 'Setup', occurrence: 0 }, { kind: 'heading', text: 'Setup', occurrence: 0 }),
    ).toBe(true);
    expect(
      sameAnchor({ kind: 'heading', text: 'Setup', occurrence: 0 }, { kind: 'heading', text: 'Setup', occurrence: 1 }),
    ).toBe(false);
    expect(sameAnchor({ kind: 'offset', offset: 12 }, { kind: 'offset', offset: 12 })).toBe(true);
    expect(sameAnchor({ kind: 'offset', offset: 12 }, { kind: 'offset', offset: 13 })).toBe(false);
    expect(sameAnchor({ kind: 'page', page: 2, offset: 5 }, { kind: 'page', page: 2, offset: 5 })).toBe(true);
    expect(sameAnchor({ kind: 'page', page: 2, offset: 5 }, { kind: 'page', page: 3, offset: 5 })).toBe(false);
    expect(sameAnchor({ kind: 'offset', offset: 1 }, { kind: 'page', page: 1, offset: 1 })).toBe(false);
    expect(sameAnchor(undefined, undefined)).toBe(true);
    expect(sameAnchor(undefined, { kind: 'offset', offset: 0 })).toBe(false);
    expect(sameAnchor(null, null)).toBe(true);
  });

  it('orders bookmarks by their resolved offset and drops unresolvable ones', () => {
    const bookmarks: { id: string; anchor?: BookmarkAnchor }[] = [
      { id: 'late', anchor: { kind: 'offset', offset: markdown.indexOf('Again.') } },
      { id: 'gone', anchor: { kind: 'heading', text: 'Missing', occurrence: 0 } },
      { id: 'first-setup', anchor: { kind: 'heading', text: 'Setup', occurrence: 0 } },
      { id: 'intro', anchor: { kind: 'offset', offset: markdown.indexOf('Intro.') } },
      { id: 'second-setup', anchor: { kind: 'heading', text: 'Setup', occurrence: 1 } },
      { id: 'no-anchor' },
    ];
    const ordered = orderBookmarksByOffset(markdown, false, bookmarks);
    expect(ordered.map((item) => item.bookmark.id)).toEqual(['intro', 'first-setup', 'second-setup', 'late']);
    expect(ordered.map((item) => item.offset)).toEqual([
      markdown.indexOf('Intro.'),
      markdown.indexOf('## Setup'),
      markdown.indexOf('## Setup', markdown.indexOf('## Setup') + 1),
      markdown.indexOf('Again.'),
    ]);
  });

  it('keeps bookmarks at the same offset in listed order', () => {
    const at = markdown.indexOf('Steps.');
    const ordered = orderBookmarksByOffset(markdown, false, [
      { id: 'b', anchor: { kind: 'offset', offset: at } },
      { id: 'a', anchor: { kind: 'offset', offset: at } },
    ]);
    expect(ordered.map((item) => item.bookmark.id)).toEqual(['b', 'a']);
  });
});

describe('readingJumpHeading', () => {
  it('returns a heading anchor itself when its heading exists', () => {
    expect(readingJumpHeading(markdown, false, { kind: 'heading', text: 'Setup', occurrence: 1 })).toEqual({
      kind: 'heading',
      text: 'Setup',
      occurrence: 1,
    });
    expect(readingJumpHeading(markdown, false, { kind: 'heading', text: 'Missing', occurrence: 0 })).toBeNull();
  });

  it('maps a position anchor to the heading at or before it', () => {
    const secondSetup = markdown.indexOf('Again.');
    expect(readingJumpHeading(markdown, false, { kind: 'offset', offset: secondSetup })).toEqual({
      kind: 'heading',
      text: 'Setup',
      occurrence: 1,
    });
    expect(readingJumpHeading(markdown, false, { kind: 'offset', offset: markdown.indexOf('Intro.') })).toEqual({
      kind: 'heading',
      text: 'Title',
      occurrence: 0,
    });
    expect(readingJumpHeading('Intro first.\n\n# Title\n', false, { kind: 'offset', offset: 0 })).toBeNull();
  });

  it('has no heading to jump to for a PDF page anchor', () => {
    expect(readingJumpHeading(markdown, false, { kind: 'page', page: 1, offset: 0 })).toBeNull();
  });
});

describe('normalizeHeadingText', () => {
  it('strips inline Markdown formatting to the rendered text', () => {
    expect(normalizeHeadingText('Hello *world*')).toBe('Hello world');
    expect(normalizeHeadingText('**Bold** and _italic_')).toBe('Bold and italic');
    expect(normalizeHeadingText('Use `code` here')).toBe('Use code here');
    expect(normalizeHeadingText('Read [the guide](https://example.com) first')).toBe('Read the guide first');
    expect(normalizeHeadingText('See [the guide][g]')).toBe('See the guide');
    expect(normalizeHeadingText('Plain heading')).toBe('Plain heading');
    expect(normalizeHeadingText('  Spaced  ')).toBe('Spaced');
  });

  it('renders wiki links as their label, or their target without one', () => {
    expect(normalizeHeadingText('[[Usage]]')).toBe('Usage');
    expect(normalizeHeadingText('[[Guide|the guide]]')).toBe('the guide');
    expect(normalizeHeadingText('Notes on [[Setup]] today')).toBe('Notes on Setup today');
  });

  it('drops images, which contribute no text to the rendered heading', () => {
    expect(normalizeHeadingText('![logo](logo.png) Usage')).toBe('Usage');
    expect(normalizeHeadingText('Usage ![chart](chart.png)')).toBe('Usage');
  });

  it('renders autolinks as their address', () => {
    expect(normalizeHeadingText('See <https://example.com> for details')).toBe('See https://example.com for details');
    expect(normalizeHeadingText('Mail <help@example.com>')).toBe('Mail help@example.com');
  });

  it('decodes HTML entities the way the rendered heading reads them', () => {
    expect(normalizeHeadingText('Fish &copy; Chips')).toBe('Fish © Chips');
    expect(normalizeHeadingText('Fish &#169; Chips')).toBe('Fish © Chips');
    expect(normalizeHeadingText('Fish &#xA9; Chips')).toBe('Fish © Chips');
    expect(normalizeHeadingText('Terms &amp; Conditions')).toBe('Terms & Conditions');
    expect(normalizeHeadingText('Wait &hellip;')).toBe('Wait …');
    expect(normalizeHeadingText('A &mdash; B')).toBe('A — B');
    expect(normalizeHeadingText('An &unknown; entity')).toBe('An &unknown; entity');
  });

  it('drops footnote references, which render as a superscript number', () => {
    expect(normalizeHeadingText('Usage[^1]')).toBe('Usage');
    expect(normalizeHeadingText('Notes[^intro] here')).toBe('Notes here');
  });
});

describe('headingTextSpan and lineSpanAt', () => {
  it('spans a heading anchor text, skipping the Markdown markers', () => {
    const start = markdown.indexOf('## Setup');
    const span = headingTextSpan(markdown, false, { kind: 'heading', text: 'Setup', occurrence: 0 });
    expect(span).toEqual({ start: start + 3, end: start + 8 });
    expect(markdown.slice(span!.start, span!.end)).toBe('Setup');
  });

  it('spans a formatted heading anchor text as written in source', () => {
    const content = '# Title\n\n## Hello *world*\n';
    const start = content.indexOf('## Hello *world*');
    const span = headingTextSpan(content, false, { kind: 'heading', text: 'Hello *world*', occurrence: 0 });
    expect(span).toEqual({ start: start + 3, end: start + 3 + 'Hello *world*'.length });
  });

  it('returns null for a position anchor or a missing heading', () => {
    expect(headingTextSpan(markdown, false, { kind: 'offset', offset: 0 })).toBeNull();
    expect(headingTextSpan(markdown, false, { kind: 'heading', text: 'Missing', occurrence: 0 })).toBeNull();
  });

  it('spans the trimmed line at an offset, and null for a blank line', () => {
    const content = '# Title\n\n  Intro text.  \n\nMore text.\n';
    const offset = content.indexOf('Intro text.');
    const span = lineSpanAt(content, offset);
    expect(span).not.toBeNull();
    expect(content.slice(span!.start, span!.end)).toBe('Intro text.');
    expect(lineSpanAt(content, content.indexOf('\nMore text.'))).toBeNull();
    expect(lineSpanAt('No newlines here', 5)).toEqual({ start: 0, end: 16 });
  });

  it('returns the rendered text around an offset for a bookmark name', () => {
    const content = '# Title\n\nIntro text.\n\n## **Setup** now\n\nDetails here.\n';
    expect(surroundingText(content, content.indexOf('Details here.'))).toBe('Details here.');
    expect(surroundingText(content, content.indexOf('## **Setup** now'))).toBe('Setup now');
    // A blank line falls back to the nearest non-blank line above it.
    expect(surroundingText(content, content.indexOf('\nDetails here.'))).toBe('Setup now');
    expect(surroundingText('', 0)).toBe('');
    expect(surroundingText('  \n\n  ', 1)).toBe('');
    const long = `Intro.\n\n${'word '.repeat(30).trim()}\n`;
    expect(surroundingText(long, long.indexOf('word'))).toBe(`${'word '.repeat(12).trim()}…`);
  });
});

describe('headingAnchorForRenderedText', () => {
  it('maps a rendered heading back to its source text and occurrence', () => {
    const content = '# Title\n\nIntro text.\n\n## Hello *world*\n\nDetails here.\n';
    // The reader sees "Hello world"; the anchor stores the source text.
    expect(headingAnchorForRenderedText(content, false, 'Hello world', 0)).toEqual({
      kind: 'heading',
      text: 'Hello *world*',
      occurrence: 0,
    });
  });

  it('counts duplicate headings by occurrence', () => {
    expect(headingAnchorForRenderedText(markdown, false, 'Setup', 1)).toEqual({
      kind: 'heading',
      text: 'Setup',
      occurrence: 1,
    });
    expect(headingAnchorForRenderedText(markdown, false, 'Setup', 2)).toBeNull();
  });

  it('returns null when the rendered heading is gone', () => {
    expect(headingAnchorForRenderedText(markdown, false, 'Missing', 0)).toBeNull();
  });

  it('maps a rendered wiki-link heading back to its source text', () => {
    const content = '# Title\n\nIntro text.\n\n## [[Usage]]\n\nDetails here.\n';
    // The reader sees "Usage"; the anchor stores the source text.
    expect(headingAnchorForRenderedText(content, false, 'Usage', 0)).toEqual({
      kind: 'heading',
      text: '[[Usage]]',
      occurrence: 0,
    });
    const labelled = '# Title\n\n## [[Guide|the guide]]\n';
    expect(headingAnchorForRenderedText(labelled, false, 'the guide', 0)).toEqual({
      kind: 'heading',
      text: '[[Guide|the guide]]',
      occurrence: 0,
    });
  });

  it('maps a rendered image heading back to its source text', () => {
    const content = '# Title\n\n## ![logo](logo.png) Usage\n';
    expect(headingAnchorForRenderedText(content, false, 'Usage', 0)).toEqual({
      kind: 'heading',
      text: '![logo](logo.png) Usage',
      occurrence: 0,
    });
  });
});

describe('headingSourceIndex and headingAnchorAtSourceIndex', () => {
  const indexed = '# Title\n\nIntro.\n\n## Setup\n\nSteps.\n\n## Usage[^1]\n\nDetails.\n\n[^1]: A footnote.\n';

  it('maps an anchor to its heading index in source order', () => {
    expect(headingSourceIndex(indexed, false, { kind: 'heading', text: 'Title', occurrence: 0 })).toBe(0);
    expect(headingSourceIndex(indexed, false, { kind: 'heading', text: 'Setup', occurrence: 0 })).toBe(1);
    expect(headingSourceIndex(indexed, false, { kind: 'heading', text: 'Usage[^1]', occurrence: 0 })).toBe(2);
    expect(headingSourceIndex(indexed, false, { kind: 'heading', text: 'Missing', occurrence: 0 })).toBeNull();
  });

  it('maps a source index back to its anchor, counting duplicates', () => {
    expect(headingAnchorAtSourceIndex(markdown, false, 1)).toEqual({
      kind: 'heading',
      text: 'Setup',
      occurrence: 0,
    });
    expect(headingAnchorAtSourceIndex(markdown, false, 2)).toEqual({
      kind: 'heading',
      text: 'Setup',
      occurrence: 1,
    });
    expect(headingAnchorAtSourceIndex(indexed, false, 2)).toEqual({
      kind: 'heading',
      text: 'Usage[^1]',
      occurrence: 0,
    });
    expect(headingAnchorAtSourceIndex(markdown, false, 9)).toBeNull();
  });
});

describe('renderedFormOfSourceLine', () => {
  it('strips block and inline markers to the rendered text', () => {
    expect(renderedFormOfSourceLine('## Hello *world*', false)).toBe('Hello world');
    expect(renderedFormOfSourceLine('- [ ] Buy milk', false)).toBe('Buy milk');
    expect(renderedFormOfSourceLine('> Quoted text', false)).toBe('Quoted text');
    expect(renderedFormOfSourceLine('1. First item', false)).toBe('First item');
    expect(renderedFormOfSourceLine('See [the guide](https://example.com) here', false)).toBe(
      'See the guide here',
    );
  });

  it('renders image-only and setext lines as no text', () => {
    expect(renderedFormOfSourceLine('![logo](logo.png)', false)).toBe('');
    expect(renderedFormOfSourceLine('===', false)).toBe('');
    expect(renderedFormOfSourceLine('---', false)).toBe('');
  });

  it('renders fenced code lines literally', () => {
    expect(renderedFormOfSourceLine('const x = 1; // *not* emphasis', true)).toBe(
      'const x = 1; // *not* emphasis',
    );
    expect(renderedFormOfSourceLine('# not a heading', true)).toBe('# not a heading');
  });
});

describe('lineQueryOccurrence and renderedLineAtOffset', () => {
  const repeated = '# Title\n\nDetails here are many.\n\nDetails here are few.\n';

  it('counts earlier lines that start with the same first words', () => {
    const first = repeated.indexOf('Details here are many.');
    const second = repeated.indexOf('Details here are few.');
    expect(lineQueryOccurrence(repeated, first, 3)).toBe(0);
    expect(lineQueryOccurrence(repeated, second, 3)).toBe(1);
    expect(lineQueryOccurrence(repeated, second, 1)).toBe(1);
    expect(lineQueryOccurrence(repeated, first, 1)).toBe(0);
  });

  it('returns the rendered line and its occurrences at an offset', () => {
    const offset = repeated.indexOf('Details here are few.');
    expect(renderedLineAtOffset(repeated, offset)).toEqual({
      text: 'Details here are few.',
      occurrences: [1, 1, 1],
    });
    expect(renderedLineAtOffset(repeated, 0)).toEqual({ text: 'Title', occurrences: [0, 0, 0] });
  });

  it('lands on the nearest non-blank line from a blank line, forward first', () => {
    // One character before the second Details line: the blank line above it.
    const blankOffset = repeated.indexOf('Details here are few.') - 1;
    expect(renderedLineAtOffset(repeated, blankOffset)?.text).toBe('Details here are few.');
    const trailing = '# Title\n\nIntro.\n\n';
    expect(renderedLineAtOffset(trailing, trailing.length)?.text).toBe('Intro.');
    expect(renderedLineAtOffset('', 0)).toBeNull();
  });
});

describe('alignRenderedSegmentsToSourceLines', () => {
  const content = '# Title\n\nIntro text.\n\n## Setup\n\nDetails here.\n\n![logo](logo.png)\n\nMore text.\n';

  it('maps rendered lines to source lines in order, skipping lines with no text', () => {
    const segments = ['Title', 'Intro text.', 'Setup', 'Details here.', 'More text.'];
    expect(alignRenderedSegmentsToSourceLines(content, segments)).toEqual([0, 2, 4, 6, 10]);
    expect(sourceOffsetForRenderedSegment(content, false, segments, 4)).toBe(content.indexOf('More text.'));
    expect(sourceOffsetForRenderedSegment(content, false, segments, 2)).toBe(content.indexOf('## Setup'));
  });

  it('maps duplicate segments to duplicate lines in order', () => {
    const doubled = 'Same line.\n\nSame line.\n';
    expect(alignRenderedSegmentsToSourceLines(doubled, ['Same line.', 'Same line.'])).toEqual([0, 2]);
  });

  it('leaves unmappable segments unmapped, and HTML notes unmapped', () => {
    expect(alignRenderedSegmentsToSourceLines(content, ['No such line'])).toEqual([-1]);
    expect(sourceOffsetForRenderedSegment(content, false, ['No such line'], 0)).toBeNull();
    expect(sourceOffsetForRenderedSegment('<h1>Title</h1>\n<p>Intro.</p>', true, ['Title'], 0)).toBeNull();
    expect(sourceOffsetForRenderedSegment(content, false, ['Title'], 9)).toBeNull();
  });
});

describe('heading occurrence counting across raw and rendered text', () => {
  // Two headings read the same after formatting is stripped, but their
  // source texts differ — so an occurrence counted one way indexes the
  // wrong heading the other way. A bookmark made from reading mode on
  // the third heading used to store occurrence 2 (among readings) and
  // then jump to the second heading.
  const mixed = '# Hello *world*\n\n# Hello world\n\n# Hello world\n';

  it('returns the source-text occurrence from a rendered heading', () => {
    expect(headingAnchorForRenderedText(mixed, false, 'Hello world', 2)).toEqual({
      kind: 'heading',
      text: 'Hello world',
      occurrence: 1,
    });
    expect(headingAnchorForRenderedText(mixed, false, 'Hello world', 0)).toEqual({
      kind: 'heading',
      text: 'Hello *world*',
      occurrence: 0,
    });
  });

  it('resolves a legacy normalized occurrence to the heading it meant', () => {
    const legacy = { kind: 'heading', text: 'Hello world', occurrence: 2 } as const;
    expect(resolveBookmarkAnchor(mixed, false, legacy)).toBe(mixed.lastIndexOf('# Hello world'));
  });
});
