import type { VaultSearchQuery, VaultSearchResult } from '../../../shared/search';

interface Props {
  filters: Omit<VaultSearchQuery, 'text'>;
  onFilters: (value: Omit<VaultSearchQuery, 'text'>) => void;
  notebooks: string[];
  results: VaultSearchResult[];
  active: boolean;
  onOpen: (relative: string) => void;
}

export default function SearchResults({ filters, onFilters, notebooks, results, active, onOpen }: Props) {
  return (
    <section aria-labelledby="search-results-heading">
      <h3 id="search-results-heading">Search</h3>
      <details>
        <summary>Search filters</summary>
        <label>
          Search notebook
          <select
            value={filters.notebook ?? ''}
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
        <label>
          Search kind
          <select
            value={filters.kind ?? ''}
            onChange={(event) =>
              onFilters({
                ...filters,
                kind: event.target.value ? (event.target.value as 'note' | 'attachment') : undefined,
              })
            }
          >
            <option value="">All kinds</option>
            <option value="note">Notes</option>
            <option value="attachment">Text attachments</option>
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
        <>
          <p>{results.length} results shown (up to 100).</p>
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
      ) : null}
    </section>
  );
}
