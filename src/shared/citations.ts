/**
 * Bibliography entries, one list per notebook, with APA (7th), MLA (9th),
 * and Chicago (17th, bibliography style) formatting, plus author-date /
 * author-page in-text citations.
 *
 * Entries are stored in the library's bibliography metadata file, keyed by
 * notebook path. The dialog renders italics as *Title* in Markdown, <i>
 * in HTML, and plain text elsewhere; in-text citations never use italics.
 */

export type CitationSourceType =
  | 'book'
  | 'journal'
  | 'website'
  | 'chapter'
  | 'conference'
  | 'report'
  | 'thesis';

export const CITATION_SOURCE_TYPES: Array<{ id: CitationSourceType; label: string }> = [
  { id: 'book', label: 'Book' },
  { id: 'journal', label: 'Journal article' },
  { id: 'website', label: 'Website' },
  { id: 'chapter', label: 'Book chapter' },
  { id: 'conference', label: 'Conference paper' },
  { id: 'report', label: 'Report' },
  { id: 'thesis', label: 'Thesis or dissertation' },
];

export type CitationStyle = 'apa' | 'mla' | 'chicago';

export const CITATION_STYLES: Array<{ id: CitationStyle; label: string }> = [
  { id: 'apa', label: 'APA' },
  { id: 'mla', label: 'MLA' },
  { id: 'chicago', label: 'Chicago' },
];

export interface CitationAuthor {
  first: string;
  last: string;
}

export interface BibliographyEntry {
  id: string;
  notebookPath: string;
  sourceType: CitationSourceType;
  authors: CitationAuthor[];
  editors?: CitationAuthor[];
  title: string;
  year?: string;
  publisher?: string;
  place?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  containerTitle?: string;
  conferenceName?: string;
  institution?: string;
  edition?: string;
  thesisLevel?: 'doctoral' | 'masters';
  doi?: string;
  url?: string;
  isbn?: string;
  accessed?: string;
}

export type CitationMarkup = 'markdown' | 'html' | 'plain';

function italic(text: string, markup: CitationMarkup): string {
  if (!text) return '';
  if (markup === 'html') return `<i>${text}</i>`;
  if (markup === 'markdown') return `*${text}*`;
  return text;
}

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

function initials(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]}.`)
    .join(' ');
}

/** Parse "Last, First; Last, First" (one per line or semicolon-separated). */
export function parseAuthors(text: string): CitationAuthor[] {
  return text
    .split(/[\n;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const comma = part.indexOf(',');
      if (comma >= 0) {
        return { last: part.slice(0, comma).trim(), first: part.slice(comma + 1).trim() };
      }
      const words = part.split(/\s+/);
      if (words.length === 1) return { last: words[0], first: '' };
      return { last: words[words.length - 1], first: words.slice(0, -1).join(' ') };
    })
    .filter((author) => author.last);
}

export function authorsToText(authors: CitationAuthor[]): string {
  return authors.map((author) => (author.first ? `${author.last}, ${author.first}` : author.last)).join('; ');
}

function apaAuthors(authors: CitationAuthor[]): string {
  const formatted = authors.map((author) =>
    author.first ? `${author.last}, ${initials(author.first)}` : author.last,
  );
  if (formatted.length === 0) return '';
  if (formatted.length === 1) return formatted[0];
  if (formatted.length <= 20) {
    return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
  }
  return `${formatted.slice(0, 19).join(', ')}, … ${formatted[formatted.length - 1]}`;
}

function mlaAuthors(authors: CitationAuthor[]): string {
  if (authors.length === 0) return '';
  const first = authors[0];
  const firstName = first.first ? `${first.last}, ${first.first}` : first.last;
  if (authors.length === 1) return firstName;
  if (authors.length === 2) {
    const second = authors[1];
    return `${firstName}, and ${second.first ? `${second.first} ${second.last}` : second.last}`;
  }
  return `${firstName}, et al.`;
}

function chicagoAuthors(authors: CitationAuthor[]): string {
  if (authors.length === 0) return '';
  const formatted = authors.map((author, index) =>
    index === 0
      ? author.first
        ? `${author.last}, ${author.first}`
        : author.last
      : author.first
        ? `${author.first} ${author.last}`
        : author.last,
  );
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]}, and ${formatted[1]}`;
  if (formatted.length <= 10) return `${formatted.slice(0, -1).join(', ')}, and ${formatted[formatted.length - 1]}`;
  return `${formatted.slice(0, 7).join(', ')}, et al.`;
}

function formatDateLong(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

function doiUrl(entry: BibliographyEntry): string {
  const doi = clean(entry.doi);
  if (doi) return doi.startsWith('http') ? doi : `https://doi.org/${doi}`;
  return clean(entry.url);
}

function joinSentences(parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}

function apaBibliography(entry: BibliographyEntry, markup: CitationMarkup): string {
  const authors = apaAuthors(entry.authors);
  const year = clean(entry.year) || 'n.d.';
  const head = authors ? `${authors} (${year}).` : `${entry.title} (${year}).`;
  const link = doiUrl(entry);
  switch (entry.sourceType) {
    case 'journal': {
      const journal = entry.journal ? italic(entry.journal, markup) : '';
      const volume = entry.volume ? italic(entry.volume, markup) : '';
      const issue = entry.issue ? `(${entry.issue})` : '';
      const pages = entry.pages ? `, ${entry.pages}` : '';
      return joinSentences([
        head,
        `${entry.title}.`,
        journal ? `${journal}, ${volume}${issue}${pages}.` : '',
        link,
      ]);
    }
    case 'website': {
      const retrieved = entry.accessed ? `Retrieved ${formatDateLong(entry.accessed)}, from ` : '';
      return joinSentences([head, `${italic(entry.title, markup)}.`, `${retrieved}${link}`.trim()]);
    }
    case 'chapter': {
      const editors = entry.editors?.length
        ? `In ${entry.editors.map((e) => `${initials(e.first)} ${e.last}`).join(', ')} (Eds.), `
        : '';
      const book = entry.containerTitle ? italic(entry.containerTitle, markup) : '';
      const pages = entry.pages ? ` (pp. ${entry.pages})` : '';
      return joinSentences([
        head,
        `${entry.title}.`,
        `${editors}${book}${pages}.`,
        entry.publisher ? `${entry.publisher}.` : '',
        link,
      ]);
    }
    case 'conference':
      return joinSentences([
        head,
        `${italic(entry.title, markup)}.`,
        entry.conferenceName ? `${entry.conferenceName}.` : '',
        link,
      ]);
    case 'report':
    case 'thesis': {
      const level =
        entry.sourceType === 'thesis'
          ? entry.thesisLevel === 'masters'
            ? "Master's thesis"
            : 'Doctoral dissertation'
          : '';
      const bracket = [level, entry.institution].filter(Boolean).join(', ');
      return joinSentences([
        head,
        `${italic(entry.title, markup)}${bracket ? ` [${bracket}]` : ''}.`,
        entry.institution && entry.sourceType === 'report' ? `${entry.institution}.` : '',
        link,
      ]);
    }
    default: {
      const edition = entry.edition ? ` (${entry.edition} ed.)` : '';
      return joinSentences([
        head,
        `${italic(entry.title, markup)}${edition}.`,
        entry.publisher ? `${entry.publisher}.` : '',
        link,
      ]);
    }
  }
}

function mlaBibliography(entry: BibliographyEntry, markup: CitationMarkup): string {
  const authors = mlaAuthors(entry.authors);
  const year = clean(entry.year);
  const link = doiUrl(entry);
  const head = authors ? `${authors}.` : '';
  switch (entry.sourceType) {
    case 'journal': {
      const volume = entry.volume ? `vol. ${entry.volume}, ` : '';
      const issue = entry.issue ? `no. ${entry.issue}, ` : '';
      const pages = entry.pages ? `pp. ${entry.pages}.` : '';
      return joinSentences([
        head,
        `"${entry.title}."`,
        entry.journal ? `${italic(entry.journal, markup)}, ${volume}${issue}${year ? `${year}, ` : ''}${pages}` : '',
        link,
      ]);
    }
    case 'website': {
      const accessed = entry.accessed ? `Accessed ${formatDateLong(entry.accessed)}.` : '';
      return joinSentences([
        head,
        `"${entry.title}."`,
        entry.publisher ? `${italic(entry.publisher, markup)}, ` : '',
        year ? `${year}, ` : '',
        link ? `${link}.` : '',
        accessed,
      ]);
    }
    case 'chapter': {
      const editors = entry.editors?.length
        ? `edited by ${entry.editors.map((e) => (e.first ? `${e.first} ${e.last}` : e.last)).join(', ')}, `
        : '';
      const pages = entry.pages ? `pp. ${entry.pages}.` : '';
      return joinSentences([
        head,
        `"${entry.title}."`,
        entry.containerTitle ? `${italic(entry.containerTitle, markup)}, ${editors}` : '',
        entry.publisher ? `${entry.publisher}, ` : '',
        year ? `${year}, ` : '',
        pages,
        link,
      ]);
    }
    case 'conference':
      return joinSentences([
        head,
        `"${entry.title}."`,
        entry.conferenceName ? `${italic(entry.conferenceName, markup)}, ` : '',
        year ? `${year}.` : '',
        link,
      ]);
    case 'report':
    case 'thesis':
      return joinSentences([
        head,
        `${italic(entry.title, markup)}.`,
        entry.institution ? `${entry.institution}, ` : '',
        year ? `${year}.` : '',
        link,
      ]);
    default:
      return joinSentences([
        head,
        `${italic(entry.title, markup)}.`,
        entry.publisher ? `${entry.publisher}, ` : '',
        year ? `${year}.` : '',
        link,
      ]);
  }
}

function chicagoBibliography(entry: BibliographyEntry, markup: CitationMarkup): string {
  const authors = chicagoAuthors(entry.authors);
  const year = clean(entry.year);
  const link = doiUrl(entry);
  const head = authors ? `${authors}.` : '';
  const yearPart = year ? `${year}.` : '';
  switch (entry.sourceType) {
    case 'journal': {
      const volume = entry.volume ? `${entry.volume}` : '';
      const issue = entry.issue ? `, no. ${entry.issue}` : '';
      const pages = entry.pages ? `: ${entry.pages}` : '';
      return joinSentences([
        head,
        yearPart,
        `"${entry.title}."`,
        entry.journal ? `${italic(entry.journal, markup)} ${volume}${issue} (${year})${pages}.` : '',
        link,
      ]);
    }
    case 'website': {
      const accessed = entry.accessed ? `Accessed ${formatDateLong(entry.accessed)}. ` : '';
      return joinSentences([
        head,
        yearPart,
        `"${entry.title}."`,
        entry.publisher ? `${entry.publisher}. ` : '',
        `${accessed}${link}`,
      ]);
    }
    case 'chapter': {
      const editors = entry.editors?.length
        ? `edited by ${entry.editors.map((e) => (e.first ? `${e.first} ${e.last}` : e.last)).join(', ')}`
        : '';
      const pages = entry.pages ? `, ${entry.pages}` : '';
      return joinSentences([
        head,
        yearPart,
        `"${entry.title}."`,
        entry.containerTitle ? `In ${italic(entry.containerTitle, markup)}${editors ? `, ${editors}` : ''}${pages}.` : '',
        entry.place || entry.publisher
          ? `${[entry.place, entry.publisher].filter(Boolean).join(': ')}.`
          : '',
        link,
      ]);
    }
    case 'conference':
      return joinSentences([
        head,
        yearPart,
        `"${entry.title}."`,
        entry.conferenceName ? `${entry.conferenceName}.` : '',
        link,
      ]);
    case 'report':
    case 'thesis':
      return joinSentences([
        head,
        yearPart,
        `${italic(entry.title, markup)}.`,
        entry.institution ? `${entry.institution}.` : '',
        link,
      ]);
    default:
      return joinSentences([
        head,
        yearPart,
        `${italic(entry.title, markup)}.`,
        entry.place || entry.publisher
          ? `${[entry.place, entry.publisher].filter(Boolean).join(': ')}.`
          : '',
        link,
      ]);
  }
}

/** Format one bibliography entry in the chosen style. */
export function formatBibliography(
  entry: BibliographyEntry,
  style: CitationStyle,
  markup: CitationMarkup = 'markdown',
): string {
  const formatted =
    style === 'apa'
      ? apaBibliography(entry, markup)
      : style === 'mla'
        ? mlaBibliography(entry, markup)
        : chicagoBibliography(entry, markup);
  return formatted.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

/** Format an in-text citation; `page` is the specific cited page, when given. */
export function formatInText(entry: BibliographyEntry, style: CitationStyle, page?: string): string {
  const year = clean(entry.year) || 'n.d.';
  const first = entry.authors[0];
  const last = first?.last ?? entry.title;
  const pagePart = clean(page);
  if (style === 'mla') return pagePart ? `(${last} ${pagePart})` : `(${last})`;
  if (style === 'chicago') return pagePart ? `(${last} ${year}, ${pagePart})` : `(${last} ${year})`;
  if (entry.authors.length >= 3) return `(${last} et al., ${year})`;
  if (entry.authors.length === 2) return `(${entry.authors[0].last} & ${entry.authors[1].last}, ${year})`;
  return `(${last}, ${year})`;
}

/** Sort bibliography entries by first author's last name, then title. */
export function sortBibliography(entries: BibliographyEntry[]): BibliographyEntry[] {
  return [...entries].sort((a, b) => {
    const aKey = (a.authors[0]?.last ?? a.title).toLowerCase();
    const bKey = (b.authors[0]?.last ?? b.title).toLowerCase();
    return aKey.localeCompare(bKey) || a.title.localeCompare(b.title);
  });
}
