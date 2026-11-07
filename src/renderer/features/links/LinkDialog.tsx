import { useState } from 'react';
import Modal from '../../components/Modal';
import { isAllowedLinkUrl } from '../../../shared/links';

interface LinkDialogProps {
  /** Dialog title: 'Add link' or 'Edit link'. */
  title: string;
  initialTitle: string;
  initialUrl: string;
  /** Shown above the form when the link comes from an import choice: the download-and-import guidance. */
  guidance?: string;
  submitLabel: string;
  onSubmit: (title: string, url: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Add or edit a standalone link (a grid item, never note content). The
 * title is typed by the user; nothing is fetched from the page. Submit is
 * first and default, so Enter while focused in a field activates it
 * through native form submission.
 */
export function LinkDialog({ title, initialTitle, initialUrl, guidance, submitLabel, onSubmit, onClose }: LinkDialogProps) {
  const [linkTitle, setLinkTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal title={title} titleId="link-dialog-title" onClose={close}>
      {guidance ? <p>{guidance}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (!linkTitle.trim()) {
            setError('Enter a link title.');
            return;
          }
          if (!isAllowedLinkUrl(url)) {
            setError('Enter a web address starting with http://, https://, or mailto:.');
            return;
          }
          setBusy(true);
          setError('');
          void onSubmit(linkTitle.trim(), url.trim())
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Title
          <input data-autofocus value={linkTitle} disabled={busy} onChange={(event) => setLinkTitle(event.target.value)} />
        </label>
        <label>
          Web address
          <input
            value={url}
            disabled={busy}
            inputMode="url"
            autoComplete="off"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-default disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
