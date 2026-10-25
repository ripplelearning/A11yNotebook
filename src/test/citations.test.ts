import { describe, expect, it } from 'vitest';
import {
  formatBibliography,
  formatInText,
  parseAuthors,
  sortBibliography,
  type BibliographyEntry,
} from '../shared/citations';

const book: BibliographyEntry = {
  id: '1',
  notebookPath: 'Research',
  sourceType: 'book',
  authors: [{ last: 'Breitenfeldt', first: 'Tristen' }],
  title: 'Accessible Design',
  year: '2024',
  publisher: 'Open Press',
};

const journal: BibliographyEntry = {
  id: '2',
  notebookPath: 'Research',
  sourceType: 'journal',
  authors: [
    { last: 'Doe', first: 'Jane' },
    { last: 'Roe', first: 'Richard' },
    { last: 'Poe', first: 'Polly' },
  ],
  title: 'Screen readers and math',
  year: '2023',
  journal: 'Access Quarterly',
  volume: '12',
  issue: '3',
  pages: '45-67',
  doi: '10.1000/xyz123',
};

describe('citation formatting', () => {
  it('formats a book in APA, MLA, and Chicago', () => {
    expect(formatBibliography(book, 'apa')).toBe(
      'Breitenfeldt, T. (2024). *Accessible Design*. Open Press.',
    );
    expect(formatBibliography(book, 'mla')).toBe(
      'Breitenfeldt, Tristen. *Accessible Design*. Open Press, 2024.',
    );
    expect(formatBibliography(book, 'chicago')).toBe(
      'Breitenfeldt, Tristen. 2024. *Accessible Design*. Open Press.',
    );
  });

  it('formats a journal article with DOI in APA', () => {
    expect(formatBibliography(journal, 'apa')).toBe(
      'Doe, J., Roe, R., & Poe, P. (2023). Screen readers and math. *Access Quarterly*, *12*(3), 45-67. https://doi.org/10.1000/xyz123',
    );
  });

  it('formats in-text citations per style', () => {
    expect(formatInText(book, 'apa')).toBe('(Breitenfeldt, 2024)');
    expect(formatInText(journal, 'apa')).toBe('(Doe et al., 2023)');
    expect(formatInText(book, 'mla', '42')).toBe('(Breitenfeldt 42)');
    expect(formatInText(book, 'chicago', '42')).toBe('(Breitenfeldt 2024, 42)');
  });

  it('parses author lists', () => {
    expect(parseAuthors('Doe, Jane; Roe, Richard')).toEqual([
      { last: 'Doe', first: 'Jane' },
      { last: 'Roe', first: 'Richard' },
    ]);
    expect(parseAuthors('Jane Doe')).toEqual([{ last: 'Doe', first: 'Jane' }]);
  });

  it('sorts by author last name', () => {
    const sorted = sortBibliography([journal, book]);
    expect(sorted[0].id).toBe('1');
  });
});
