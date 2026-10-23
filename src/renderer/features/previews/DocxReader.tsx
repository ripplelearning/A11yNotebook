import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DocxParagraph, DocxRun, DocxStructure, DocxTable } from '../../../shared/docx';
import Modal from '../../components/Modal';
import {
  captureAnnotationAnchor,
  clearAnnotationMarks,
  jumpToAnnotation,
  renderAnnotationMarks,
} from '../annotations/anchors';
import { ANNOTATION_COLORS, type NoteAnnotation } from '../../../shared/annotations';
import {
  docxAnchorText,
  formatDocxAnnotationsExport,
  resolveDocxAnchor,
  type DocxAnnotation,
  type DocxAnnotationAnchor,
  type DocxAnchorStatus,
} from '../../../shared/docx-annotations';

interface Props {
  path: string;
}

interface ListItem {
  index: number;
  paragraph: DocxParagraph;
  children: ListBlock[];
}

interface ListBlock {
  ordered: boolean;
  level: number;
  items: ListItem[];
}

type ReaderBlock = { index: number; block: DocxParagraph | DocxTable } | { list: ListBlock };

function blockText(block: DocxParagraph | DocxTable): string {
  if (block.kind === 'paragraph') return block.text;
  return block.rows
    .flatMap((row) => row.cells.flatMap((cell) => cell.paragraphs.map((paragraph) => paragraph.text)))
    .join(' ');
}

function readerBlocks(blocks: DocxStructure['blocks']): ReaderBlock[] {
  const result: ReaderBlock[] = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    if (block.kind !== 'paragraph' || !block.list) {
      result.push({ index, block });
      index += 1;
      continue;
    }
    const root: ListBlock = { ordered: block.list.ordered, level: block.list.level, items: [] };
    const stack = [root];
    while (index < blocks.length) {
      const item = blocks[index];
      if (item.kind !== 'paragraph' || !item.list) break;
      let current = stack.at(-1)!;
      if (item.list.level < current.level) {
        while (stack.length > 1 && item.list.level < stack.at(-1)!.level) stack.pop();
        current = stack.at(-1)!;
      }
      if (item.list.level > current.level) {
        const parent = current.items.at(-1);
        const nested: ListBlock = { ordered: item.list.ordered, level: item.list.level, items: [] };
        if (parent) parent.children.push(nested);
        else root.items.push({ index, paragraph: item, children: [nested] });
        stack.push(nested);
        current = nested;
      } else if (item.list.ordered !== current.ordered) {
        break;
      }
      current.items.push({ index, paragraph: item, children: [] });
      index += 1;
    }
    result.push({ list: root });
  }
  return result;
}

function InlineRun({ run, onOpenLink }: { run: DocxRun; onOpenLink: (url: string) => void }) {
  if (run.image) {
    return (
      <span role="img" aria-label={run.image.altText || 'Image; no alternative text supplied'}>
        {run.image.altText || 'Image; no alternative text supplied'}
      </span>
    );
  }
  let content: React.ReactNode = run.text;
  if (run.bold) content = <strong>{content}</strong>;
  if (run.italic) content = <em>{content}</em>;
  if (run.underline) content = <u>{content}</u>;
  if (run.strike) content = <s>{content}</s>;
  return run.link ? (
    <button className="docx-link" type="button" onClick={() => onOpenLink(run.link!)}>
      {content}
    </button>
  ) : (
    content
  );
}

function ParagraphContent({ paragraph, onOpenLink }: { paragraph: DocxParagraph; onOpenLink: (url: string) => void }) {
  const content = paragraph.runs.map((run, index) => <InlineRun key={index} run={run} onOpenLink={onOpenLink} />);
  const body = paragraph.headingLevel ? (
    (() => {
      const Heading = `h${Math.min(6, paragraph.headingLevel!)}` as keyof JSX.IntrinsicElements;
      return <Heading>{content}</Heading>;
    })()
  ) : (
    <p>{content}</p>
  );
  return (
    <>
      {body}
      {paragraph.breaks?.map((kind, index) => (
        <span className="docx-break" key={`${kind}-${index}`}>
          {kind === 'page' ? 'Page break' : 'Column break'}
        </span>
      ))}
    </>
  );
}

function DocxAnnotationDialog({
  quote,
  initial,
  busy,
  onClose,
  onSave,
}: {
  quote: string;
  initial?: DocxAnnotation;
  busy: boolean;
  onClose: () => void;
  onSave: (values: { color: DocxAnnotation['color']; label: string; comment: string }) => void;
}) {
  const id = useId();
  const [color, setColor] = useState<DocxAnnotation['color']>(initial?.color ?? 'yellow');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  return (
    <Modal titleId={`${id}-title`} title={initial ? 'Edit DOCX annotation' : 'Add DOCX annotation'} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ color, label: label.trim(), comment });
        }}
      >
        <blockquote>{quote}</blockquote>
        <div>
          <label htmlFor={`${id}-color`}>Highlight color</label>
          <select
            id={`${id}-color`}
            value={color}
            onChange={(event) => setColor(event.target.value as DocxAnnotation['color'])}
          >
            {ANNOTATION_COLORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-label`}>Highlight label</label>
          <input id={`${id}-label`} value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-comment`}>Comment</label>
          <textarea
            id={`${id}-comment`}
            value={comment}
            maxLength={10_000}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        <div>
          <button type="submit" disabled={busy || !label.trim()}>
            {busy ? 'Saving…' : 'Save annotation'}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function DocxReader({ path }: Props) {
  const [structure, setStructure] = useState<DocxStructure | null>(null);
  const [search, setSearch] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [error, setError] = useState('');
  const [annotations, setAnnotations] = useState<DocxAnnotation[]>([]);
  const [draft, setDraft] = useState<{ anchor: DocxAnnotationAnchor; editing?: DocxAnnotation } | null>(null);
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [annotationStatus, setAnnotationStatus] = useState('');
  const [renderedMarks, setRenderedMarks] = useState<ReadonlySet<string>>(new Set());
  const blockRefs = useRef<Array<HTMLElement | null>>([]);
  const cellRefs = useRef<Array<HTMLElement | null>>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle && structure
      ? structure.blocks.flatMap((block, index) =>
          blockText(block).toLocaleLowerCase().includes(needle) ? [index] : [],
        )
      : [];
  }, [search, structure]);
  const views = useMemo(() => (structure ? readerBlocks(structure.blocks) : []), [structure]);
  const annotationStatuses = useMemo(() => {
    const statuses = new Map<string, DocxAnchorStatus>();
    if (structure) {
      for (const annotation of annotations) {
        const text = docxAnchorText(structure.blocks, annotation.anchor);
        statuses.set(annotation.id, text === null ? 'orphan' : resolveDocxAnchor(text, annotation.anchor).status);
      }
    }
    return statuses;
  }, [annotations, structure]);

  /** The element whose text is the annotation unit: a table cell, or a paragraph block's own text element. */
  const unitRoot = useCallback((anchor: DocxAnnotationAnchor): HTMLElement | null => {
    const content = contentRef.current;
    if (!content) return null;
    const wrapper = content.querySelector<HTMLElement>(`[data-docx-block="${anchor.blockIndex}"]`);
    if (!wrapper) return null;
    if (anchor.cellIndex !== undefined) {
      return wrapper.querySelector<HTMLElement>(`td[data-docx-cell="${anchor.cellIndex}"]`);
    }
    return (
      wrapper.querySelector<HTMLElement>(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6') ??
      wrapper
    );
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !structure) return;
    clearAnnotationMarks(content);
    const rendered = new Set<string>();
    for (const annotation of annotations) {
      if (annotationStatuses.get(annotation.id) !== 'anchored') continue;
      const root = unitRoot(annotation.anchor);
      if (!root) continue;
      const text = docxAnchorText(structure.blocks, annotation.anchor);
      if (text === null) continue;
      const resolved = resolveDocxAnchor(text, annotation.anchor);
      const transient: NoteAnnotation = {
        id: annotation.id,
        path,
        anchor: {
          quote: annotation.anchor.quote,
          prefix: annotation.anchor.prefix,
          suffix: annotation.anchor.suffix,
          start: resolved.start,
          end: resolved.end,
        },
        color: annotation.color,
        label: annotation.label,
        comment: annotation.comment,
        createdAt: annotation.createdAt,
        updatedAt: annotation.updatedAt,
      };
      renderAnnotationMarks(root, [transient]).forEach((id) => rendered.add(id));
    }
    setRenderedMarks((previous) =>
      previous.size === rendered.size && [...rendered].every((id) => previous.has(id)) ? previous : rendered,
    );
  }, [annotations, annotationStatuses, path, structure, unitRoot]);

  useEffect(() => {
    let cancelled = false;
    setStructure(null);
    setAnnotations([]);
    setDraft(null);
    setAnnotationStatus('');
    setError('');
    setSearch('');
    setCurrentIndex(0);
    const vault = window.a11yNotebook?.vault;
    if (!vault) {
      setError('The local DOCX reader is unavailable.');
      return;
    }
    void Promise.all([
      vault.readDocxStructure(path),
      vault.getBookmarks(),
      vault.listDocxAnnotations?.(path) ?? Promise.resolve([] as DocxAnnotation[]),
    ])
      .then(([loaded, bookmarks, loadedAnnotations]) => {
        if (cancelled) return;
        setStructure(loaded);
        setBookmarked(bookmarks.some((bookmark) => bookmark.path === path));
        setAnnotations(loadedAnnotations);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'This DOCX could not be read.');
      });
    const unsubscribeLock = vault.onSecurityLocked?.(() => {
      cancelled = true;
      setStructure(null);
      setBookmarked(false);
      setAnnotations([]);
      setCurrentIndex(0);
      setError('The library was locked. Unlock it to continue reading this DOCX.');
    });
    const unsubscribeChanged = vault.onChanged((event) => {
      if (!event.paths.length || event.paths.includes(path)) {
        cancelled = true;
        setStructure(null);
        setBookmarked(false);
        setAnnotations([]);
        setCurrentIndex(0);
        setError('The document changed. Reopen it to continue reading.');
      }
    });
    return () => {
      cancelled = true;
      unsubscribeLock?.();
      unsubscribeChanged();
    };
  }, [path]);

  const navigate = useCallback((index: number, focus = true) => {
    setCurrentIndex(index);
    if (focus) blockRefs.current[index]?.focus();
  }, []);

  const openLink = useCallback((url: string) => {
    void window.a11yNotebook?.vault.openUrl(url).catch(() => {
      setError('This link could not be opened.');
    });
  }, []);

  const toggleBookmark = useCallback(() => {
    void window.a11yNotebook?.vault
      .toggleBookmark(path)
      .then((bookmarks) => setBookmarked(bookmarks.some((bookmark) => bookmark.path === path)))
      .catch(() => setError('This DOCX could not be bookmarked.'));
  }, [path]);

  const beginAnnotation = useCallback(() => {
    const content = contentRef.current;
    const selection = content?.ownerDocument.getSelection();
    if (!content || !selection || selection.isCollapsed || !selection.rangeCount) {
      setAnnotationStatus('Select text in the document before adding an annotation.');
      return;
    }
    const node = selection.getRangeAt(0).startContainer;
    const element = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest(
      '[data-docx-block]',
    ) as HTMLElement | null;
    if (!element || !content.contains(element)) {
      setAnnotationStatus('Select text in the document before adding an annotation.');
      return;
    }
    const blockIndex = Number(element.dataset.docxBlock);
    const cell = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest(
      'td[data-docx-cell]',
    ) as HTMLElement | null;
    const cellIndex = cell && element.contains(cell) ? Number(cell.dataset.docxCell) : undefined;
    const root = unitRoot({ blockIndex, cellIndex, quote: '', prefix: '', suffix: '', start: 0, end: 0 });
    const captured = root ? captureAnnotationAnchor(root, selection) : null;
    if (!captured) {
      setAnnotationStatus('That selection cannot be annotated. Select text within a single paragraph or table cell.');
      return;
    }
    setAnnotationStatus('');
    setDraft({ anchor: { blockIndex, cellIndex, ...captured } });
  }, [unitRoot]);

  const saveAnnotation = useCallback(
    async (values: { color: DocxAnnotation['color']; label: string; comment: string }) => {
      const vault = window.a11yNotebook?.vault;
      if (!vault || !draft) return;
      setAnnotationBusy(true);
      try {
        if (draft.editing) {
          const saved = await vault.updateDocxAnnotation(path, draft.editing.id, values);
          setAnnotations((items) => items.map((item) => (item.id === saved.id ? saved : item)));
        } else {
          const saved = await vault.addDocxAnnotation({ path, anchor: draft.anchor, ...values });
          setAnnotations((items) => [...items, saved]);
        }
        setDraft(null);
        setAnnotationStatus('Annotation saved.');
      } catch {
        setAnnotationStatus('The annotation could not be saved.');
      } finally {
        setAnnotationBusy(false);
      }
    },
    [draft, path],
  );

  const deleteAnnotation = useCallback(
    async (annotation: DocxAnnotation) => {
      const vault = window.a11yNotebook?.vault;
      if (!vault) return;
      setAnnotationBusy(true);
      try {
        await vault.deleteDocxAnnotation(path, annotation.id);
        setAnnotations((items) => items.filter((item) => item.id !== annotation.id));
        setAnnotationStatus('Annotation deleted.');
      } catch {
        setAnnotationStatus('The annotation could not be deleted.');
      } finally {
        setAnnotationBusy(false);
      }
    },
    [path],
  );

  const jumpToDocxAnnotation = useCallback(
    (annotation: DocxAnnotation) => {
      const root = unitRoot(annotation.anchor);
      if (!root) return;
      if (!jumpToAnnotation(root, annotation.id)) {
        const focusable = root.closest<HTMLElement>('[data-docx-block]') ?? root;
        focusable.focus();
      }
    },
    [unitRoot],
  );

  const moveTableCell = (offset: number, table?: HTMLTableElement | null) => {
    const cells = table
      ? Array.from(table.querySelectorAll<HTMLElement>('td'))
      : cellRefs.current.filter((cell): cell is HTMLElement => cell !== null);
    const current = cells.indexOf(document.activeElement as HTMLElement);
    const next = Math.max(0, Math.min(cells.length - 1, current < 0 ? 0 : current + offset));
    cells[next]?.focus();
  };

  const renderParagraph = (paragraph: DocxParagraph, index: number) => (
    <div
      key={`paragraph-${index}`}
      ref={(element) => {
        blockRefs.current[index] = element;
      }}
      tabIndex={-1}
      aria-current={currentIndex === index ? 'location' : undefined}
      data-docx-block={index}
      onFocus={() => setCurrentIndex(index)}
    >
      <ParagraphContent paragraph={paragraph} onOpenLink={openLink} />
    </div>
  );

  const renderList = (list: ListBlock): React.ReactNode => {
    const List = list.ordered ? 'ol' : 'ul';
    return (
      <List>
        {list.items.map(({ index, paragraph, children }) => (
          <li
            key={`list-item-${index}`}
            ref={(element) => {
              blockRefs.current[index] = element;
            }}
            tabIndex={-1}
            aria-current={currentIndex === index ? 'location' : undefined}
            data-docx-block={index}
            onFocus={() => setCurrentIndex(index)}
          >
            <ParagraphContent paragraph={paragraph} onOpenLink={openLink} />
            {children.map((child) => renderList(child))}
          </li>
        ))}
      </List>
    );
  };

  const renderTable = (table: DocxTable, blockIndex: number) => {
    return (
      <div
        ref={(element) => {
          blockRefs.current[blockIndex] = element;
        }}
        tabIndex={-1}
        aria-current={currentIndex === blockIndex ? 'location' : undefined}
        data-docx-block={blockIndex}
        onFocus={() => setCurrentIndex(blockIndex)}
      >
        <table>
          <caption>Table {blockIndex + 1}</caption>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.cells.map((cell, columnIndex) => {
                  const absoluteIndex =
                    table.rows.slice(0, rowIndex).reduce((count, previous) => count + previous.cells.length, 0) +
                    columnIndex;
                  return (
                    <td
                      key={columnIndex}
                      ref={(element) => {
                        cellRefs.current[absoluteIndex] = element;
                      }}
                      tabIndex={0}
                      data-docx-cell={absoluteIndex}
                      onFocus={() => setCurrentIndex(blockIndex)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft') {
                          event.preventDefault();
                          moveTableCell(-1, event.currentTarget.closest('table'));
                        } else if (event.key === 'ArrowRight') {
                          event.preventDefault();
                          moveTableCell(1, event.currentTarget.closest('table'));
                        }
                      }}
                    >
                      {cell.paragraphs.map((paragraph, index) => (
                        <ParagraphContent key={index} paragraph={paragraph} onOpenLink={openLink} />
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  if (error && !structure) return <p role="alert">{error}</p>;
  if (!structure) return <p role="status">Reading DOCX structure locally…</p>;
  const title = structure.title || path.split('/').at(-1) || 'DOCX document';
  const count = structure.blocks.length;
  const safeIndex = Math.min(currentIndex, Math.max(0, count - 1));
  const hasTableCells = structure.blocks.some(
    (block) => block.kind === 'table' && block.rows.some((row) => row.cells.length > 0),
  );

  return (
    <section aria-label="DOCX document reader" data-docx-path={path}>
      <h3>{title}</h3>
      {structure.author || structure.created ? (
        <p>
          {structure.author ? `Author: ${structure.author}` : ''}
          {structure.author && structure.created ? ' · ' : ''}
          {structure.created ? `Created: ${structure.created}` : ''}
        </p>
      ) : null}
      <div role="group" aria-label="DOCX reading controls">
        <button type="button" onClick={() => navigate(Math.max(0, safeIndex - 1))} disabled={safeIndex <= 0}>
          Previous section
        </button>
        <button
          type="button"
          onClick={() => navigate(Math.min(count - 1, safeIndex + 1))}
          disabled={safeIndex >= count - 1}
        >
          Next section
        </button>
        <button type="button" onClick={toggleBookmark}>
          {bookmarked ? 'Remove DOCX bookmark' : 'Bookmark DOCX'}
        </button>
        <button type="button" onClick={beginAnnotation}>
          Annotate selection
        </button>
        <output aria-label="DOCX reading position">{count ? `${safeIndex + 1} of ${count}` : 'Empty document'}</output>
      </div>
      {hasTableCells ? (
        <div role="group" aria-label="Table cell navigation">
          <button type="button" onClick={() => moveTableCell(-1)}>
            Previous table cell
          </button>
          <button type="button" onClick={() => moveTableCell(1)}>
            Next table cell
          </button>
        </div>
      ) : null}
      {structure.headings.length ? (
        <nav aria-label="DOCX outline">
          <h4>Headings</h4>
          <ol>
            {structure.headings.map((heading, index) => (
              <li key={`${heading.blockIndex}-${index}`}>
                <button type="button" onClick={() => navigate(heading.blockIndex)}>
                  {heading.text || `Heading level ${heading.level}`}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {structure.links.length ? (
        <nav aria-label="DOCX links">
          <h4>Links</h4>
          <ul>
            {structure.links.map((link, index) => (
              <li key={`${link.target}-${index}`}>
                <button type="button" onClick={() => openLink(link.target)}>
                  {link.text || link.target}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <label>
        Find in DOCX
        <input value={search} maxLength={1000} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <p role="status">{search ? `${matches.length} matching sections.` : ''}</p>
      {matches.map((index) => (
        <button key={index} type="button" onClick={() => navigate(index)}>
          Go to match in section {index + 1}
        </button>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      {structure.truncationReason ? <p role="status">{structure.truncationReason}</p> : null}
      {structure.unsupportedFeatures.length ? (
        <p role="note">Not included: {structure.unsupportedFeatures.join(', ')}.</p>
      ) : null}
      {structure.sectionCount > 1 ? <p>{structure.sectionCount} document sections.</p> : null}
      <div aria-label="DOCX semantic content" ref={contentRef}>
        {views.map((view) =>
          'list' in view
            ? renderList(view.list)
            : view.block.kind === 'paragraph'
              ? renderParagraph(view.block, view.index)
              : renderTable(view.block, view.index),
        )}
      </div>
      <section aria-label="DOCX annotations">
        <h4>Annotations</h4>
        {annotationStatus ? <p role="status">{annotationStatus}</p> : null}
        {!annotations.length ? <p>No annotations for this document.</p> : null}
        <ul>
          {annotations.map((annotation) => {
            const status = annotationStatuses.get(annotation.id) ?? 'orphan';
            return (
              <li key={annotation.id} data-annotation-id={annotation.id}>
                <strong>{annotation.label}</strong> <span>({annotation.color} highlight)</span>
                <blockquote>{annotation.anchor.quote}</blockquote>
                {annotation.comment ? <p>{annotation.comment}</p> : null}
                {status !== 'anchored' ? (
                  <p>
                    {status === 'ambiguous'
                      ? 'Highlight unavailable: this text occurs more than once in its block.'
                      : 'Highlight unavailable: the text changed or no longer appears in its block.'}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={status !== 'anchored' || !renderedMarks.has(annotation.id)}
                  aria-label={`Jump to annotation: ${annotation.label}`}
                  onClick={() => jumpToDocxAnnotation(annotation)}
                >
                  Jump to text
                </button>{' '}
                <button
                  type="button"
                  disabled={annotationBusy}
                  aria-label={`Edit annotation: ${annotation.label}`}
                  onClick={() => setDraft({ anchor: annotation.anchor, editing: annotation })}
                >
                  Edit
                </button>{' '}
                <button
                  type="button"
                  disabled={annotationBusy}
                  aria-label={`Delete annotation: ${annotation.label}`}
                  onClick={() => void deleteAnnotation(annotation)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
        {annotations.length ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  formatDocxAnnotationsExport(
                    path,
                    annotations.map((annotation) => ({
                      annotation,
                      status: annotationStatuses.get(annotation.id) ?? 'orphan',
                    })),
                  ),
                );
                setAnnotationStatus(
                  `Copied ${annotations.length} annotation${annotations.length === 1 ? '' : 's'} to the clipboard.`,
                );
              } catch {
                setAnnotationStatus('Could not copy annotations to the clipboard.');
              }
            }}
          >
            Copy annotations to clipboard
          </button>
        ) : null}
      </section>
      {draft ? (
        <DocxAnnotationDialog
          quote={draft.editing?.anchor.quote ?? draft.anchor.quote}
          initial={draft.editing}
          busy={annotationBusy}
          onClose={() => setDraft(null)}
          onSave={(values) => void saveAnnotation(values)}
        />
      ) : null}
    </section>
  );
}
