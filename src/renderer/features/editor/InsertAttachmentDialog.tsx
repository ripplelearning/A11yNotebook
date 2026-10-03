import { useState } from 'react';
import Modal from '../../components/Modal';
import { applyTextEdit, insertionEdit } from './formatting';
import type { RefObject } from 'react';

export function relativeReference(source: string, target: string) {
  const from = source.split('/').slice(0, -1);
  const to = target.split('/');
  while (from.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => '..'), ...to.map(encodeURIComponent)].join('/');
}

export default function InsertAttachmentDialog({
  paths,
  notePath,
  textareaRef,
  onChange,
  onClose,
  announce,
}: {
  paths: string[];
  notePath: string;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onChange: (content: string) => void;
  onClose: () => void;
  announce: (message: string) => void;
}) {
  const [path, setPath] = useState(paths[0] ?? '');
  const [label, setLabel] = useState('');
  const [selection] = useState(() => ({
    content: textareaRef.current?.value,
    start: textareaRef.current?.selectionStart ?? 0,
    end: textareaRef.current?.selectionEnd ?? 0,
  }));
  const [error, setError] = useState('');
  return (
    <Modal title="Insert image or attachment" titleId="insert-attachment-title" onClose={onClose}>
      <p>Import new files into a notebook first, then choose one of the vault attachments here.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const textarea = textareaRef.current;
          if (!textarea || textarea.value !== selection.content) {
            setError('The note changed. Cancel and try again.');
            return;
          }
          if (!path || !label.trim()) {
            setError('Choose a file and enter its description.');
            return;
          }
          const image = /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(path);
          const escaped = label.trim().replace(/[\\[\]]/g, '\\$&');
          const reference = `${image ? '!' : ''}[${escaped}](${relativeReference(notePath, path)})`;
          onClose();
          requestAnimationFrame(() => {
            if (textareaRef.current !== textarea || textarea.value !== selection.content) return;
            applyTextEdit(textarea, insertionEdit(selection.start, selection.end, reference), onChange);
            announce('Attachment reference inserted.');
          });
        }}
      >
        <label>
          Vault attachment
          <select data-autofocus value={path} onChange={(event) => setPath(event.target.value)}>
            {paths.map((relative) => (
              <option key={relative}>{relative}</option>
            ))}
          </select>
        </label>
        <label>
          Link text or image alternative text
          <input required value={label} maxLength={2000} onChange={(event) => setLabel(event.target.value)} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={!paths.length}>
          Insert attachment
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
