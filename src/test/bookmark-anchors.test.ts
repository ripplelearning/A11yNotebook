// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import {
  headingAnchorAt,
  listHeadings,
  resolveBookmarkAnchor,
  sanitizeBookmarkAnchor,
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
  });

  it('sanitizes untrusted anchor values', () => {
    expect(sanitizeBookmarkAnchor({ kind: 'heading', text: 'A', occurrence: 2 })).toEqual({
      kind: 'heading',
      text: 'A',
      occurrence: 2,
    });
    expect(sanitizeBookmarkAnchor({ kind: 'offset', offset: 12.7 })).toEqual({ kind: 'offset', offset: 12 });
    expect(sanitizeBookmarkAnchor({ kind: 'heading', text: '', occurrence: 0 })).toBeUndefined();
    expect(sanitizeBookmarkAnchor({ kind: 'offset', offset: -1 })).toBeUndefined();
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
});
