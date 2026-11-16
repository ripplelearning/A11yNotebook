import { useState } from 'react';
import Modal from '../../components/Modal';
import type { ImportChoice, ImportPending } from '../../../shared/alius';

export type ImportDialogChoice = ImportChoice | 'cancel';

interface Props {
  pending: ImportPending;
  /**
   * Ask for the file name as well as the copy-or-Alius choice (pasted
   * files). Imports keep their fixed destination name and never ask.
   */
  askName?: boolean;
  onChoice: (choice: ImportDialogChoice, name?: string) => void;
}

/**
 * Copy or Alius prompt, shown for every import: the user always chooses,
 * with no "don't ask again" checkbox and no remembered default. Feature 2
 * (paste) reuses this dialog for pasted files, with the file-name
 * question added.
 */
export default function ImportAliusDialog({ pending, askName, onChoice }: Props) {
  const [choice, setChoice] = useState<ImportChoice>('copy');
  const [name, setName] = useState(pending.destinationName);
  const [error, setError] = useState('');
  return (
    <Modal title="Import file" titleId="import-choice-title" onClose={() => onChoice('cancel')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (askName) {
            const trimmed = name.trim();
            if (!trimmed || /[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
              setError('Enter a file name without separators or reserved characters.');
              return;
            }
            onChoice(choice, trimmed);
            return;
          }
          onChoice(choice);
        }}
      >
        <p>You are importing “{pending.sourceName}”. How should it be stored in the library?</p>
        <fieldset>
          <legend>Import choice</legend>
          <label>
            <input
              type="radio"
              name="import-choice"
              value="copy"
              checked={choice === 'copy'}
              onChange={() => setChoice('copy')}
            />
            Make a copy
          </label>
          <p>A separate copy is stored in the library. The original file is left unchanged.</p>
          <label>
            <input
              type="radio"
              name="import-choice"
              value="alius"
              checked={choice === 'alius'}
              onChange={() => setChoice('alius')}
            />
            Create an Alius
          </label>
          <p>
            A shortcut to the original file is stored in the library. The original stays where it is and can
            still be opened and edited in the app.
          </p>
          {pending.libraryEncrypted ? (
            <p>The library is encrypted, but the original file itself is not encrypted.</p>
          ) : null}
        </fieldset>
        {askName ? (
          <label>
            File name
            <input data-autofocus value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
          </label>
        ) : null}
        {askName ? <p>The file keeps its converted format: an RTF file becomes an HTML note, a Word .doc becomes a text note.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit">Import</button>
        <button type="button" onClick={() => onChoice('cancel')}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
