/**
 * Bibliography entries, one list per notebook, with APA (7th), MLA (9th),
 * and Chicago (17th) formatting in two systems — author-date and
 * notes-bibliography — plus author-date / author-page in-text citations
 * and Chicago footnote citations (full on first mention, shortened after).
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

export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'chicago-notes';

export const CITATION_STYLES: Array<{ id: CitationStyle; label: string }> = [
  { id: 'apa', label: 'APA' },
  { id: 'mla', label: 'MLA' },
  { id: 'chicago', label: 'Chicago (Author-Date)' },
  { id: 'chicago-notes', label: 'Chicago (Notes-Bibliography)' },
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
      // APA 7th gives a retrieval date only for content designed to change.
      // A web page with a publication date is treated as fixed, so the date
      // is shown only when the page has no year.
      const retrieved =
        entry.accessed && !clean(entry.year) ? `Retrieved ${formatDateLong(entry.accessed)}, from ` : '';
      return joinSentences([head, `${italic(entry.title, markup)}.`, `${retrieved}${link}`.trim()]);
    }
    case 'chapter': {
      const editors = entry.editors?.length
        ? `In ${entry.editors.map((e) => `${initials(e.first)} ${e.last}`).join(', ')} (${
            entry.editors.length === 1 ? 'Ed.' : 'Eds.'
          }), `
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
        entry.conferenceName
          ? `${entry.conferenceName}${entry.place ? `, ${entry.place}` : ''}.`
          : '',
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
  // MLA 9th strips the http:// or https:// prefix from URLs. DOIs keep
  // their full https://doi.org/ form.
  const link = clean(entry.doi) ? doiUrl(entry) : clean(entry.url).replace(/^https?:\/\//, '');
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
        entry.conferenceName
          ? `${entry.conferenceName}${entry.place ? `, ${entry.place}` : ''}.`
          : '',
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

/**
 * Chicago notes-bibliography entries: the year goes at the END of the
 * entry, not after the author. `repeatAuthor` renders the 3-em dash
 * Chicago requires for successive entries by the same author.
 */
function chicagoNotesBibliography(
  entry: BibliographyEntry,
  markup: CitationMarkup,
  repeatAuthor = false,
): string {
  const authors = chicagoAuthors(entry.authors);
  const year = clean(entry.year);
  const link = doiUrl(entry);
  const head = repeatAuthor ? '———.' : authors ? `${authors}.` : '';
  const placePublisher = [entry.place, entry.publisher].filter(Boolean).join(': ');
  const published = [placePublisher, year].filter(Boolean).join(', ');
  const publishedPart = published ? `${published}.` : '';
  switch (entry.sourceType) {
    case 'journal': {
      const volume = entry.volume ? `${entry.volume}` : '';
      const issue = entry.issue ? `, no. ${entry.issue}` : '';
      const yearPart = year ? ` (${year})` : '';
      const pages = entry.pages ? `: ${entry.pages}` : '';
      return joinSentences([
        head,
        `"${entry.title}."`,
        entry.journal ? `${italic(entry.journal, markup)} ${volume}${issue}${yearPart}${pages}.` : '',
        link,
      ]);
    }
    case 'website': {
      const accessed = entry.accessed ? `Accessed ${formatDateLong(entry.accessed)}. ` : '';
      return joinSentences([
        head,
        `"${entry.title}."`,
        entry.publisher ? `${entry.publisher}. ` : '',
        year ? `${year}. ` : '',
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
        `"${entry.title}."`,
        entry.containerTitle
          ? `In ${italic(entry.containerTitle, markup)}${editors ? `, ${editors}` : ''}${pages}.`
          : '',
        publishedPart,
        link,
      ]);
    }
    case 'conference':
      return joinSentences([
        head,
        `"${entry.title}."`,
        entry.conferenceName
          ? `Paper presented at ${entry.conferenceName}${entry.place ? `, ${entry.place}` : ''}${
              year ? `, ${year}` : ''
            }.`
          : '',
        link,
      ]);
    case 'report':
      return joinSentences([
        head,
        `${italic(entry.title, markup)}.`,
        entry.institution ? `${entry.institution}${year ? `, ${year}` : ''}.` : year ? `${year}.` : '',
        link,
      ]);
    case 'thesis': {
      const level =
        entry.thesisLevel === 'masters' ? "Master's thesis" : entry.thesisLevel === 'doctoral' ? 'PhD diss.' : '';
      const details = [level, entry.institution, year].filter(Boolean).join(', ');
      return joinSentences([head, `"${entry.title}."`, details ? `${details}.` : '', link]);
    }
    default: {
      const edition = entry.edition ? `${entry.edition} ed.` : '';
      return joinSentences([
        head,
        `${italic(entry.title, markup)}.`,
        edition,
        publishedPart,
        link,
      ]);
    }
  }
}

/** Authors as a Chicago note lists them: all three at most, "et al." beyond. */
function noteAuthors(authors: CitationAuthor[]): string {
  const names = authors.map((author) => (author.first ? `${author.first} ${author.last}` : author.last));
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names[0]} et al.`;
}

/** Tidy a note citation: collapse spaces, fix spacing before punctuation, turn a trailing comma into a period. */
function finishNote(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim()
    .replace(/,\s*$/, '.');
}

/**
 * Shortened title for Chicago note citations: the subtitle is dropped and
 * a long title is cut to its first four words.
 */
export function shortTitle(entry: BibliographyEntry): string {
  const main = entry.title.split(':')[0].trim();
  const words = main.split(/\s+/).filter(Boolean);
  return words.length > 4 ? words.slice(0, 4).join(' ') : main;
}

/**
 * Full Chicago note citation (first mention of a source): the author
 * first-name first, publication details in parentheses, cited page last.
 * When no page is cited, the entry's page range is used instead.
 */
export function formatNoteCitation(entry: BibliographyEntry, markup: CitationMarkup, page?: string): string {
  const author = noteAuthors(entry.authors);
  const year = clean(entry.year);
  const link = doiUrl(entry);
  const authorPart = author ? `${author},` : '';
  const pagePart = clean(page);
  const placePublisher = [entry.place, entry.publisher].filter(Boolean).join(': ');
  switch (entry.sourceType) {
    case 'journal': {
      const journalPart = entry.journal
        ? `${italic(entry.journal, markup)}${entry.volume ? ` ${entry.volume}` : ''}${
            entry.issue ? `, no. ${entry.issue}` : ''
          }${year ? ` (${year})` : ''}`
        : '';
      const pages = pagePart || entry.pages;
      return finishNote(
        joinSentences([
          authorPart,
          journalPart ? `"${entry.title},"` : `"${entry.title}."`,
          journalPart ? `${journalPart}${pages ? `: ${pages}` : ''}.` : pages ? `${pages}.` : '',
        ]),
      );
    }
    case 'website': {
      const body = [
        `"${entry.title},"`,
        entry.publisher ? `${entry.publisher},` : '',
        year ? `${year},` : '',
        entry.accessed ? `accessed ${formatDateLong(entry.accessed)},` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return finishNote(`${authorPart ? `${authorPart} ` : ''}${body}${link ? ` ${link}` : ''}`);
    }
    case 'chapter': {
      const editors = entry.editors?.length
        ? `${entry.editors.length === 1 ? 'ed.' : 'eds.'} ${entry.editors
            .map((e) => (e.first ? `${e.first} ${e.last}` : e.last))
            .join(', ')}`
        : '';
      const published = [placePublisher, year].filter(Boolean).join(', ');
      const pages = pagePart || entry.pages;
      return finishNote(
        joinSentences([
          authorPart,
          `"${entry.title},"`,
          entry.containerTitle
            ? `in ${italic(entry.containerTitle, markup)}${editors ? `, ${editors}` : ''}${
                published ? ` (${published})` : ''
              }${pages ? `, ${pages}` : ''}.`
            : '',
        ]),
      );
    }
    case 'conference': {
      const event = [entry.conferenceName, entry.place, year].filter(Boolean).join(', ');
      return finishNote(
        joinSentences([
          authorPart,
          `"${entry.title}"`,
          event ? `(paper presented at ${event}).` : '',
          link,
        ]),
      );
    }
    case 'report': {
      const published = [entry.institution, year].filter(Boolean).join(', ');
      return finishNote(
        joinSentences([
          authorPart,
          `${italic(entry.title, markup)}`,
          published ? `(${published})` : '',
          pagePart ? `, ${pagePart}.` : '.',
        ]),
      );
    }
    case 'thesis': {
      const level =
        entry.thesisLevel === 'masters' ? "Master's thesis" : entry.thesisLevel === 'doctoral' ? 'PhD diss.' : '';
      const published = [level, entry.institution, year].filter(Boolean).join(', ');
      return finishNote(
        joinSentences([
          authorPart,
          `"${entry.title}"`,
          published ? `(${published})` : '',
          pagePart ? `, ${pagePart}.` : '.',
        ]),
      );
    }
    default: {
      const published = [placePublisher, year].filter(Boolean).join(', ');
      const edition = entry.edition ? `${entry.edition} ed.` : '';
      return finishNote(
        joinSentences([
          authorPart,
          `${italic(entry.title, markup)}`,
          edition,
          published ? `(${published})` : '',
          pagePart ? `, ${pagePart}.` : '.',
        ]),
      );
    }
  }
}

/**
 * Shortened Chicago note citation (later mentions of a source): author
 * last name, shortened title, cited page.
 */
export function formatShortNoteCitation(entry: BibliographyEntry, markup: CitationMarkup, page?: string): string {
  const last = entry.authors[0]?.last;
  const short = shortTitle(entry);
  const pagePart = clean(page);
  if (entry.sourceType === 'book' || entry.sourceType === 'report') {
    const head = last ? `${last}, ${italic(short, markup)}` : italic(short, markup);
    return finishNote(`${head}${pagePart ? `, ${pagePart}` : ''}.`);
  }
  const head = last ? `${last}, ` : '';
  if (pagePart) return finishNote(`${head}"${short}," ${pagePart}.`);
  return finishNote(`${head}"${short}."`);
}

/** Format one bibliography entry in the chosen style. */
export function formatBibliography(
  entry: BibliographyEntry,
  style: CitationStyle,
  markup: CitationMarkup = 'markdown',
  options?: { repeatAuthor?: boolean },
): string {
  const formatted =
    style === 'apa'
      ? apaBibliography(entry, markup)
      : style === 'mla'
        ? mlaBibliography(entry, markup)
        : style === 'chicago-notes'
          ? chicagoNotesBibliography(entry, markup, options?.repeatAuthor)
          : chicagoBibliography(entry, markup);
  return formatted.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

/** "p. 23" for one page, "pp. 23-25" for a range; a label the user already typed is kept as-is. */
function apaPageLabel(page: string): string {
  if (/^pp?\.\s/i.test(page)) return page;
  return /[-–]/.test(page) ? `pp. ${page}` : `p. ${page}`;
}

/** Format an in-text citation; `page` is the specific cited page, when given. */
export function formatInText(entry: BibliographyEntry, style: CitationStyle, page?: string): string {
  const year = clean(entry.year) || 'n.d.';
  const first = entry.authors[0];
  const last = first?.last ?? entry.title;
  const pagePart = clean(page);
  if (style === 'mla') return pagePart ? `(${last} ${pagePart})` : `(${last})`;
  if (style === 'chicago') return pagePart ? `(${last} ${year}, ${pagePart})` : `(${last} ${year})`;
  if (style === 'chicago-notes') return formatNoteCitation(entry, 'plain', page);
  const pageSuffix = pagePart ? `, ${apaPageLabel(pagePart)}` : '';
  if (entry.authors.length >= 3) return `(${last} et al., ${year}${pageSuffix})`;
  if (entry.authors.length === 2) return `(${entry.authors[0].last} & ${entry.authors[1].last}, ${year}${pageSuffix})`;
  return `(${last}, ${year}${pageSuffix})`;
}

/** The sort key ignores a leading A, An, or The, as the style guides require for titles. */
function stripLeadingArticle(title: string): string {
  return title.replace(/^(a|an|the)\s+/i, '');
}

/**
 * Sort bibliography entries by first author's last name (or by title when
 * there is no author). Works by the same author are ordered by year,
 * earliest first, for APA and Chicago author-date; MLA and Chicago
 * notes-bibliography order them by title. An entry with no year sorts
 * before dated works by the same author.
 */
export function sortBibliography(entries: BibliographyEntry[], style: CitationStyle = 'apa'): BibliographyEntry[] {
  const sortKey = (entry: BibliographyEntry) =>
    (entry.authors[0]?.last ?? stripLeadingArticle(entry.title)).toLowerCase();
  return [...entries].sort((a, b) => {
    const keyOrder = sortKey(a).localeCompare(sortKey(b));
    if (keyOrder !== 0) return keyOrder;
    if (a.authors.length > 0 && b.authors.length > 0 && (style === 'apa' || style === 'chicago')) {
      const yearOrder = (a.year ?? '').localeCompare(b.year ?? '');
      if (yearOrder !== 0) return yearOrder;
    }
    return stripLeadingArticle(a.title)
      .toLowerCase()
      .localeCompare(stripLeadingArticle(b.title).toLowerCase());
  });
}

/** The one hanging-indent declaration an HTML-note bibliography carries. */
export const BIBLIOGRAPHY_HANGING_INDENT = 'padding-left: 0.5in; text-indent: -0.5in;';

/**
 * Every inline-style declaration a bibliography block may carry in an HTML
 * note. The note sanitizers (renderer and main process) keep a style
 * attribute only when every declaration is in this set, so a pasted style
 * still cannot hide content or restyle a note.
 */
const BIBLIOGRAPHY_ALLOWED_STYLES = new Set([
  'padding-left: 0.5in',
  'text-indent: -0.5in',
  'text-align: center',
  'font-weight: bold',
  "font-family: 'Times New Roman', serif",
  'font-size: 12pt',
  'line-height: 2',
  'line-height: 1',
  'margin: 0',
  'margin: 0 0 12pt',
]);

/** True when a style attribute holds only bibliography declarations. */
export function isBibliographyStyle(value: string): boolean {
  const declarations = value
    .split(';')
    .map((part) => part.replace(/\s+/g, ' ').replace(/\s*:\s*/g, ': ').trim())
    .filter(Boolean);
  return declarations.length > 0 && declarations.every((declaration) => BIBLIOGRAPHY_ALLOWED_STYLES.has(declaration));
}

/** Times New Roman 12pt is the standard list font for APA, MLA, and Chicago. */
const BIBLIOGRAPHY_FONT_STYLE = `font-family: 'Times New Roman', serif; font-size: 12pt;`;

function bibliographyHeadingStyle(style: CitationStyle): string {
  return style === 'apa'
    ? `text-align: center; font-weight: bold; ${BIBLIOGRAPHY_FONT_STYLE}`
    : `text-align: center; ${BIBLIOGRAPHY_FONT_STYLE}`;
}

function bibliographyEntryStyle(style: CitationStyle): string {
  // APA and MLA are double-spaced with no blank line between entries;
  // Chicago is single-spaced within entries with a blank line between them.
  const spacing =
    style === 'chicago' || style === 'chicago-notes'
      ? 'line-height: 1; margin: 0 0 12pt;'
      : 'line-height: 2; margin: 0;';
  return `${BIBLIOGRAPHY_HANGING_INDENT} ${spacing} ${BIBLIOGRAPHY_FONT_STYLE}`;
}

/** The list heading each style requires. */
export function bibliographyHeading(style: CitationStyle): string {
  if (style === 'mla') return 'Works Cited';
  if (style === 'chicago-notes') return 'Bibliography';
  return 'References';
}

/**
 * Format a whole bibliography list — heading plus entries — for insertion
 * into a note. HTML notes get the full list formatting (centered heading,
 * hanging indent, per-style line spacing, Times New Roman 12pt). Markdown
 * and plain-text notes get the heading and the entries only: neither format
 * can express an indent, line spacing, or a font, so the text is the same
 * and the layout follows the note.
 */
export function formatBibliographyBlock(
  entries: BibliographyEntry[],
  style: CitationStyle,
  markup: CitationMarkup,
): string {
  const sorted = sortBibliography(entries, style);
  const heading = bibliographyHeading(style);
  const repeatAuthor = (index: number) =>
    style === 'chicago-notes' &&
    index > 0 &&
    sorted[index - 1].authors.length > 0 &&
    JSON.stringify(sorted[index - 1].authors) === JSON.stringify(sorted[index].authors);
  const formatted = sorted.map((entry, index) =>
    formatBibliography(entry, style, markup, { repeatAuthor: repeatAuthor(index) }),
  );
  if (markup === 'html') {
    return [
      `<p style="${bibliographyHeadingStyle(style)}">${heading}</p>`,
      ...formatted.map((entry) => `<p style="${bibliographyEntryStyle(style)}">${entry}</p>`),
    ].join('\n');
  }
  if (markup === 'markdown') {
    return [`## ${heading}`, ...formatted].join('\n\n');
  }
  return [heading, ...formatted].join('\n\n');
}
