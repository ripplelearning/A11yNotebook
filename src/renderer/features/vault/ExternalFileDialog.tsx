import { useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  name: string;
  canImport: boolean;
  onOpenWith: () => Promise<void>;
  onImport: () => Promise<void>;
  onClose: () => void;
}

export default function ExternalFileDialog({ name, canImport, onOpenWith, onImport, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not open this file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Open external file"
      titleId="external-file-heading"
      describedBy="external-file-description"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p id="external-file-description">
        {name} has not been created or imported by A11y Notebook. Choose an application to open it. On Windows, the
        system chooser controls whether to use that application by default. Cancelling the chooser leaves your file and
        associations unchanged.
      </p>
      <button type="button" data-autofocus disabled={busy} onClick={() => void run(onOpenWith)}>
        Open with…
      </button>
      <button type="button" disabled={busy || !canImport} onClick={() => void run(onImport)}>
        Import into A11y Notebook
      </button>
      <p>
        {canImport
          ? 'Import creates a separate compatible copy in this library and leaves the original unchanged.'
          : 'This file type cannot be imported for internal reading or editing.'}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" disabled={busy} onClick={onClose}>
        Cancel
      </button>
    </Modal>
  );
}
