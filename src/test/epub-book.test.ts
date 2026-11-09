import { describe, expect, it } from 'vitest';
import type { EpubBook } from 'epubjs/src/index.js';
import { mapEpubTocItems, patchFindInSpine } from '../renderer/features/previews/epub-book';

describe('patchFindInSpine', () => {
  function patchedRendition() {
    const spine = [{ href: 'Text/one.xhtml' }, { href: 'Text/two.xhtml' }];
    const rendition = {
      display: async () => undefined,
      attachTo: () => undefined,
      destroy: () => undefined,
      epubcfi: {
        isCfiString: (target: string) => typeof target === 'string' && target.startsWith('epubcfi('),
      },
      spineByHref: { 'Text/one.xhtml': 0, 'Text/two.xhtml': 1 },
      spineBySource: { 'Text/one.xhtml': 0, 'Text/two.xhtml': 1 },
      spineById: { one: 0, two: 1 },
      manifest: { spine },
    };
    const fakeEpub = {
      CFI: class {
        spinePos = 1;
      },
    };
    patchFindInSpine(fakeEpub, rendition as unknown as ReturnType<EpubBook['renderTo']>);
    return { rendition, spine };
  }

  it('finds the first section by href (upstream drops index 0)', () => {
    const { rendition, spine } = patchedRendition();
    const findable = rendition as unknown as { findInSpine: (target: string | number) => unknown };
    expect(findable.findInSpine('Text/one.xhtml')).toBe(spine[0]);
    expect(findable.findInSpine('Text/two.xhtml')).toBe(spine[1]);
  });

  it('strips fragments for the lookup, returns null for unknown hrefs, and handles CFI, index, and id targets', () => {
    const { rendition, spine } = patchedRendition();
    const findable = rendition as unknown as { findInSpine: (target: string | number) => unknown };
    expect(findable.findInSpine('Text/one.xhtml#heading')).toBe(spine[0]);
    expect(findable.findInSpine('Text/missing.xhtml')).toBeNull();
    expect(findable.findInSpine('epubcfi(/6/4!/2/1:0)')).toBe(spine[1]);
    expect(findable.findInSpine(0)).toBe(spine[0]);
    expect(findable.findInSpine('#one')).toBe(spine[0]);
  });
});

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
