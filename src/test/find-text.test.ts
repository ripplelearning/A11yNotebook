import { describe, expect, it } from 'vitest';
import { findAllMatches } from '../shared/find-text';

describe('findAllMatches', () => {
  it('returns nothing for an empty query', () => {
    expect(findAllMatches('Some text', '', false)).toEqual([]);
  });

  it('finds matches case-insensitively by default', () => {
    expect(findAllMatches('Idea and idea and IDEA', 'idea', false)).toEqual([
      { index: 0, length: 4 },
      { index: 9, length: 4 },
      { index: 18, length: 4 },
    ]);
  });

  it('respects case sensitivity when asked', () => {
    expect(findAllMatches('Idea and idea', 'idea', true)).toEqual([{ index: 9, length: 4 }]);
  });

  it('does not overlap matches', () => {
    expect(findAllMatches('aaaa', 'aa', false)).toEqual([
      { index: 0, length: 2 },
      { index: 2, length: 2 },
    ]);
  });

  it('returns nothing when there is no match', () => {
    expect(findAllMatches('Some text', 'missing', false)).toEqual([]);
  });
});
