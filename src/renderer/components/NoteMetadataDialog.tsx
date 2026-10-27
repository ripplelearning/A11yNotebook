import { useId, useMemo, useState } from 'react';
import Modal from './Modal';
import {
  parseFrontMatter,
  serializeFrontMatter,
  suggestKeys,
  suggestTags,
  suggestValues,
  type FrontMatterEntry,
  type ScalarType,
} from '../../shared/front-matter';

interface NoteMetadataDialogProps {
  noteTitle: string;
  content: string;
  libraryTags: string[];
  /** Library field names with their values; suggestions are hidden when absent. */
  libraryFields?: Record<string, string[]>;
  onApply: (content: string) => void;
  onClose: () => void;
}

interface Row {
  key: string;
  kind: 'scalar' | 'list';
  text: string;
  raw?: string;
  scalarType?: ScalarType;
}

function toRows(entries: FrontMatterEntry[]): Row[] {
  return entries.map((entry) => ({
    key: entry.key,
    kind: entry.kind,
    text: entry.kind === 'list' ? entry.items.join(', ') : entry.value,
    raw: entry.raw,
    scalarType: entry.scalarType,
  }));
}

function toEntries(rows: Row[]): FrontMatterEntry[] {
  return rows.map((row) =>
    row.kind === 'list'
      ? {
          key: row.key,
          kind: 'list' as const,
          value: '',
          items: row.text
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        }
      : {
          key: row.key,
          kind: 'scalar' as const,
          value: row.text,
          items: [],
          raw: row.raw,
          scalarType: row.scalarType,
        },
  );
}

/**
 * Structured editor for a note's YAML front matter. Only the bounded
 * subset from shared/front-matter is editable; richer blocks are shown
 * read-only with the reason rather than risk mangling them. Scalars keep
 * their YAML type (numbers, booleans, and null stay unquoted), and field
 * names and values suggest from what the library already uses.
 */
export default function NoteMetadataDialog({
  noteTitle,
  content,
  libraryTags,
  libraryFields = {},
  onApply,
  onClose,
}: NoteMetadataDialogProps) {
  const titleId = useId();
  const listHintId = useId();
  const document = useMemo(() => parseFrontMatter(content), [content]);
  const [rows, setRows] = useState<Row[]>(() => toRows(document.entries));
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState('');

  const tagsRow = rows.find((row) => row.key.toLowerCase() === 'tags');
  const currentTags = tagsRow
    ? tagsRow.text
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];
  const suggestions = suggestTags(libraryTags, currentTags);

  const updateRow = (index: number, text: string) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, text } : row)));

  const addTag = (tag: string) => {
    const index = rows.findIndex((row) => row.key.toLowerCase() === 'tags');
    if (index === -1) {
      setRows((current) => [...current, { key: 'tags', kind: 'list', text: tag }]);
    } else {
      const row = rows[index];
      updateRow(index, row.text.trim() ? `${row.text.replace(/,\s*$/, '')}, ${tag}` : tag);
      if (rows[index].kind !== 'list')
        setRows((current) => current.map((item, i) => (i === index ? { ...item, kind: 'list' } : item)));
    }
  };

  /** Apply a suggested value: replace a scalar, append to a list. */
  const addValue = (index: number, value: string) => {
    const row = rows[index];
    if (row.kind === 'list') {
      updateRow(index, row.text.trim() ? `${row.text.replace(/,\s*$/, '')}, ${value}` : value);
    } else {
      updateRow(index, value);
    }
  };

  const keySuggestions = suggestKeys(
    libraryFields,
    rows.map((row) => row.key),
  ).filter((key) =>
    newKey.trim() ? key.toLowerCase().startsWith(newKey.trim().toLowerCase()) : true,
  );

  const addField = () => {
    const key = newKey.trim();
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(key)) {
      setError('Enter a field name using letters, numbers, dashes, or underscores.');
      return;
    }
    if (rows.some((row) => row.key.toLowerCase() === key.toLowerCase())) {
      setError(`The field "${key}" already exists. Edit it above instead.`);
      return;
    }
    setError('');
    setRows((current) => [
      ...current,
      { key, kind: key.toLowerCase() === 'tags' ? 'list' : 'scalar', text: newValue },
    ]);
    setNewKey('');
    setNewValue('');
  };

  return (
    <Modal titleId={titleId} title={`Note metadata — ${noteTitle}`} onClose={onClose}>
      {error ? <p role="alert">{error}</p> : null}
      {!document.supported ? (
        <>
          <p>
            This note’s front matter can’t be edited here: {document.unsupportedReason} You can still edit it
            directly in the note source.
          </p>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      ) : (
        <>
          {rows.length === 0 ? <p>This note has no front-matter fields yet. Add one below.</p> : null}
          {rows.map((row, index) => {
            const isTags = row.key.toLowerCase() === 'tags';
            const rowValues =
              row.kind === 'list'
                ? row.text
                    .split(',')
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0)
                : [row.text.trim()].filter((item) => item.length > 0);
            const valueSuggestions = isTags ? [] : suggestValues(libraryFields, row.key, rowValues);
            return (
              <div key={`${row.key}-${index}`}>
                <label>
                  {row.key}
                  <input
                    value={row.text}
                    aria-describedby={row.kind === 'list' ? listHintId : undefined}
                    onChange={(event) => updateRow(index, event.target.value)}
                  />
                </label>
                {row.kind === 'list' ? <span id={listHintId}>Comma-separated list.</span> : null}{' '}
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  Remove {row.key}
                </button>
                {isTags && suggestions.length ? (
                  <div>
                    <span>Suggested tags: </span>
                    {suggestions.map((tag) => (
                      <button key={tag} type="button" onClick={() => addTag(tag)}>
                        Add {tag}
                      </button>
                    ))}
                  </div>
                ) : null}
                {!isTags && valueSuggestions.length ? (
                  <div>
                    <span>Suggested values: </span>
                    {valueSuggestions.map((value) => (
                      <button key={value} type="button" onClick={() => addValue(index, value)}>
                        {row.kind === 'list' ? `Add ${value}` : `Use ${value}`}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div>
            <label>
              New field name
              <input value={newKey} onChange={(event) => setNewKey(event.target.value)} />
            </label>
            <label>
              New field value
              <input value={newValue} onChange={(event) => setNewValue(event.target.value)} />
            </label>
            <button type="button" onClick={addField}>
              Add field
            </button>
            {keySuggestions.length ? (
              <div>
                <span>Suggested fields: </span>
                {keySuggestions.map((key) => (
                  <button key={key} type="button" onClick={() => setNewKey(key)}>
                    Use {key}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <button
              type="button"
              onClick={() => onApply(serializeFrontMatter(toEntries(rows), document.body))}
            >
              Apply metadata
            </button>{' '}
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
