import { describe, expect, it } from 'vitest';
import { lookupThesaurus as lookupEngine } from '../../electron/vault/thesaurus';

describe('thesaurus engine', () => {
  it('returns synonyms grouped by part of speech', () => {
    const groups = lookupEngine('happy');
    expect(groups.length).toBeGreaterThan(0);
    const adjectives = groups.find((group) => group.partOfSpeech === 'Adjective');
    expect(adjectives?.synonyms).toContain('glad');
  });

  it('returns nothing for an unknown word', () => {
    expect(lookupEngine('zzzqqq')).toEqual([]);
  });
});
