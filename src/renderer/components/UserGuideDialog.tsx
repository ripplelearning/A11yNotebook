import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { useMemo, useRef, useState } from 'react';
import guideSource from '../../../docs/user-guide.md?raw';
import { getKeyboardShortcuts } from '../../shared/command-registry';
import type { NotebookSettings } from '../../shared/settings';
import {
  buildGuideMarkdown,
  extractGuideSections,
  filterGuideSections,
  type GuideSection,
} from '../../shared/user-guide';
import { NAVIGATION_SHORTCUTS } from './HelpDialogs';
import Modal from './Modal';

const markdown = new MarkdownIt();

/**
 * Render one guide section to sanitized HTML. The section heading gets
 * its fragment id and tabindex -1 so a Table of Contents activation can
 * move programmatic keyboard focus to it. Links to other documentation
 * files cannot resolve inside the app, so they become plain text; web
 * and mail links stay links and open outside the guide.
 *
 * The heading id and tabindex are set on the parsed DOM after
 * sanitizing: this DOMPurify version strips id attributes outright, so
 * they cannot survive the sanitize step. The values are the section's
 * own generated slug, never guide text.
 */
export function renderGuideSectionHtml(section: GuideSection): string {
  const clean = DOMPurify.sanitize(markdown.render(section.markdown));
  const template = document.createElement('template');
  template.innerHTML = clean;
  const heading = template.content.querySelector(`h${section.level}`);
  if (heading) {
    heading.id = section.id;
    heading.tabIndex = -1;
  }
  // Guide tables are lookups keyed by their first column (an action, a
  // view, a style), so the first cell of each body row is a row header,
  // matching the shortcuts dialog's table. A screen reader then announces
  // the key with each value instead of a bare cell.
  template.content.querySelectorAll('table tbody tr').forEach((row) => {
    const firstCell = row.querySelector('td');
    if (!firstCell) return;
    const header = document.createElement('th');
    header.setAttribute('scope', 'row');
    header.replaceChildren(...Array.from(firstCell.childNodes));
    row.replaceChild(header, firstCell);
  });
  template.content.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noreferrer');
      return;
    }
    anchor.replaceWith(document.createTextNode(anchor.textContent ?? ''));
  });
  return template.innerHTML;
}

type UserGuideDialogProps = {
  onClose: () => void;
  shortcuts?: NotebookSettings['shortcuts'];
  aliasShortcuts?: NotebookSettings['shortcutAliases'];
  isMac?: boolean;
};

/**
 * The full User Guide (F1): the bundled docs/user-guide.md with its
 * shortcuts section generated from the command registry at render time,
 * a search box that filters by section, and an interactive Table of
 * Contents whose entries move focus to the section heading.
 */
export default function UserGuideDialog({
  onClose,
  shortcuts = {},
  aliasShortcuts = {},
  isMac = false,
}: UserGuideDialogProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    const rows = [...NAVIGATION_SHORTCUTS, ...getKeyboardShortcuts(shortcuts, aliasShortcuts, isMac)];
    return extractGuideSections(buildGuideMarkdown(guideSource, rows));
  }, [shortcuts, aliasShortcuts, isMac]);
  const visibleSections = useMemo(() => filterGuideSections(sections, query), [sections, query]);
  const searching = query.trim() !== '';

  const renderedSections = useMemo(
    () => new Map(visibleSections.map((section) => [section.id, renderGuideSectionHtml(section)])),
    [visibleSections],
  );

  const jumpToSection = (id: string) => {
    const heading = contentRef.current?.querySelector<HTMLElement>(`#${id}`);
    if (!heading) return;
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  };

  const matchCount = visibleSections.length;
  const statusText = searching
    ? matchCount === 0
      ? `No sections match “${query.trim()}”.`
      : `${matchCount} ${matchCount === 1 ? 'section matches' : 'sections match'} “${query.trim()}”.`
    : '';

  return (
    <Modal titleId="user-guide-dialog-title" title="User Guide" onClose={onClose} className="guide-modal">
      <div className="guide-search">
        <label htmlFor="user-guide-search">Search the User Guide</label>
        <input
          id="user-guide-search"
          ref={searchRef}
          type="search"
          data-autofocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type to filter sections"
        />
        {searching ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              searchRef.current?.focus();
            }}
          >
            Clear search
          </button>
        ) : null}
      </div>
      <p role="status">{statusText}</p>
      <div className="guide-layout">
        <nav aria-label="Table of contents" className="guide-toc">
          <ul>
            {visibleSections.map((section) => (
              <li key={section.id} className={section.level === 3 ? 'guide-toc-sub' : undefined}>
                <button type="button" onClick={() => jumpToSection(section.id)}>
                  {section.title}
                </button>
              </li>
            ))}
          </ul>
          {visibleSections.length === 0 ? <p>No sections match this search.</p> : null}
        </nav>
        <div ref={contentRef} className="guide-content">
          {visibleSections.length === 0 ? (
            <p>No sections match “{query.trim()}”. Try different words, or clear the search.</p>
          ) : (
            visibleSections.map((section) => (
              <section key={section.id} aria-labelledby={section.id}>
                <div
                  // Sanitized in renderGuideSectionHtml before it reaches here.
                  dangerouslySetInnerHTML={{ __html: renderedSections.get(section.id) ?? '' }}
                />
              </section>
            ))
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
