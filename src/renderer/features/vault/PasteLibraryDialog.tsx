import { useState } from 'react';
import Modal from '../../components/Modal';

export type PasteLibraryChoice = 'copy' | 'original' | 'cancel';

interface Props {
  folderName: string;
  onChoice: (choice: PasteLibraryChoice) => void;
}

export default function PasteLibraryDialog({ folderName, onChoice }: Props) {
  const [choice, setChoice] = useState<PasteLibraryChoice>('copy');
  return (
    <Modal title="Paste library" titleId="paste-library-title" onClose={() => onChoice('cancel')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onChoice(choice);
        }}
      >
        <p>
          You pasted the folder “{folderName}”. How should it become a library?
        </p>
        <fieldset>
          <legend>Library paste choice</legend>
          <label>
            <input
              type="radio"
              name="paste-library-choice"
              value="copy"
              checked={choice === 'copy'}
              onChange={() => setChoice('copy')}
            />
            Make an A11y Notebook copy of the library
          </label>
          <p>Your original folder is left untouched. You will be asked where to save the copy.</p>
          <label>
            <input
              type="radio"
              name="paste-library-choice"
              value="original"
              checked={choice === 'original'}
              onChange={() => setChoice('original')}
            />
            Use the original folder as the library
          </label>
          <p>The app will open that folder as a library and add its library data to it.</p>
        </fieldset>
        <button type="submit">Continue</button>
        <button type="button" onClick={() => onChoice('cancel')}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
