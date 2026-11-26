import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import type { VaultSearchQuery, VaultSearchResult } from '../../../shared/search';
import Modal from '../../components/Modal';
import SearchResults, { KIND_LABELS, type SearchScope } from './SearchResults';

interface Props {
  searchText: string;
  onSearchText: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  filters: Omit<VaultSearchQuery, 'text'>;
  onFilters: (value: Omit<VaultSearchQuery, 'text'>) => void;
  notebooks: string[];
  results: VaultSearchResult[];
  active: boolean;
  scope: SearchScope;
  onScope: (scope: SearchScope) => void;
  selectedNotebookPath?: string;
  selectedNotebookName?: string;
  scopeBlocked: boolean;
  onOpen: (result: VaultSearchResult) => void;
  onClose: () => void;
}

const MAX_SUGGESTIONS = 8;

interface Suggestion {
  key: string;
  label: string;
  value: string;
}

/**
 * The search dialog (1.9.23 retest, item 6): the main screen shows a
 * Search button instead of an inline search box, and this dialog holds
 * the search box, its autocomplete suggestions, the optional search
 * filters, and the results. Closing it with the Close button or
 * Escape clears the search box and the results (onClose, owned by the
 * caller); activating a result clears them too and moves focus to the
 * result's location. The dialog itself is a Modal: labelled, focus
 * trapped, Escape closes it, and focus returns to the Search button.
 *
 * Autocomplete suggestions are the distinct titles of the current
 * results, as a combobox listbox: ArrowUp/ArrowDown move the active
 * suggestion, Enter fills the box with it (the search re-runs for the
 * filled text), and a mouse click does the same. Suggestions never
 * open a result on their own — opening is what result buttons do.
 */
export default function SearchDialog({
  searchText,
  onSearchText,
  searchInputRef,
  filters,
  onFilters,
  notebooks,
  results,
  active,
  scope,
  onScope,
  selectedNotebookPath,
  selectedNotebookName,
  scopeBlocked,
  onOpen,
  onClose,
}: Props) {
  const suggestions = useMemo<Suggestion[]>(() => {
    const seen = new Set<string>();
    const list: Suggestion[] = [];
    for (const result of results) {
      const key = `${result.kind}:${result.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        key,
        label: `${KIND_LABELS[result.kind]}: ${result.title}`,
        value: result.title,
      });
      if (list.length >= MAX_SUGGESTIONS) break;
    }
    return list;
  }, [results]);

  const suggestionsOpen = searchText.trim() !== '' && suggestions.length > 0;
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // New results replace the suggestion list: the highlight cannot
  // survive them, so it resets instead of pointing at another title.
  // The dep is the joined keys, not the list itself: the caller
  // passes a freshly filtered array on every render, so a list-identity
  // dep would reset the highlight after every keypress and arrow
  // navigation could never stick.
  const suggestionKeys = suggestions.map((suggestion) => suggestion.key).join('|');
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestionKeys]);

  const acceptSuggestion = (suggestion: Suggestion) => {
    onSearchText(suggestion.value);
    setHighlightedIndex(-1);
    searchInputRef.current?.focus();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestionsOpen) return;
      event.preventDefault();
      setHighlightedIndex((index) =>
        event.key === 'ArrowDown'
          ? (index + 1) % suggestions.length
          : index <= 0
            ? suggestions.length - 1
            : index - 1,
      );
      return;
    }
    if (event.key === 'Enter') {
      const suggestion = highlightedIndex >= 0 ? suggestions[highlightedIndex] : undefined;
      if (suggestion) {
        event.preventDefault();
        acceptSuggestion(suggestion);
      }
      return;
    }
    // Escape is not handled here: it bubbles to the Modal, which closes
    // the dialog (and the caller clears the search). Handling it here
    // too would close twice, and stopping the native type="search"
    // clear belongs to the dialog's Escape handling.
  };

  return (
    <Modal titleId="search-dialog-title" title="Search" onClose={onClose} className="search-dialog">
      <button type="button" onClick={onClose}>
        Close
      </button>
      <div className="search-dialog-box">
        <input
          id="search-dialog-input"
          ref={searchInputRef}
          data-autofocus
          type="search"
          role="combobox"
          aria-label="Global search"
          aria-expanded={suggestionsOpen}
          aria-controls="search-suggestions"
          aria-activedescendant={
            highlightedIndex >= 0 ? `search-suggestion-${highlightedIndex}` : undefined
          }
          aria-autocomplete="list"
          value={searchText}
          onChange={(event) => onSearchText(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search library, notes, tasks, files"
        />
        {suggestionsOpen ? (
          <ul id="search-suggestions" role="listbox" aria-label="Search suggestions">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.key}
                id={`search-suggestion-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                onClick={() => acceptSuggestion(suggestion)}
              >
                {suggestion.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <fieldset className="global-search-scope">
        <legend>Search scope</legend>
        <label>
          <input
            type="radio"
            name="search-scope"
            value="current"
            checked={scope === 'current'}
            onChange={() => onScope('current')}
          />
          {selectedNotebookName ? (
            <>
              Current notebook: <span className="search-scope-notebook">{selectedNotebookName}</span>
            </>
          ) : (
            'Current notebook (none selected)'
          )}
        </label>
        <label>
          <input
            type="radio"
            name="search-scope"
            value="library"
            checked={scope === 'library'}
            onChange={() => onScope('library')}
          />
          Whole library
        </label>
      </fieldset>
      <SearchResults
        filters={filters}
        onFilters={onFilters}
        notebooks={notebooks}
        results={results}
        active={active}
        scope={scope}
        selectedNotebookPath={selectedNotebookPath}
        selectedNotebookName={selectedNotebookName}
        scopeBlocked={scopeBlocked}
        onOpen={onOpen}
      />
    </Modal>
  );
}
