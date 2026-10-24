import { useState } from 'react';
import Modal from '../../components/Modal';

export type PasteOrphanChoice = 'one' | 'per-file' | 'cancel';

interface Props {
  files: string[];
  onChoice: (choice: PasteOrphanChoice) => void;
}

export default function PasteOrphanDialog({ files, onChoice }: Props) {
  const [choice, setChoice] = useState<PasteOrphanChoice>('one');
  return (
    <Modal title="Organize pasted files" titleId="paste-orphan-title" onClose={() => onChoice('cancel')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onChoice(choice);
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
        <button type="submit">Organize files</button>
        <button type="button" onClick={() => onChoice('cancel')}>
          Cancel paste
        </button>
      </form>
    </Modal>
  );
}
