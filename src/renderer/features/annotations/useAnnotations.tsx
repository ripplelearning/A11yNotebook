import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ANNOTATION_COLORS,
  ANNOTATION_LIMITS,
  type AnnotationAnchor,
  type AnnotationColor,
  type AnnotationUpdate,
  type NewAnnotation,
  type NoteAnnotation,
} from '../../../shared/annotations';
import Modal from '../../components/Modal';
import { captureAnnotationAnchor, clearAnnotationMarks, jumpToAnnotation, renderAnnotationMarks } from './anchors';

export interface UseAnnotationsOptions {
  path: string | null;
  /** Markdown source; changing it reapplies anchors after the document renders. */
  content: string;
  enabled: boolean;
  /** Disable the local shortcut when the application command registry owns it. */
  bindShortcut?: boolean;
  announce?: (message: string) => void;
  annotations: NoteAnnotation[];
  onAdd: (annotation: NewAnnotation) => Promise<unknown>;
  onUpdate: (id: string, patch: AnnotationUpdate) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

type Draft = { path: string; anchor: AnnotationAnchor; annotation?: NoteAnnotation };

function AnnotationEditor({
  draft,
  onSave,
  onClose,
}: {
  draft: Draft;
  onSave: (values: { color: AnnotationColor; label: string; comment: string }) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [color, setColor] = useState<AnnotationColor>(draft.annotation?.color ?? 'yellow');
  const [label, setLabel] = useState(draft.annotation?.label ?? 'Highlight');
  const [comment, setComment] = useState(draft.annotation?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      titleId={`${id}-title`}
      title={draft.annotation ? 'Edit annotation' : 'Add annotation'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onSave({ color, label: label.trim(), comment });
          } catch {
            setError('Could not save annotation. Please try again.');
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <blockquote>{draft.anchor.quote}</blockquote>
          <label htmlFor={`${id}-color`}>Highlight color</label>
          <select
            id={`${id}-color`}
            value={color}
            disabled={busy}
            onChange={(event) => setColor(event.target.value as AnnotationColor)}
          >
            {ANNOTATION_COLORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-label`}>Highlight label</label>
          <input
            id={`${id}-label`}
            data-autofocus
            value={label}
            required
            maxLength={ANNOTATION_LIMITS.label}
            disabled={busy}
            onChange={(event) => setLabel(event.target.value)}
          />
          <label htmlFor={`${id}-comment`}>Comment</label>
          <textarea
            id={`${id}-comment`}
            value={comment}
            maxLength={ANNOTATION_LIMITS.comment}
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
          />
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
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

export function AnnotationPane({
  annotations,
  renderedIds,
  enabled,
  busy,
  onEdit,
  onDelete,
  onJump,
}: {
  annotations: NoteAnnotation[];
  renderedIds: ReadonlySet<string>;
  enabled: boolean;
  busy: boolean;
  onEdit: (annotation: NoteAnnotation) => void;
  onDelete: (annotation: NoteAnnotation) => void;
  onJump: (annotation: NoteAnnotation) => void;
}) {
  return (
    <section aria-label="Annotations">
      <h3>Annotations</h3>
      {!annotations.length && <p>No annotations for this note.</p>}
      <ul>
        {annotations.map((annotation) => (
          <li
            key={annotation.id}
            data-context="annotation"
            data-path={annotation.path}
            data-annotation-id={annotation.id}
            tabIndex={-1}
          >
            <strong>{annotation.label}</strong> <span>({annotation.color} highlight)</span>
            <blockquote>{annotation.anchor.quote}</blockquote>
            {annotation.comment && <p>{annotation.comment}</p>}
            {enabled && !renderedIds.has(annotation.id) && (
              <p>Highlight unavailable: text changed, is ambiguous, or overlaps another annotation.</p>
            )}
            <button
              type="button"
              disabled={!enabled || !renderedIds.has(annotation.id)}
              aria-label={`Jump to annotation: ${annotation.label}`}
              onClick={() => onJump(annotation)}
            >
              Jump to text
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={`Edit annotation: ${annotation.label}`}
              onClick={() => onEdit(annotation)}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={`Delete annotation: ${annotation.label}`}
              onClick={() => onDelete(annotation)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Attach documentRef around MarkdownDocument only; put toolbar above it and pane in the right-hand pane. */
export function useAnnotations({
  path,
  content,
  enabled,
  annotations,
  onAdd,
  onUpdate,
  onDelete,
  bindShortcut = true,
  announce,
}: UseAnnotationsOptions) {
  const documentRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [renderedIds, setRenderedIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const current = annotations.filter((annotation) => annotation.path === path);
  const currentPath = useRef(path);
  currentPath.current = path;
  useEffect(() => {
    setDraft(null);
    setStatus('');
  }, [path]);
  useLayoutEffect(() => {
    const root = documentRef.current;
    if (!root) return;
    const next = enabled
      ? renderAnnotationMarks(
          root,
          annotations.filter((item) => item.path === path),
        )
      : new Set<string>();
    setRenderedIds((previous) =>
      previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next,
    );
    return () => clearAnnotationMarks(root);
  }, [annotations, content, enabled, path]);

  const report = (message: string) => {
    setStatus(message);
    announce?.(message);
  };
  const begin = () => {
    if (!enabled || !path || draft || busy) return;
    const root = documentRef.current;
    const anchor = root ? captureAnnotationAnchor(root, root.ownerDocument.getSelection()) : null;
    if (!anchor) {
      report('Select text in the Markdown reading view before adding an annotation.');
      return;
    }
    setStatus('');
    setDraft({ path, anchor });
  };
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    if (!bindShortcut) return;
    const handleKey = (event: KeyboardEvent) => {
      if (
        enabled &&
        !document.querySelector('[role="dialog"]') &&
        !event.defaultPrevented &&
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === 'a'
      ) {
        event.preventDefault();
        beginRef.current();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [bindShortcut, enabled]);

  const activeDraft = draft?.path === path ? draft : null;
  const toolbar = (
    <>
      <button
        type="button"
        disabled={!enabled || !path || busy}
        aria-keyshortcuts={bindShortcut ? 'Control+Shift+A' : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={begin}
      >
        Annotate selection
      </button>
      {!announce && <p role="status">{status}</p>}
      {activeDraft && (
        <AnnotationEditor
          key={activeDraft.annotation?.id ?? 'new'}
          draft={activeDraft}
          onClose={() => setDraft(null)}
          onSave={async (values) => {
            if (currentPath.current !== activeDraft.path) throw new Error('The selected note changed.');
            if (activeDraft.annotation) await onUpdate(activeDraft.annotation.id, values);
            else await onAdd({ path: activeDraft.path, anchor: activeDraft.anchor, ...values });
            setDraft(null);
            report('Annotation saved.');
          }}
        />
      )}
    </>
  );
  const pane = (
    <AnnotationPane
      annotations={current}
      renderedIds={renderedIds}
      enabled={enabled}
      busy={busy}
      onEdit={(annotation) => setDraft({ path: annotation.path, anchor: annotation.anchor, annotation })}
      onJump={(annotation) => {
        if (documentRef.current && !jumpToAnnotation(documentRef.current, annotation.id))
          report('Annotation text could not be located.');
      }}
      onDelete={async (annotation) => {
        setBusy(true);
        try {
          await onDelete(annotation.id);
          report('Annotation deleted.');
        } catch {
          report('Could not delete annotation. Please try again.');
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { documentRef, toolbar, pane, begin };
}

export function AnnotationDocument({
  documentRef,
  children,
}: {
  documentRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  return <div ref={documentRef}>{children}</div>;
}
