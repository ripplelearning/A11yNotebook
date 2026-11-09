import { describe, expect, it } from 'vitest';
import { mapEpubTocItems } from '../renderer/features/previews/epub-book';

describe('mapEpubTocItems', () => {
  it('maps epubjs navigation items to reader table-of-contents items, resolving every level', () => {
    const items = mapEpubTocItems(
      [
        {
          id: 'np1',
          href: 'Text/one.xhtml',
          title: 'First chapter',
          children: [
            { id: 'np2', href: 'Text/two.xhtml#heading', title: 'Second chapter', children: [] },
            {
              id: 'np3',
              href: 'Text/three.xhtml',
              title: 'Third chapter',
              children: [{ id: 'np4', href: 'Text/four.xhtml', title: 'Fourth chapter', children: [] }],
            },
          ],
        },
      ],
      (href) => `resolved:${href}`,
    );
    expect(items).toEqual([
      {
        label: 'First chapter',
        href: 'resolved:Text/one.xhtml',
        subitems: [
          { label: 'Second chapter', href: 'resolved:Text/two.xhtml#heading', subitems: undefined },
          {
            label: 'Third chapter',
            href: 'resolved:Text/three.xhtml',
            subitems: [{ label: 'Fourth chapter', href: 'resolved:Text/four.xhtml', subitems: undefined }],
          },
        ],
      },
    ]);
  });

  it('maps an empty table of contents to an empty list', () => {
    expect(mapEpubTocItems([], (href) => href)).toEqual([]);
  });
});
