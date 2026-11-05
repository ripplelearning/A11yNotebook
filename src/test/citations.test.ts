import { describe, expect, it } from 'vitest';
import {
  formatBibliography,
  formatBibliographyBlock,
  formatInText,
  parseAuthors,
  sortBibliography,
  type BibliographyEntry,
} from '../shared/citations';

const book: BibliographyEntry = {
  id: '1',
  notebookPath: 'Research',
  sourceType: 'book',
  authors: [{ last: 'Rivera', first: 'Alex' }],
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
      'Rivera, A. (2024). *Accessible Design*. Open Press.',
    );
    expect(formatBibliography(book, 'mla')).toBe(
      'Rivera, Alex. *Accessible Design*. Open Press, 2024.',
    );
    expect(formatBibliography(book, 'chicago')).toBe(
      'Rivera, Alex. 2024. *Accessible Design*. Open Press.',
    );
  });

  it('formats a journal article with DOI in APA', () => {
    expect(formatBibliography(journal, 'apa')).toBe(
      'Doe, J., Roe, R., & Poe, P. (2023). Screen readers and math. *Access Quarterly*, *12*(3), 45-67. https://doi.org/10.1000/xyz123',
    );
  });

  it('formats in-text citations per style', () => {
    expect(formatInText(book, 'apa')).toBe('(Rivera, 2024)');
    expect(formatInText(journal, 'apa')).toBe('(Doe et al., 2023)');
    expect(formatInText(book, 'mla', '42')).toBe('(Rivera 42)');
    expect(formatInText(book, 'chicago', '42')).toBe('(Rivera 2024, 42)');
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
    expect(sorted[0].id).toBe('2');
  });

  it('uses (Ed.) for one APA chapter editor and (Eds.) for several', () => {
    const chapter: BibliographyEntry = {
      id: '3',
      notebookPath: 'Research',
      sourceType: 'chapter',
      authors: [{ last: 'Rivera', first: 'Alex' }],
      editors: [{ last: 'Chen', first: 'Bo' }],
      title: 'Reading with a screen reader',
      year: '2024',
      containerTitle: 'Accessible Design Handbook',
      pages: '10-25',
      publisher: 'Open Press',
    };
    expect(formatBibliography(chapter, 'apa')).toBe(
      'Rivera, A. (2024). Reading with a screen reader. In B. Chen (Ed.), *Accessible Design Handbook* (pp. 10-25). Open Press.',
    );
    expect(
      formatBibliography(
        { ...chapter, editors: [
          { last: 'Chen', first: 'Bo' },
          { last: 'Diaz', first: 'Ana' },
        ] },
        'apa',
      ),
    ).toBe(
      'Rivera, A. (2024). Reading with a screen reader. In B. Chen, A. Diaz (Eds.), *Accessible Design Handbook* (pp. 10-25). Open Press.',
    );
  });

  it('shows an APA retrieval date only for a web page with no publication date', () => {
    const website: BibliographyEntry = {
      id: '4',
      notebookPath: 'Research',
      sourceType: 'website',
      authors: [{ last: 'Rivera', first: 'Alex' }],
      title: 'Accessible design today',
      year: '2024',
      url: 'https://example.org/design',
      accessed: '2026-11-01',
    };
    expect(formatBibliography(website, 'apa')).toBe(
      'Rivera, A. (2024). *Accessible design today*. https://example.org/design',
    );
    expect(formatBibliography({ ...website, year: undefined }, 'apa')).toBe(
      'Rivera, A. (n.d.). *Accessible design today*. Retrieved November 1, 2026, from https://example.org/design',
    );
  });

  it('adds a page to APA in-text citations as p. or pp.', () => {
    expect(formatInText(book, 'apa', '42')).toBe('(Rivera, 2024, p. 42)');
    expect(formatInText(book, 'apa', '42-45')).toBe('(Rivera, 2024, pp. 42-45)');
    expect(formatInText(book, 'apa', 'p. 42')).toBe('(Rivera, 2024, p. 42)');
    expect(formatInText(book, 'apa')).toBe('(Rivera, 2024)');
  });

  it('sorts same-author works by year for APA and Chicago, by title for MLA', () => {
    const zebra: BibliographyEntry = { ...book, id: '6', title: 'Zebra patterns', year: '2020' };
    const apple: BibliographyEntry = { ...book, id: '7', title: 'Apple picking', year: '2024' };
    expect(sortBibliography([apple, zebra], 'apa').map((entry) => entry.id)).toEqual(['6', '7']);
    expect(sortBibliography([apple, zebra], 'chicago').map((entry) => entry.id)).toEqual(['6', '7']);
    expect(sortBibliography([apple, zebra], 'mla').map((entry) => entry.id)).toEqual(['7', '6']);
  });

  it('sorts authorless entries by title ignoring a leading The', () => {
    const theApple: BibliographyEntry = {
      id: '8',
      notebookPath: 'Research',
      sourceType: 'book',
      authors: [],
      title: 'The Apple guide',
      year: '2024',
      publisher: 'Open Press',
    };
    const banana: BibliographyEntry = { ...theApple, id: '9', title: 'Banana guide' };
    expect(sortBibliography([banana, theApple]).map((entry) => entry.id)).toEqual(['8', '9']);
  });

  it('strips the URL scheme in MLA but keeps the full DOI link', () => {
    const website: BibliographyEntry = {
      id: '4',
      notebookPath: 'Research',
      sourceType: 'website',
      authors: [{ last: 'Rivera', first: 'Alex' }],
      title: 'Accessible design today',
      year: '2024',
      url: 'https://example.org/design',
      accessed: '2026-11-01',
    };
    expect(formatBibliography(website, 'mla')).toBe(
      'Rivera, Alex. "Accessible design today." 2024, example.org/design. Accessed November 1, 2026.',
    );
    expect(formatBibliography(journal, 'mla')).toContain('https://doi.org/10.1000/xyz123');
  });

  it('includes the conference place in APA and Chicago entries', () => {
    const conference: BibliographyEntry = {
      id: '5',
      notebookPath: 'Research',
      sourceType: 'conference',
      authors: [{ last: 'Rivera', first: 'Alex' }],
      title: 'Testing with screen readers',
      year: '2024',
      conferenceName: 'Access Conference',
      place: 'Portland, OR',
    };
    expect(formatBibliography(conference, 'apa')).toBe(
      'Rivera, A. (2024). *Testing with screen readers*. Access Conference, Portland, OR.',
    );
    expect(formatBibliography(conference, 'chicago')).toBe(
      'Rivera, Alex. 2024. "Testing with screen readers." Access Conference, Portland, OR.',
    );
  });

  it('formats a whole APA bibliography block for an HTML note', () => {
    expect(formatBibliographyBlock([book], 'apa', 'html')).toBe(
      '<p style="text-align: center; font-weight: bold; font-family: \'Times New Roman\', serif; font-size: 12pt;">References</p>\n' +
        '<p style="padding-left: 0.5in; text-indent: -0.5in; line-height: 2; margin: 0; font-family: \'Times New Roman\', serif; font-size: 12pt;">Rivera, A. (2024). <i>Accessible Design</i>. Open Press.</p>',
    );
  });

  it('formats MLA and Chicago blocks with the right heading, spacing, and font', () => {
    expect(formatBibliographyBlock([book], 'mla', 'html')).toBe(
      '<p style="text-align: center; font-family: \'Times New Roman\', serif; font-size: 12pt;">Works Cited</p>\n' +
        '<p style="padding-left: 0.5in; text-indent: -0.5in; line-height: 2; margin: 0; font-family: \'Times New Roman\', serif; font-size: 12pt;">Rivera, Alex. <i>Accessible Design</i>. Open Press, 2024.</p>',
    );
    expect(formatBibliographyBlock([book], 'chicago', 'html')).toBe(
      '<p style="text-align: center; font-family: \'Times New Roman\', serif; font-size: 12pt;">References</p>\n' +
        '<p style="padding-left: 0.5in; text-indent: -0.5in; line-height: 1; margin: 0 0 12pt; font-family: \'Times New Roman\', serif; font-size: 12pt;">Rivera, Alex. 2024. <i>Accessible Design</i>. Open Press.</p>',
    );
  });

  it('formats bibliography blocks for Markdown and plain-text notes without list styling', () => {
    expect(formatBibliographyBlock([book], 'apa', 'markdown')).toBe(
      '## References\n\nRivera, A. (2024). *Accessible Design*. Open Press.',
    );
    expect(formatBibliographyBlock([book], 'mla', 'plain')).toBe(
      'Works Cited\n\nRivera, Alex. Accessible Design. Open Press, 2024.',
    );
  });
});
