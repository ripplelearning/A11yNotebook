import { describe, expect, it } from 'vitest';
import { findAllMatches, findMatchSnippets, matchSnippet } from '../shared/find-text';

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

describe('findMatchSnippets', () => {
  it('shows context around each match and marks cut text with an ellipsis', () => {
    const text = 'A long opening sentence that keeps going. Idea in the middle of a sentence. And a long closing sentence that keeps going.';
    expect(findMatchSnippets(text, 'Idea', false, 10)).toEqual(['… ps going. Idea in the mi …']);
  });

  it('shows the whole text without ellipses when the match is near both ends', () => {
    expect(findMatchSnippets('Short Idea text', 'Idea', false, 40)).toEqual(['Short Idea text']);
  });

  it('collapses line breaks and indentation inside a snippet', () => {
    expect(findMatchSnippets('# Title\n\nIdea   again\nnext line', 'Idea', false, 40)).toEqual([
      '# Title Idea again next line',
    ]);
  });

  it('keeps the matched text verbatim in the snippet', () => {
    expect(matchSnippet('before IDEA after', { index: 7, length: 4 }, 40)).toBe('before IDEA after');
  });
});
