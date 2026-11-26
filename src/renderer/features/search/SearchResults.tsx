import { normalizeDateText } from '../../../shared/calendar';
import type { VaultSearchQuery, VaultSearchResult } from '../../../shared/search';

export type SearchScope = 'current' | 'library';

interface Props {
  filters: Omit<VaultSearchQuery, 'text'>;
  onFilters: (value: Omit<VaultSearchQuery, 'text'>) => void;
  notebooks: string[];
  results: VaultSearchResult[];
  active: boolean;
  onOpen: (result: VaultSearchResult) => void;
  scope: SearchScope;
  selectedNotebookPath?: string;
  selectedNotebookName?: string;
  scopeBlocked: boolean;
}

export const KIND_LABELS: Record<VaultSearchResult['kind'], string> = {
  note: 'Note',
  attachment: 'Text attachment',
  docx: 'DOCX document',
  task: 'Task',
  reminder: 'Reminder',
  appointment: 'Appointment',
};

export default function SearchResults({
  filters,
  onFilters,
  notebooks,
  results,
  active,
  onOpen,
  scope,
  selectedNotebookPath,
  selectedNotebookName,
  scopeBlocked,
}: Props) {
  const scopeLabel =
    scope === 'current'
      ? `Current notebook${selectedNotebookName ? `: ${selectedNotebookName}` : ''}`
      : 'Whole library';
  // A typed date filter that cannot convert to the query's YYYY-MM-DD
  // form is dropped from the search instead of failing it (see
  // normalizeSearchDateFilters): say so, so the user is not misled
  // into thinking the filter applied. Only a complete-looking date
  // earns the note — a half-typed one is still being typed.
  const COMPLETE_DATE_TEXT = /^(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})$/;
  const invalidDate = (value: string | undefined): string | null => {
    if (!value || !COMPLETE_DATE_TEXT.test(value.trim())) return null;
    return normalizeDateText(value) ? null : value.trim();
  };
  const invalidAfter = invalidDate(filters.modifiedAfter);
  const invalidBefore = invalidDate(filters.modifiedBefore);
  const afterIso = filters.modifiedAfter ? normalizeDateText(filters.modifiedAfter) : null;
  const beforeIso = filters.modifiedBefore ? normalizeDateText(filters.modifiedBefore) : null;
  const reversedRange = Boolean(afterIso && beforeIso && Date.parse(afterIso) > Date.parse(beforeIso));
  // Escape lives with the search dialog now: the dialog closes and
  // clears the search, so this section needs no Escape handling of its
  // own. The heading is gone too — the dialog is already titled
  // "Search", so the section is labelled instead of headed.
  return (
    <section aria-label="Search filters and results">
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
                kind: event.target.value ? (event.target.value as VaultSearchQuery['kind']) : undefined,
              })
            }
          >
            <option value="">All kinds</option>
            <option value="note">Notes</option>
            <option value="attachment">Text attachments</option>
            <option value="docx">DOCX documents</option>
            <option value="task">Tasks</option>
            <option value="reminder">Reminders</option>
            <option value="appointment">Appointments</option>
          </select>
        </label>
        <p>
          Tasks, reminders, and appointments have no tags and no modified date, so the tag and modified-date
          filters exclude them; appointments belong to no notebook, so the notebook filter excludes them too.
        </p>
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
            type="text"
            placeholder="MM/DD/YYYY"
            value={filters.modifiedAfter ?? ''}
            onChange={(event) => onFilters({ ...filters, modifiedAfter: event.target.value || undefined })}
          />
        </label>
        <label>
          Modified on or before
          <input
            type="text"
            placeholder="MM/DD/YYYY"
            value={filters.modifiedBefore ?? ''}
            onChange={(event) => onFilters({ ...filters, modifiedBefore: event.target.value || undefined })}
          />
        </label>
        {reversedRange ? (
          <p>The changed-date range is reversed, so the date filters are ignored.</p>
        ) : (
          <>
            {invalidAfter ? (
              <p>{invalidAfter} is not a real date, so the “on or after” filter is ignored.</p>
            ) : null}
            {invalidBefore ? (
              <p>{invalidBefore} is not a real date, so the “on or before” filter is ignored.</p>
            ) : null}
          </>
        )}
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
                <li key={`${result.kind}:${result.targetId ?? result.path}`}>
                  <button
                    type="button"
                    data-context="search-result"
                    data-path={result.path}
                    onClick={() => onOpen(result)}
                  >
                    {KIND_LABELS[result.kind]}: {result.title}
                  </button>
                  <p>{result.snippet}</p>
                  <small>
                    {result.path ? `${result.path} · ` : ''}
                    {result.tags.join(', ')}
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
