import { useRef, useState } from 'react';
import Modal from './Modal';

export interface FindMatchJump {
  status: string;
  moved: boolean;
}

interface Props {
  onClose: () => void;
  onSearch: (query: string, direction: 'next' | 'prev', caseSensitive: boolean) => string;
  /** All matches of the query, as context snippets, in document order. */
  onListMatches?: (query: string, caseSensitive: boolean) => string[];
  /** Move to one listed match. The dialog closes only when moved is true. */
  onJumpToMatch?: (position: number) => FindMatchJump;
}

export default function FindDialog({ onClose, onSearch, onListMatches, onJumpToMatch }: Props) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [status, setStatus] = useState('Type text to find in this note.');
  const [matches, setMatches] = useState<string[]>([]);
  const matchButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const refreshMatches = (searchedQuery: string, searchedCaseSensitive: boolean) => {
    if (onListMatches) setMatches(onListMatches(searchedQuery, searchedCaseSensitive));
  };

  const search = (direction: 'next' | 'prev') => {
    setStatus(onSearch(query, direction, caseSensitive));
    refreshMatches(query, caseSensitive);
  };

  const moveMatchFocus = (from: number, delta: number) => {
    const buttons = matchButtonRefs.current.filter((button): button is HTMLButtonElement => Boolean(button));
    const next = buttons[from + delta];
    if (next) next.focus();
  };

  return (
    <Modal title="Find in document" titleId="find-title" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search('next');
        }}
      >
        <label>
          Find in document
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
        <button type="button" onClick={() => search('prev')}>
          Find previous
        </button>
        <button type="submit">Find next</button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </form>
      {matches.length > 0 ? (
        <div>
          <p id="find-matches-heading">
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}. Arrow keys move through the
            list; Enter moves to the match.
          </p>
          <ul
            aria-labelledby="find-matches-heading"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              const buttons = matchButtonRefs.current.filter(
                (button): button is HTMLButtonElement => Boolean(button),
              );
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (current < 0) return;
              event.preventDefault();
              moveMatchFocus(current, event.key === 'ArrowDown' ? 1 : -1);
            }}
          >
            {matches.map((snippet, index) => (
              <li key={index}>
                <button
                  type="button"
                  ref={(element) => {
                    matchButtonRefs.current[index] = element;
                  }}
                  onClick={() => {
                    if (!onJumpToMatch) return;
                    const result = onJumpToMatch(index);
                    setStatus(result.status);
                    if (result.moved) onClose();
                  }}
                >
                  Match {index + 1}: {snippet}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}
