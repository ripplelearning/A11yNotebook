import { useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  /** Text selected in the editor when the dialog opened; becomes the link text. */
  initialText: string;
  onSubmit: (url: string, text: string) => void;
  onClose: () => void;
}

/**
 * Validate a link destination the same way the Markdown editor does: an
 * http, https, or mailto URL without spaces. Anything else is refused
 * here instead of reaching the editor, where the note sanitizer would
 * strip the href and leave a link that goes nowhere.
 */
export function validateRichTextLinkUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol === 'mailto:' && !url.pathname) return null;
    return url.href.replace(/[()<>]/g, (character) =>
      encodeURIComponent(character).replace(/\(/g, '%28').replace(/\)/g, '%29'),
    );
  } catch {
    return null;
  }
}

/**
 * Ask for a link in the app's own accessible dialog. The native prompt
 * the toolbar used to ask with does not work in this app (Electron does
 * not implement window.prompt), so the toolbar button silently did
 * nothing. The link text is optional: with nothing typed, the selected
 * text — or the address itself, when nothing is selected — becomes the
 * link text.
 */
export default function InsertLinkDialog({ initialText, onSubmit, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState(initialText);
  const [error, setError] = useState('');
  return (
    <Modal title="Insert link" titleId="insert-link-dialog-title" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const destination = validateRichTextLinkUrl(url);
          if (!destination) {
            setError('Enter an http, https, or mailto URL without spaces.');
            return;
          }
          onSubmit(destination, text.trim());
        }}
      >
        <p>Use an https, http, or mailto URL.</p>
        <label>
          Link address
          <input data-autofocus value={url} maxLength={2000} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label>
          Link text
          <input value={text} maxLength={500} onChange={(event) => setText(event.target.value)} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-default>
          Insert
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
