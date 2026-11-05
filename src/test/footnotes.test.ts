import { describe, expect, it } from 'vitest';
import {
  buildFootnote,
  findFootnoteForEntry,
  footnoteEditorHtml,
  insertFootnoteAtCaret,
  isFootnoteClass,
  isFootnoteId,
  listFootnotes,
  nextFootnoteNumber,
  type FootnoteMarkup,
} from '../shared/footnotes';
import type { BibliographyEntry } from '../shared/citations';

const book: BibliographyEntry = {
  id: '1',
  notebookPath: 'Research',
  sourceType: 'book',
  authors: [{ last: 'Rivera', first: 'Alex' }],
  title: 'Accessible Design',
  year: '2024',
  publisher: 'Open Press',
  place: 'Portland',
};

const journal: BibliographyEntry = {
  id: '2',
  notebookPath: 'Research',
  sourceType: 'journal',
  authors: [{ last: 'Doe', first: 'Jane' }],
  title: 'Screen readers and math',
  year: '2023',
  journal: 'Access Quarterly',
  volume: '12',
  issue: '3',
  pages: '45-67',
};

describe('footnotes', () => {
  it('lists Markdown footnote definitions and finds the next number', () => {
    const content = 'Text[^1] and more[^2].\n\n[^1]: First note.\n[^2]: Second note.\n';
    expect(listFootnotes(content, 'markdown')).toEqual([
      { number: 1, text: 'First note.' },
      { number: 2, text: 'Second note.' },
    ]);
    expect(nextFootnoteNumber(content, 'markdown')).toBe(3);
    expect(nextFootnoteNumber('No notes here.', 'markdown')).toBe(1);
  });

  it('lists HTML footnote items and finds the next number', () => {
    const content =
      '<p>Text<sup><a href="#fn-1" id="fnref-1">1</a></sup></p><h2>Notes</h2><ol><li id="fn-1">First note. <a href="#fnref-1">↩</a></li></ol>';
    expect(listFootnotes(content, 'html')).toEqual([{ number: 1, text: 'First note.  ↩ ' }]);
    expect(nextFootnoteNumber(content, 'html')).toBe(2);
  });

  it('builds a full Markdown footnote on first mention and a shortened one after', () => {
    const first = buildFootnote('Intro.', 'markdown', book, '42');
    expect(first).toEqual({
      number: 1,
      shortened: false,
      marker: '[^1]',
      definition: '[^1]: Alex Rivera, *Accessible Design* (Portland: Open Press, 2024), 42.',
    });
    const withFirst = `Intro.[^1]\n\n${first.definition}`;
    expect(findFootnoteForEntry(withFirst, 'markdown', book)).toBe(1);
    expect(findFootnoteForEntry(withFirst, 'markdown', journal)).toBeNull();
    const second = buildFootnote(withFirst, 'markdown', book, '50');
    expect(second).toEqual({
      number: 2,
      shortened: true,
      marker: '[^2]',
      definition: '[^2]: Rivera, *Accessible Design*, 50.',
    });
  });

  it('builds an HTML footnote with anchor links both ways', () => {
    const built = buildFootnote('<p>Intro.</p>', 'html', book, '42');
    expect(built.number).toBe(1);
    expect(built.shortened).toBe(false);
    expect(built.marker).toBe('<sup><a href="#fn-1" id="fnref-1" aria-label="Footnote 1">1</a></sup>');
    expect(built.definition).toBe(
      '<li id="fn-1">Alex Rivera, <i>Accessible Design</i> (Portland: Open Press, 2024), 42. <a href="#fnref-1" aria-label="Back to footnote 1 in the text">↩</a></li>',
    );
  });

  it('inserts a Markdown footnote at the caret and appends the definition', () => {
    const result = insertFootnoteAtCaret('Intro text.', 'markdown', book, '42', 5);
    expect(result).toEqual({
      content: 'Intro[^1] text.\n\n[^1]: Alex Rivera, *Accessible Design* (Portland: Open Press, 2024), 42.',
      caret: 9,
      number: 1,
      shortened: false,
    });
  });

  it('inserts an HTML footnote and appends later ones to the same Notes list', () => {
    const start = '<p>Intro text.</p>';
    const first = insertFootnoteAtCaret(start, 'html', book, '42', start.length);
    expect(first.content).toBe(
      '<p>Intro text.</p><sup><a href="#fn-1" id="fnref-1" aria-label="Footnote 1">1</a></sup>\n<h2>Notes</h2>\n<ol>\n<li id="fn-1">Alex Rivera, <i>Accessible Design</i> (Portland: Open Press, 2024), 42. <a href="#fnref-1" aria-label="Back to footnote 1 in the text">↩</a></li>\n</ol>',
    );
    expect(first.number).toBe(1);
    const second = insertFootnoteAtCaret(first.content, 'html', book, '50', 0);
    expect(second.number).toBe(2);
    expect(second.shortened).toBe(true);
    expect(second.content).toContain(
      '<li id="fn-2">Rivera, <i>Accessible Design</i>, 50. <a href="#fnref-2" aria-label="Back to footnote 2 in the text">↩</a></li>',
    );
    expect(second.content.indexOf('id="fn-1"')).toBeLessThan(second.content.indexOf('id="fn-2"'));
  });

  it('builds editor HTML shaped like the Markdown footnote renderer', () => {
    const html = footnoteEditorHtml('markdown', book, '42', 1, false);
    expect(html.markerHtml).toBe('<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>');
    expect(html.listItemHtml).toBe(
      '<li id="fn1" class="footnote-item"><p>Alex Rivera, <i>Accessible Design</i> (Portland: Open Press, 2024), 42.</p> <a href="#fnref1" class="footnote-backref">↩</a></li>',
    );
    expect(html.sectionHtml).toContain('<section class="footnotes"><ol class="footnotes-list">');
  });

  it('builds editor HTML for HTML notes with a Notes section', () => {
    const html = footnoteEditorHtml('html', book, '42', 1, false);
    expect(html.markerHtml).toBe('<sup><a href="#fn-1" id="fnref-1" aria-label="Footnote 1">1</a></sup>');
    expect(html.sectionHtml).toBe(
      '<h2>Notes</h2>\n<ol>\n<li id="fn-1">Alex Rivera, <i>Accessible Design</i> (Portland: Open Press, 2024), 42. <a href="#fnref-1" aria-label="Back to footnote 1 in the text">↩</a></li>\n</ol>',
    );
  });

  it('treats plain-text notes like Markdown for footnotes', () => {
    const markup: FootnoteMarkup = 'plain';
    const built = buildFootnote('Intro.', markup, book, '42');
    expect(built.marker).toBe('[^1]');
    expect(built.definition).toBe('[^1]: Alex Rivera, Accessible Design (Portland: Open Press, 2024), 42.');
  });

  it('recognizes only footnote ids and classes for the sanitizers', () => {
    expect(isFootnoteId('fn1')).toBe(true);
    expect(isFootnoteId('fnref1')).toBe(true);
    expect(isFootnoteId('fn-1')).toBe(true);
    expect(isFootnoteId('fnref-1')).toBe(true);
    expect(isFootnoteId('fn')).toBe(false);
    expect(isFootnoteId('other')).toBe(false);
    expect(isFootnoteId('fn1x')).toBe(false);
    expect(isFootnoteClass('footnote-ref')).toBe(true);
    expect(isFootnoteClass('footnote-backref')).toBe(true);
    expect(isFootnoteClass('footnotes')).toBe(true);
    expect(isFootnoteClass('footnotes-list')).toBe(true);
    expect(isFootnoteClass('footnotes-sep')).toBe(true);
    expect(isFootnoteClass('footnote-item')).toBe(true);
    expect(isFootnoteClass('custom')).toBe(false);
    expect(isFootnoteClass('footnote-ref custom')).toBe(false);
  });
});
