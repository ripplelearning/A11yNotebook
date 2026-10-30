import { useState } from 'react';
import Modal from '../../components/Modal';

export interface ItemDialogRequest {
  action: 'new-note' | 'new-notebook' | 'rename' | 'move';
  path?: string;
  name?: string;
}

interface Props {
  request: ItemDialogRequest;
  notebooks: string[];
  onSubmit: (name: string, notebook: string, format?: 'markdown' | 'html' | 'txt') => Promise<void>;
  onClose: () => void;
}

export default function ItemDialog({ request, notebooks, onSubmit, onClose }: Props) {
  const [name, setName] = useState(request.name ?? '');
  const [notebook, setNotebook] = useState('');
  const [format, setFormat] = useState<'markdown' | 'html' | 'txt'>('markdown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = { 'new-note': 'New note', 'new-notebook': 'New notebook', rename: 'Rename item', move: 'Move item' }[
    request.action
  ];
  const nameLabel = { 'new-note': 'New Note Name', 'new-notebook': 'New Notebook Name', rename: 'New Name', move: 'Name' }[
    request.action
  ];
  // The shared Modal names the dialog in the window title, so a screen
  // reader's title-bar shortcut reads it while the dialog is open.
  return (
    <Modal title={title} titleId="item-dialog-title" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (
            request.action !== 'move' &&
            (!name.trim() || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..')
          ) {
            setError('Enter a filename without separators or reserved characters.');
            return;
          }
          setBusy(true);
          void onSubmit(name.trim(), notebook, format)
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        {request.action === 'move' ? (
          <label>
            Destination notebook
            <select data-autofocus value={notebook} onChange={(event) => setNotebook(event.target.value)}>
              <option value="">Library root</option>
              {notebooks
                .filter((item) => item !== request.path && !item.startsWith(`${request.path}/`))
                .map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label>
            {nameLabel}
            <input data-autofocus value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
          </label>
        )}
        {request.action === 'new-note' ? (
          <label>
            Note format
            <select value={format} onChange={(event) => setFormat(event.target.value as 'markdown' | 'html' | 'txt')}>
              <option value="markdown">Markdown (.md)</option>
              <option value="html">HTML (.html)</option>
              <option value="txt">Plain text (.txt)</option>
            </select>
          </label>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-default disabled={busy}>
          {title}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
