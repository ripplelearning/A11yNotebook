import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import {
  authorsToText,
  CITATION_SOURCE_TYPES,
  CITATION_STYLES,
  formatBibliography,
  formatInText,
  parseAuthors,
  sortBibliography,
  type BibliographyEntry,
  type CitationSourceType,
  type CitationStyle,
} from '../../../shared/citations';

interface Props {
  notebookPath: string;
  initialView: 'generator' | 'bibliography';
  onInsertInText: (text: string) => void;
  onInsertBibliography: (entries: BibliographyEntry[], style: CitationStyle) => void;
  onClose: () => void;
}

type FieldKey =
  | 'authors'
  | 'editors'
  | 'title'
  | 'year'
  | 'publisher'
  | 'place'
  | 'journal'
  | 'volume'
  | 'issue'
  | 'pages'
  | 'containerTitle'
  | 'conferenceName'
  | 'institution'
  | 'edition'
  | 'thesisLevel'
  | 'doi'
  | 'url'
  | 'isbn'
  | 'accessed';

const FIELD_LABELS: Record<FieldKey, string> = {
  authors: 'Authors (one per line, Last, First)',
  editors: 'Editors (one per line, Last, First)',
  title: 'Title',
  year: 'Year',
  publisher: 'Publisher',
  place: 'Place of publication',
  journal: 'Journal',
  volume: 'Volume',
  issue: 'Issue',
  pages: 'Pages',
  containerTitle: 'Book title',
  conferenceName: 'Conference name',
  institution: 'Institution',
  edition: 'Edition',
  thesisLevel: 'Thesis level',
  doi: 'DOI',
  url: 'URL',
  isbn: 'ISBN',
  accessed: 'Date accessed',
};

const FIELDS_BY_TYPE: Record<CitationSourceType, FieldKey[]> = {
  book: ['authors', 'title', 'year', 'publisher', 'place', 'edition', 'doi', 'url', 'isbn'],
  journal: ['authors', 'title', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'url'],
  website: ['authors', 'title', 'year', 'publisher', 'url', 'accessed'],
  chapter: ['authors', 'title', 'year', 'containerTitle', 'editors', 'pages', 'publisher', 'place', 'doi', 'url'],
  conference: ['authors', 'title', 'year', 'conferenceName', 'place', 'doi', 'url'],
  report: ['authors', 'title', 'year', 'institution', 'publisher', 'doi', 'url'],
  thesis: ['authors', 'title', 'year', 'institution', 'thesisLevel', 'doi', 'url'],
};

const EMPTY_FORM: Record<string, string> = {};

export default function CitationDialog({
  notebookPath,
  initialView,
  onInsertInText,
  onInsertBibliography,
  onClose,
}: Props) {
  const [view, setView] = useState<'generator' | 'bibliography'>(initialView);
  const [entries, setEntries] = useState<BibliographyEntry[]>([]);
  const [loadError, setLoadError] = useState('');
  const [style, setStyle] = useState<CitationStyle>('apa');
  const [sourceType, setSourceType] = useState<CitationSourceType>('book');
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [lookupStatus, setLookupStatus] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [page, setPage] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.a11yNotebook?.vault
      .getBibliography(notebookPath)
      .then((saved) => {
        if (!cancelled) setEntries(saved);
      })
      .catch(() => {
        if (!cancelled) setLoadError('The bibliography for this notebook could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [notebookPath]);

  const setField = (key: FieldKey, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const formEntry = (): BibliographyEntry => ({
    id: editingId ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    notebookPath,
    sourceType,
    authors: parseAuthors(form.authors ?? ''),
    editors: form.editors ? parseAuthors(form.editors) : undefined,
    title: (form.title ?? '').trim(),
    year: form.year?.trim() || undefined,
    publisher: form.publisher?.trim() || undefined,
    place: form.place?.trim() || undefined,
    journal: form.journal?.trim() || undefined,
    volume: form.volume?.trim() || undefined,
    issue: form.issue?.trim() || undefined,
    pages: form.pages?.trim() || undefined,
    containerTitle: form.containerTitle?.trim() || undefined,
    conferenceName: form.conferenceName?.trim() || undefined,
    institution: form.institution?.trim() || undefined,
    edition: form.edition?.trim() || undefined,
    thesisLevel: form.thesisLevel === 'masters' ? 'masters' : form.thesisLevel === 'doctoral' ? 'doctoral' : undefined,
    doi: form.doi?.trim() || undefined,
    url: form.url?.trim() || undefined,
    isbn: form.isbn?.trim() || undefined,
    accessed: form.accessed?.trim() || undefined,
  });

  const loadIntoForm = (entry: BibliographyEntry) => {
    setSourceType(entry.sourceType);
    setEditingId(entry.id);
    setForm({
      authors: authorsToText(entry.authors),
      editors: entry.editors ? authorsToText(entry.editors) : '',
      title: entry.title,
      year: entry.year ?? '',
      publisher: entry.publisher ?? '',
      place: entry.place ?? '',
      journal: entry.journal ?? '',
      volume: entry.volume ?? '',
      issue: entry.issue ?? '',
      pages: entry.pages ?? '',
      containerTitle: entry.containerTitle ?? '',
      conferenceName: entry.conferenceName ?? '',
      institution: entry.institution ?? '',
      edition: entry.edition ?? '',
      thesisLevel: entry.thesisLevel ?? '',
      doi: entry.doi ?? '',
      url: entry.url ?? '',
      isbn: entry.isbn ?? '',
      accessed: entry.accessed ?? '',
    });
    setError('');
    setSavedMessage('');
    setView('generator');
  };

  const saveEntry = async () => {
    const entry = formEntry();
    if (!entry.title) {
      setError('Enter a title before saving.');
      return;
    }
    setError('');
    try {
      const next = editingId ? entries.map((item) => (item.id === editingId ? entry : item)) : [...entries, entry];
      const saved = await window.a11yNotebook!.vault.saveBibliography(notebookPath, next);
      setEntries(saved);
      setEditingId(entry.id);
      setSavedMessage(editingId ? 'Entry updated.' : 'Entry added to this notebook’s bibliography.');
    } catch {
      setError('The entry could not be saved.');
    }
  };

  const deleteEntry = async (id: string) => {
    try {
      const saved = await window.a11yNotebook!.vault.saveBibliography(
        notebookPath,
        entries.filter((entry) => entry.id !== id),
      );
      setEntries(saved);
      setConfirmDeleteId(null);
    } catch {
      setError('The entry could not be deleted.');
    }
  };

  const autoFill = async () => {
    setLookupStatus('');
    setError('');
    setLookupBusy(true);
    try {
      const found = await window.a11yNotebook!.vault.fetchCitationMetadata(lookup);
      if (found.sourceType) setSourceType(found.sourceType);
      setEditingId(null);
      setForm({
        authors: found.authors ? authorsToText(found.authors) : '',
        editors: found.editors ? authorsToText(found.editors) : '',
        title: found.title ?? '',
        year: found.year ?? '',
        publisher: found.publisher ?? '',
        place: found.place ?? '',
        journal: found.journal ?? '',
        volume: found.volume ?? '',
        issue: found.issue ?? '',
        pages: found.pages ?? '',
        containerTitle: found.containerTitle ?? '',
        conferenceName: found.conferenceName ?? '',
        institution: found.institution ?? '',
        edition: found.edition ?? '',
        thesisLevel: found.thesisLevel ?? '',
        doi: found.doi ?? '',
        url: found.url ?? '',
        isbn: found.isbn ?? '',
        accessed: found.accessed ?? '',
      });
      setLookupStatus(
        found.doi ? 'Filled from the DOI record.' : found.isbn ? 'Filled from the ISBN record.' : 'Filled from the page.',
      );
    } catch (failure) {
      setLookupStatus(failure instanceof Error ? failure.message : 'Nothing could be filled in.');
    } finally {
      setLookupBusy(false);
    }
  };

  const previewEntry = formEntry();
  const sorted = sortBibliography(entries);

  return (
    <Modal title="Citations" titleId="citation-dialog-title" onClose={onClose}>
      <div role="group" aria-label="Citation view">
        <button type="button" aria-pressed={view === 'generator'} onClick={() => setView('generator')}>
          Citation generator
        </button>
        <button type="button" aria-pressed={view === 'bibliography'} onClick={() => setView('bibliography')}>
          Bibliography
        </button>
      </div>
      <label>
        Citation style
        <select value={style} onChange={(event) => setStyle(event.target.value as CitationStyle)}>
          {CITATION_STYLES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {loadError ? (
        <p role="alert">{loadError}</p>
      ) : null}
      {view === 'generator' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveEntry();
          }}
        >
          <label>
            Source type
            <select
              value={sourceType}
              onChange={(event) => {
                setSourceType(event.target.value as CitationSourceType);
                setEditingId(null);
              }}
            >
              {CITATION_SOURCE_TYPES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Fill in automatically</legend>
            <label>
              DOI, ISBN, or web address
              <input value={lookup} onChange={(event) => setLookup(event.target.value)} />
            </label>
            <button type="button" disabled={lookupBusy || !lookup.trim()} onClick={() => void autoFill()}>
              {lookupBusy ? 'Looking up…' : 'Fill in from source'}
            </button>
            {lookupStatus ? (
              <p role="status">{lookupStatus}</p>
            ) : null}
            <p>Or fill in the fields below by hand. Nothing is sent anywhere except a lookup you request.</p>
          </fieldset>
          {FIELDS_BY_TYPE[sourceType].map((key) =>
            key === 'authors' || key === 'editors' ? (
              <label key={key}>
                {FIELD_LABELS[key]}
                <textarea value={form[key] ?? ''} onChange={(event) => setField(key, event.target.value)} />
              </label>
            ) : key === 'thesisLevel' ? (
              <label key={key}>
                {FIELD_LABELS[key]}
                <select value={form[key] ?? ''} onChange={(event) => setField(key, event.target.value)}>
                  <option value="">Choose a level</option>
                  <option value="doctoral">Doctoral dissertation</option>
                  <option value="masters">Master&apos;s thesis</option>
                </select>
              </label>
            ) : key === 'accessed' ? (
              <label key={key}>
                {FIELD_LABELS[key]}
                <input type="date" value={form[key] ?? ''} onChange={(event) => setField(key, event.target.value)} />
              </label>
            ) : (
              <label key={key}>
                {FIELD_LABELS[key]}
                <input value={form[key] ?? ''} onChange={(event) => setField(key, event.target.value)} />
              </label>
            ),
          )}
          {error ? (
            <p role="alert">{error}</p>
          ) : null}
          {savedMessage ? (
            <p role="status">{savedMessage}</p>
          ) : null}
          <div>
            <h3>Preview</h3>
            <p>Bibliography: {previewEntry.title ? formatBibliography(previewEntry, style, 'plain') : 'Fill in a title.'}</p>
            <p>In-text: {previewEntry.title ? formatInText(previewEntry, style) : '—'}</p>
          </div>
          <button type="submit">{editingId ? 'Update bibliography entry' : 'Save to bibliography'}</button>
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY_FORM);
              setEditingId(null);
              setError('');
              setSavedMessage('');
            }}
          >
            Clear form
          </button>
          <button
            type="button"
            onClick={() => onInsertInText(formatInText(previewEntry, style))}
            disabled={!previewEntry.title}
          >
            Insert in-text citation
          </button>
        </form>
      ) : (
        <div>
          <p>
            {sorted.length === 0
              ? 'This notebook has no bibliography entries yet. Add one in the citation generator.'
              : `${sorted.length} ${sorted.length === 1 ? 'entry' : 'entries'} in this notebook’s bibliography.`}
          </p>
          <label>
            Cited page (optional, for in-text citations)
            <input value={page} onChange={(event) => setPage(event.target.value)} />
          </label>
          <button
            type="button"
            disabled={sorted.length === 0}
            onClick={() => onInsertBibliography(sorted, style)}
          >
            Insert full bibliography
          </button>
          <ul>
            {sorted.map((entry) => (
              <li key={entry.id}>
                <p>{formatBibliography(entry, style, 'plain')}</p>
                <button type="button" onClick={() => onInsertInText(formatInText(entry, style, page))}>
                  Insert in-text citation
                </button>
                <button type="button" onClick={() => loadIntoForm(entry)}>
                  Edit
                </button>
                {confirmDeleteId === entry.id ? (
                  <button type="button" onClick={() => void deleteEntry(entry.id)}>
                    Confirm delete
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmDeleteId(entry.id)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}
