import { describe, expect, it } from 'vitest';
import { retargetLinkContent } from '../shared/link-retarget';

describe('retargetLinkContent', () => {
  it('rewrites an inline Markdown link to the new note, relative to the source', () => {
    expect(retargetLinkContent('See [Guide](./Old.md) here.', 'Notes/Start.md', './Old.md', 'Notes/New.md')).toBe(
      'See [Guide](New.md) here.',
    );
  });

  it('rewrites a link across notebooks with parent segments and drops .md for extensionless originals', () => {
    expect(retargetLinkContent('See [Guide](Old) here.', 'Notes/Start.md', 'Old', 'Archive/New.md')).toBe(
      'See [Guide](../Archive/New) here.',
    );
  });

  it('preserves fragments, queries, and link titles', () => {
    expect(
      retargetLinkContent('See [Guide](./Old.md#part "Title") and [Other](./Old.md?x=1).', 'Start.md', './Old.md', 'New.md'),
    ).toBe('See [Guide](New.md#part "Title") and [Other](New.md?x=1).');
  });

  it('rewrites wiki links, keeping aliases and fragments, qualifying cross-notebook targets', () => {
    expect(retargetLinkContent('See [[Old|the guide]] and [[Old#part]].', 'Notes/Start.md', 'Old', 'Notes/New.md')).toBe(
      'See [[New|the guide]] and [[New#part]].',
    );
    expect(retargetLinkContent('See [[Old]].', 'Notes/Start.md', 'Old', 'Archive/New.md')).toBe(
      'See [[Archive/New]].',
    );
  });

  it('rewrites reference definitions, repairing every usage at once', () => {
    const content = 'See [Guide][g] and again [Guide][g].\n\n[g]: ./Old.md "Title"\n';
    expect(retargetLinkContent(content, 'Start.md', './Old.md', 'New.md')).toBe(
      'See [Guide][g] and again [Guide][g].\n\n[g]: New.md "Title"\n',
    );
  });

  it('leaves fenced blocks, inline code, external links, and other targets untouched', () => {
    const content = '```\n[Guide](./Old.md)\n```\n\n`[Guide](./Old.md)`\n\n[Web](https://example.com)\n\n[Kept](./Kept.md)\n';
    // Nothing rewritable matches, so the result is null rather than an identical copy.
    expect(retargetLinkContent(content, 'Start.md', './Old.md', 'New.md')).toBeNull();
  });

  it('rewrites HTML href attributes and returns null when nothing matched', () => {
    expect(
      retargetLinkContent('<p><a href="./Old.md">Guide</a> <a href="./Kept.md">Kept</a></p>', 'Page.html', './Old.md', 'New.md'),
    ).toBe('<p><a href="New.md">Guide</a> <a href="./Kept.md">Kept</a></p>');
    expect(retargetLinkContent('No links here.', 'Start.md', './Old.md', 'New.md')).toBeNull();
    expect(retargetLinkContent('See [Guide](./Kept.md).', 'Start.md', './Old.md', 'New.md')).toBeNull();
  });
});
