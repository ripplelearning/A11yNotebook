import { useState } from 'react';
import Modal from '../../components/Modal';

interface Props {
  notebooks: string[];
  /** The notebook the user worked in most recently, offered first when it still exists. */
  currentNotebook?: string;
  onChoice: (notebookPath: string | null) => void;
}

/**
 * Notebook picker for a paste with no notebook selected (Q9): the user
 * picks the notebook, with the current notebook offered first. Returns
 * null when the dialog is dismissed.
 */
export default function PasteNotebookDialog({ notebooks, currentNotebook, onChoice }: Props) {
  const ordered = [
    ...(currentNotebook && notebooks.includes(currentNotebook) ? [currentNotebook] : []),
    ...notebooks.filter((notebook) => notebook !== currentNotebook),
  ];
  const [choice, setChoice] = useState(ordered[0] ?? '');
  return (
    <Modal title="Choose a notebook" titleId="paste-notebook-title" onClose={() => onChoice(null)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (choice) onChoice(choice);
        }}
      >
        <p>No notebook is selected. Which notebook should the pasted content go into?</p>
        <fieldset>
          <legend>Notebook</legend>
          {ordered.map((notebook) => (
            <label key={notebook}>
              <input
                type="radio"
                name="paste-notebook-choice"
                value={notebook}
                checked={choice === notebook}
                onChange={() => setChoice(notebook)}
              />
              {notebook}
              {notebook === currentNotebook ? ' (current notebook)' : ''}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={!choice}>
          Paste here
        </button>
        <button type="button" onClick={() => onChoice(null)}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
