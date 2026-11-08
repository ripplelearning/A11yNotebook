import { useState } from 'react';
import type { BookmarkAnchor } from '../../../shared/types';
import Modal from '../../components/Modal';

export interface BookmarkNameRequest {
  path: string;
  anchor: BookmarkAnchor;
  suggestedName: string;
  context?: string;
}

interface Props {
  request: BookmarkNameRequest;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

export default function BookmarkNameDialog({ request, onSubmit, onClose }: Props) {
  const [name, setName] = useState(request.suggestedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileName = request.path.split('/').pop() ?? request.path;
  return (
    <Modal title="Name bookmark" titleId="bookmark-name-dialog-title" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setError('Enter a name for the bookmark.');
            return;
          }
          setBusy(true);
          void onSubmit(name.trim())
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <p>Bookmark in {fileName}</p>
        <label>
          Bookmark name
          <input data-autofocus value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-default disabled={busy}>
          Save bookmark
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
