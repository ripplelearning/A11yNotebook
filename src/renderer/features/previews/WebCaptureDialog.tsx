import { useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  notebooks: { path: string; name: string }[];
  onCapture: (url: string, notebookPath: string) => Promise<void>;
  onClose: () => void;
}

export default function WebCaptureDialog({ notebooks, onCapture, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [notebookPath, setNotebookPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Capture web page" titleId="web-capture-heading" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void onCapture(url, notebookPath)
            .then(onClose)
            .catch((failure: unknown) => setError((failure as Error).message || 'Could not capture this page.'))
            .finally(() => setBusy(false));
        }}
      >
        <p>Captures public HTTPS pages and saves supported images in the selected vault notebook.</p>
        <label>
          HTTPS page URL
          <input
            autoFocus
            data-autofocus
            type="url"
            required
            maxLength={2048}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label>
          Save in notebook
          <select value={notebookPath} onChange={(event) => setNotebookPath(event.target.value)}>
            <option value="">Vault root</option>
            {notebooks.map((notebook) => (
              <option key={notebook.path} value={notebook.path}>
                {notebook.name}
              </option>
            ))}
          </select>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || !url.trim()}>
          Capture page
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
