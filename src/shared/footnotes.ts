import {
  formatNoteCitation,
  formatShortNoteCitation,
  shortTitle,
  type BibliographyEntry,
  type CitationMarkup,
} from './citations';

export type FootnoteMarkup = CitationMarkup;

export interface FootnoteDefinition {
  number: number;
  text: string;
}

const MARKDOWN_FOOTNOTE = /^\[\^(\d+)\]:\s*(.*)$/;
const HTML_FOOTNOTE_ITEM = /<li\b[^>]*\bid="fn-(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;

/** Existing footnote definitions in note content, in order. */
export function listFootnotes(content: string, markup: FootnoteMarkup): FootnoteDefinition[] {
  if (markup === 'html') {
    return Array.from(content.matchAll(HTML_FOOTNOTE_ITEM), (match) => ({
      number: Number(match[1]),
      text: match[2].replace(/<[^>]*>/g, ' '),
    }));
  }
  return content
    .split('\n')
    .map((line) => MARKDOWN_FOOTNOTE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ number: Number(match[1]), text: match[2] }));
}

/** The next unused footnote number. */
export function nextFootnoteNumber(content: string, markup: FootnoteMarkup): number {
  return listFootnotes(content, markup).reduce((max, footnote) => Math.max(max, footnote.number), 0) + 1;
}

function mentionsEntry(text: string, entry: BibliographyEntry): boolean {
  const plain = text.replace(/<[^>]*>/g, ' ').toLowerCase();
  const title = shortTitle(entry).toLowerCase();
  if (!plain.includes(title)) return false;
  const last = entry.authors[0]?.last.toLowerCase();
  return !last || plain.includes(last);
}

/** The number of the footnote already citing this entry, if any. */
export function findFootnoteForEntry(
  content: string,
  markup: FootnoteMarkup,
  entry: BibliographyEntry,
): number | null {
  const found = listFootnotes(content, markup).find((footnote) => mentionsEntry(footnote.text, entry));
  return found?.number ?? null;
}

export interface BuiltFootnote {
  number: number;
  shortened: boolean;
  marker: string;
  definition: string;
}

/**
 * Build a new footnote for an entry: a fresh number, the full citation on
 * first mention of the source and the shortened form after that.
 */
export function buildFootnote(
  content: string,
  markup: FootnoteMarkup,
  entry: BibliographyEntry,
  page?: string,
): BuiltFootnote {
  const number = nextFootnoteNumber(content, markup);
  const shortened = findFootnoteForEntry(content, markup, entry) !== null;
  const citation = shortened
    ? formatShortNoteCitation(entry, markup, page)
    : formatNoteCitation(entry, markup, page);
  if (markup === 'html') {
    return {
      number,
      shortened,
      marker: `<sup><a href="#fn-${number}" id="fnref-${number}" aria-label="Footnote ${number}">${number}</a></sup>`,
      definition: `<li id="fn-${number}">${citation} <a href="#fnref-${number}" aria-label="Back to footnote ${number} in the text">↩</a></li>`,
    };
  }
  return { number, shortened, marker: `[^${number}]`, definition: `[^${number}]: ${citation}` };
}

export interface FootnoteEditorHtml {
  markerHtml: string;
  listItemHtml: string;
  sectionHtml: string;
}

/**
 * The same footnote as rendered HTML for the rich text editor: the marker
 * and the notes-section entry. Markdown notes use the shape the Markdown
 * footnote renderer produces, so the editor round-trips back to [^n]
 * syntax; HTML notes use superscript anchor links and a Notes section.
 * The citation itself is HTML in both cases because the editor holds HTML.
 */
export function footnoteEditorHtml(
  markup: FootnoteMarkup,
  entry: BibliographyEntry,
  page: string | undefined,
  number: number,
  shortened: boolean,
): FootnoteEditorHtml {
  const citation = shortened
    ? formatShortNoteCitation(entry, 'html', page)
    : formatNoteCitation(entry, 'html', page);
  if (markup === 'html') {
    const listItemHtml = `<li id="fn-${number}">${citation} <a href="#fnref-${number}" aria-label="Back to footnote ${number} in the text">↩</a></li>`;
    return {
      markerHtml: `<sup><a href="#fn-${number}" id="fnref-${number}" aria-label="Footnote ${number}">${number}</a></sup>`,
      listItemHtml,
      sectionHtml: `<h2>Notes</h2>\n<ol>\n${listItemHtml}\n</ol>`,
    };
  }
  const listItemHtml = `<li id="fn${number}" class="footnote-item"><p>${citation}</p> <a href="#fnref${number}" class="footnote-backref">↩</a></li>`;
  return {
    markerHtml: `<sup class="footnote-ref"><a href="#fn${number}" id="fnref${number}">[${number}]</a></sup>`,
    listItemHtml,
    sectionHtml: `<section class="footnotes"><ol class="footnotes-list">${listItemHtml}</ol></section>`,
  };
}

export interface InsertedFootnote {
  content: string;
  caret: number;
  number: number;
  shortened: boolean;
}

/**
 * Insert a footnote into note source: the marker at the caret, the
 * definition at the end (appended to the existing Notes list for HTML
 * notes, or as a new Notes section when there is none).
 */
export function insertFootnoteAtCaret(
  content: string,
  markup: FootnoteMarkup,
  entry: BibliographyEntry,
  page: string | undefined,
  caret: number,
): InsertedFootnote {
  const built = buildFootnote(content, markup, entry, page);
  const at = Math.max(0, Math.min(caret, content.length));
  const withMarker = `${content.slice(0, at)}${built.marker}${content.slice(at)}`;
  let next: string;
  if (markup === 'html') {
    const items = Array.from(withMarker.matchAll(HTML_FOOTNOTE_ITEM));
    if (items.length) {
      const last = items[items.length - 1];
      const end = (last.index ?? 0) + last[0].length;
      next = `${withMarker.slice(0, end)}\n${built.definition}${withMarker.slice(end)}`;
    } else {
      const trimmed = withMarker.replace(/\s*$/, '');
      next = `${trimmed}\n<h2>Notes</h2>\n<ol>\n${built.definition}\n</ol>`;
    }
  } else {
    const trimmed = withMarker.replace(/\s*$/, '');
    next = `${trimmed}\n\n${built.definition}`;
  }
  return { content: next, caret: at + built.marker.length, number: built.number, shortened: built.shortened };
}
