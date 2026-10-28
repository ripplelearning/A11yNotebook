import { useState } from 'react';
import Modal from './Modal';

interface Props {
  onClose: () => void;
  onSearch: (query: string, direction: 'next' | 'prev', caseSensitive: boolean) => string;
}

export default function FindDialog({ onClose, onSearch }: Props) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [status, setStatus] = useState('Type text to find in this note.');
  return (
    <Modal title="Find in note" titleId="find-title" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setStatus(onSearch(query, 'next', caseSensitive));
        }}
      >
        <label>
          Find in note
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-autofocus
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          />
          Match case
        </label>
        <p role="status">{status}</p>
        <button type="button" onClick={() => setStatus(onSearch(query, 'prev', caseSensitive))}>
          Find previous
        </button>
        <button type="submit">Find next</button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </form>
    </Modal>
  );
}
