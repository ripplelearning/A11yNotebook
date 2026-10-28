import { useState } from 'react';
import Modal from '../../components/Modal';

export type PasteOrphanResult =
  | { mode: 'one'; notebookName: string }
  | { mode: 'per-file' }
  | { mode: 'cancel' };

interface Props {
  files: string[];
  onChoice: (result: PasteOrphanResult) => void;
}

export default function PasteOrphanDialog({ files, onChoice }: Props) {
  const [choice, setChoice] = useState<'one' | 'per-file'>('one');
  const [notebookName, setNotebookName] = useState('Pasted files');
  return (
    <Modal title="Organize pasted files" titleId="paste-orphan-title" onClose={() => onChoice({ mode: 'cancel' })}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onChoice(
            choice === 'one'
              ? { mode: 'one', notebookName: notebookName.trim() || 'Pasted files' }
              : { mode: 'per-file' },
          );
        }}
      >
        <p>
          These files sit directly in the pasted folder, not inside a notebook. Libraries must not contain
          files outside a notebook, so choose how to organize them:
        </p>
        <ul>
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
        <fieldset>
          <legend>Orphan file organization</legend>
          <label>
            <input
              type="radio"
              name="paste-orphan-choice"
              value="one"
              checked={choice === 'one'}
              onChange={() => setChoice('one')}
            />
            Put all of them in one new notebook
          </label>
          <label>
            <input
              type="radio"
              name="paste-orphan-choice"
              value="per-file"
              checked={choice === 'per-file'}
              onChange={() => setChoice('per-file')}
            />
            Give each file its own new notebook
          </label>
        </fieldset>
        {choice === 'one' && (
          <label>
            New notebook name
            <input
              type="text"
              value={notebookName}
              onChange={(event) => setNotebookName(event.target.value)}
              data-autofocus
            />
          </label>
        )}
        <button type="submit">Organize files</button>
        <button type="button" onClick={() => onChoice({ mode: 'cancel' })}>
          Cancel paste
        </button>
      </form>
    </Modal>
  );
}
