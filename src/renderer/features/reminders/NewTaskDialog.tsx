import { useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  onCreate: (text: string) => Promise<void>;
  onClose: () => void;
}

export default function NewTaskDialog({ onCreate, onClose }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal title="New task" titleId="new-task-title" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (!text.trim()) {
            setError('Enter task text.');
            return;
          }
          setBusy(true);
          setError('');
          void onCreate(text.trim())
            .then(onClose)
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Task text
          <input data-autofocus value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          Create task
        </button>
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
