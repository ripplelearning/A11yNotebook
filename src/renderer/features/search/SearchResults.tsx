import type { VaultSearchQuery, VaultSearchResult } from '../../../shared/search';

export type SearchScope = 'current' | 'library';

interface Props {
  filters: Omit<VaultSearchQuery, 'text'>;
  onFilters: (value: Omit<VaultSearchQuery, 'text'>) => void;
  notebooks: string[];
  results: VaultSearchResult[];
  active: boolean;
  onOpen: (relative: string) => void;
  scope: SearchScope;
  onScope: (value: SearchScope) => void;
  selectedNotebookPath?: string;
  selectedNotebookName?: string;
  scopeBlocked: boolean;
}

export default function SearchResults({
  filters,
  onFilters,
  notebooks,
  results,
  active,
  onOpen,
  scope,
  onScope,
  selectedNotebookPath,
  selectedNotebookName,
  scopeBlocked,
}: Props) {
  const scopeLabel =
    scope === 'current'
      ? `Current notebook${selectedNotebookName ? `: ${selectedNotebookName}` : ''}`
      : 'Whole library';
  return (
    <section aria-labelledby="search-results-heading">
      <h3 id="search-results-heading">Search</h3>
      <fieldset>
        <legend>Search scope</legend>
        <label>
          <input
            type="radio"
            name="search-scope"
            value="current"
            checked={scope === 'current'}
            onChange={() => onScope('current')}
          />
          {selectedNotebookName ? `Current notebook: ${selectedNotebookName}` : 'Current notebook (none selected)'}
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
      <details>
        <summary>Search filters</summary>
        <label>
          Search notebook
          <select
            value={scope === 'current' ? (selectedNotebookPath ?? '') : (filters.notebook ?? '')}
            disabled={scope === 'current'}
            onChange={(event) => onFilters({ ...filters, notebook: event.target.value || undefined })}
          >
            <option value="">All notebooks</option>
            {notebooks.map((notebook) => (
              <option key={notebook} value={notebook}>
                {notebook}
              </option>
            ))}
          </select>
        </label>
        {scope === 'current' ? <p>The notebook filter follows the selected notebook in this scope.</p> : null}
        <label>
          Search kind
          <select
            value={filters.kind ?? ''}
            onChange={(event) =>
              onFilters({
                ...filters,
                kind: event.target.value ? (event.target.value as 'note' | 'attachment' | 'docx') : undefined,
              })
            }
          >
            <option value="">All kinds</option>
            <option value="note">Notes</option>
            <option value="attachment">Text attachments</option>
            <option value="docx">DOCX documents</option>
          </select>
        </label>
        <label>
          Search tag
          <input
            value={filters.tag ?? ''}
            onChange={(event) => onFilters({ ...filters, tag: event.target.value || undefined })}
            placeholder="#tag"
          />
        </label>
        <label>
          Modified on or after
          <input
            type="date"
            value={filters.modifiedAfter ?? ''}
            onChange={(event) => onFilters({ ...filters, modifiedAfter: event.target.value || undefined })}
          />
        </label>
        <label>
          Modified on or before
          <input
            type="date"
            value={filters.modifiedBefore ?? ''}
            onChange={(event) => onFilters({ ...filters, modifiedBefore: event.target.value || undefined })}
          />
        </label>
      </details>
      {active ? (
        scopeBlocked ? (
          <p>Select a notebook to search it, or switch search scope to Whole library.</p>
        ) : (
          <>
            <p>
              {results.length} results shown (up to 100) in {scopeLabel}.
            </p>
            <ul aria-label="Search results">
              {results.map((result) => (
                <li key={result.path}>
                  <button
                    type="button"
                    data-context="search-result"
                    data-path={result.path}
                    onClick={() => onOpen(result.path)}
                  >
                    {result.title}
                  </button>
                  <p>{result.snippet}</p>
                  <small>
                    {result.path} · {result.tags.join(', ')}
                  </small>
                </li>
              ))}
            </ul>
            {!results.length ? <p>No matching results.</p> : null}
          </>
        )
      ) : null}
    </section>
  );
}
