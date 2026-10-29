import { describe, expect, it } from 'vitest';
import { filterHiddenOriginals, supersededPaths } from '../shared/library-views';
import type { VaultEntry } from '../shared/types';

const entries: VaultEntry[] = [
  {
    name: 'Research',
    path: 'Research',
    kind: 'notebook',
    children: [
      { name: 'Original.md', path: 'Research/Original.md', kind: 'note', superseded: true },
      { name: 'Copy.md', path: 'Research/Copy.md', kind: 'note', provenance: 'imported' },
    ],
  },
  { name: 'Loose.md', path: 'Loose.md', kind: 'note', superseded: true },
];

describe('hidden originals', () => {
  it('hides superseded leaves but keeps notebooks and managed copies', () => {
    const filtered = filterHiddenOriginals(entries, false);
    expect(filtered.map((entry) => entry.path)).toEqual(['Research']);
    expect(filtered[0].children?.map((entry) => entry.path)).toEqual(['Research/Copy.md']);
  });

  it('shows everything when originals are shown', () => {
    expect(filterHiddenOriginals(entries, true)).toEqual(entries);
  });

  it('collects superseded paths recursively', () => {
    expect(supersededPaths(entries)).toEqual(new Set(['Research/Original.md', 'Loose.md']));
  });
});
