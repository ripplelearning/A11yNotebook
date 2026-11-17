import { useState } from 'react';
import Modal from '../../components/Modal';
import type { PasteContentFormat } from '../../../shared/paste-content';
import { defaultPasteImageName, firstLinePasteName } from '../../../shared/paste-content';

/** Clipboard content waiting for the guided paste questions. */
export interface PasteContentSource {
  kind: 'text' | 'html' | 'image';
  /** Plain text for text pastes; the plain-text form of an HTML paste. */
  text: string;
  /** Raw HTML for HTML pastes. */
  html?: string;
  imageMimeType?: string;
  /** Clipboard file name for an image, when the clipboard provides one. */
  imageName?: string;
  /** Picture description carried by the source (for example an HTML image's alt text). */
  altText?: string;
}

/** The guided paste answers: note or attachment, format, name, and picture description. */
export interface PasteContentChoice {
  storeAs: 'note' | 'attachment';
  format: PasteContentFormat;
  /** File-name stem without the extension; the format supplies it. */
  name: string;
  /** Picture description, for image pastes. */
  altText?: string;
}

interface Props {
  source: PasteContentSource;
  /** Destination notebook, already picked (the notebook picker runs first when none was selected). */
  notebookName: string;
  onSubmit: (choice: PasteContentChoice) => void;
  onClose: () => void;
}

/**
 * Guided paste flow: (1) new note or file attachment, (2) format, (3)
 * file name. A pasted picture is always a picture attachment, so it
 * skips the first two questions and asks for a name and a description
 * instead. Rich text is an HTML note, edited with the rich text editor.
 */
export default function PasteContentDialog({ source, notebookName, onSubmit, onClose }: Props) {
  const isImage = source.kind === 'image';
  const [storeAs, setStoreAs] = useState<'note' | 'attachment'>(isImage ? 'attachment' : 'note');
  const [format, setFormat] = useState<PasteContentFormat>(source.kind === 'html' ? 'html' : 'markdown');
  const [name, setName] = useState(() =>
    isImage ? defaultPasteImageName(source.imageName) : firstLinePasteName(source.text),
  );
  const [altText, setAltText] = useState(source.altText ?? '');
  const [error, setError] = useState('');
  return (
    <Modal title="Paste into notebook" titleId="paste-content-title" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed || /[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
            setError('Enter a file name without separators or reserved characters.');
            return;
          }
          onSubmit({ storeAs, format, name: trimmed, ...(isImage ? { altText: altText.trim() } : {}) });
        }}
      >
        <p>
          Pasting into notebook “{notebookName}”.
          {isImage ? ' Pictures are stored as picture attachments.' : ''}
        </p>
        {isImage ? null : (
          <fieldset>
            <legend>Store as</legend>
            <label>
              <input
                type="radio"
                name="paste-content-store"
                value="note"
                data-autofocus
                checked={storeAs === 'note'}
                onChange={() => setStoreAs('note')}
              />
              New note
            </label>
            <p>An editable note, opened after pasting.</p>
            <label>
              <input
                type="radio"
                name="paste-content-store"
                value="attachment"
                checked={storeAs === 'attachment'}
                onChange={() => setStoreAs('attachment')}
              />
              File attachment
            </label>
            <p>A file kept in the notebook, not opened for editing.</p>
          </fieldset>
        )}
        {isImage ? null : (
          <label>
            Format
            <select value={format} onChange={(event) => setFormat(event.target.value as PasteContentFormat)}>
              <option value="markdown">Markdown (.md)</option>
              <option value="html">Rich text (.html)</option>
              <option value="txt">Plain text (.txt)</option>
            </select>
          </label>
        )}
        {isImage ? null : (
          <p>Rich text is an HTML note, edited with the rich text editor. Markdown converts headings, lists, and tables, and drops anything with no Markdown equivalent.</p>
        )}
        <label>
          File name
          <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </label>
        {isImage ? (
          <label>
            Alt text (optional)
            <input
              value={altText}
              maxLength={2000}
              onChange={(event) => setAltText(event.target.value)}
              placeholder="Describe the picture for screen reader users"
            />
          </label>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-default>
          Paste
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
