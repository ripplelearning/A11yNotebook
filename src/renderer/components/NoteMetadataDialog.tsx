import { useId, useMemo, useState } from 'react';
import Modal from './Modal';
import {
  parseFrontMatter,
  serializeFrontMatter,
  suggestTags,
  type FrontMatterEntry,
} from '../../shared/front-matter';

interface NoteMetadataDialogProps {
  noteTitle: string;
  content: string;
  libraryTags: string[];
  onApply: (content: string) => void;
  onClose: () => void;
}

interface Row {
  key: string;
  kind: 'scalar' | 'list';
  text: string;
}

function toRows(entries: FrontMatterEntry[]): Row[] {
  return entries.map((entry) => ({
    key: entry.key,
    kind: entry.kind,
    text: entry.kind === 'list' ? entry.items.join(', ') : entry.value,
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
      : { key: row.key, kind: 'scalar' as const, value: row.text, items: [] },
  );
}

/**
 * Structured editor for a note's YAML front matter. Only the bounded
 * subset from shared/front-matter is editable; richer blocks are shown
 * read-only with the reason rather than risk mangling them.
 */
export default function NoteMetadataDialog({
  noteTitle,
  content,
  libraryTags,
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
          {rows.map((row, index) => (
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
              {row.key.toLowerCase() === 'tags' && suggestions.length ? (
                <div>
                  <span>Suggested tags: </span>
                  {suggestions.map((tag) => (
                    <button key={tag} type="button" onClick={() => addTag(tag)}>
                      Add {tag}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
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
