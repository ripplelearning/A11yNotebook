import { useEffect, useState } from 'react';
import {
  assetTypes,
  createAssetRegistry,
  parseOutline,
  parseMindMap,
  parseFlashcards,
  parseCsv,
  parseGridMarkdown,
  serializeOutline,
  type OutlineNode,
  type GridData,
  type CardSchedule,
} from '../../../shared/assets';
import type { VaultAsset } from '../../../shared/asset-bridge';
import { OutlineEditor, MindMapEditor, GridEditor, FlashcardReview } from './index';

interface Props {
  paths: string[];
  initialPath?: string;
  refresh: () => Promise<void>;
  announce: (message: string) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  selectionVersion?: number;
}

const registry = createAssetRegistry(assetTypes);
const STARTERS: Record<string, { extension: string; source: string }> = {
  outline: { extension: '.outline.md', source: '- First item\n' },
  mindmap: { extension: '.mindmap.json', source: '{"id":"root","text":"Main idea","children":[]}\n' },
  flashcards: { extension: '.cards.md', source: 'Question :: Answer\n' },
  grid: { extension: '.csv', source: 'Column 1,Column 2\n,\n' },
  'markdown-grid': { extension: '.grid.md', source: '| Column 1 | Column 2 |\n| --- | --- |\n| | |\n' },
};

export default function AssetsWorkspace({
  paths,
  initialPath,
  refresh,
  announce,
  onDirty,
  onBusy,
  selectionVersion,
}: Props) {
  const [path, setPath] = useState(initialPath ?? '');
  const [asset, setAsset] = useState<VaultAsset | null>(null);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [mindmap, setMindmap] = useState<OutlineNode>({ id: 'root', text: 'Main idea', children: [] });
  const [grid, setGrid] = useState<GridData>({ columns: ['Column 1'], rows: [['']] });
  const [schedules, setSchedules] = useState<Record<string, CardSchedule>>({});
  const [newType, setNewType] = useState('outline');
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deckSource, setDeckSource] = useState('');
  const [reviewReady, setReviewReady] = useState(false);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(() => {
    if (initialPath) setPath(initialPath);
  }, [initialPath, selectionVersion]);

  useEffect(() => {
    if (!path) {
      setAsset(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setReviewReady(false);
    setAsset(null);
    void window
      .a11yNotebook!.vault.readAsset(path)
      .then(async (value) => {
        if (cancelled) return;
        if (value.type === 'outline') setOutline(parseOutline(value.content));
        if (value.type === 'mindmap') setMindmap(parseMindMap(value.content));
        if (value.type === 'grid' || value.type === 'markdown-grid')
          setGrid(value.type === 'grid' ? parseCsv(value.content) : parseGridMarkdown(value.content));
        if (value.type === 'flashcards') {
          setDeckSource(value.content);
          const stored = await window.a11yNotebook!.vault.getFlashcardSchedules(path);
          if (cancelled) return;
          setSchedules(stored);
          setReviewReady(true);
        }
        setAsset(value);
        setDirty(false);
        setError('');
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(failure.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const save = (content: string) => {
    if (!asset || busy) return;
    setBusy(true);
    if (asset.type === 'flashcards') setReviewReady(false);
    void window
      .a11yNotebook!.vault.saveAsset(asset.path, content, asset.content)
      .then(async () => {
        setAsset({ ...asset, content });
        setDirty(false);
        if (asset.type === 'flashcards') {
          setDeckSource(content);
          setSchedules(await window.a11yNotebook!.vault.getFlashcardSchedules(asset.path));
          setReviewReady(true);
        }
        await refresh();
        announce('Cognitive asset saved.');
      })
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };
  return (
    <section aria-labelledby="assets-heading">
      <h2 id="assets-heading">Cognitive tools</h2>
      <p>Save changes before switching files or closing this view. Unsaved changes stay only in this view.</p>
      <label>
        Asset file
        <select disabled={busy || dirty} value={path} onChange={(event) => setPath(event.target.value)}>
          <option value="">Choose an asset</option>
          {paths
            .filter((relative) => registry.resolve(relative))
            .map((relative) => (
              <option key={relative}>{relative}</option>
            ))}
        </select>
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || dirty) return;
          if (!name.trim() || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') {
            setError('Enter a valid filename. Assets are created at the vault root.');
            return;
          }
          const starter = STARTERS[newType];
          const relative = `${name.trim()}${starter.extension}`;
          setBusy(true);
          void window
            .a11yNotebook!.vault.createAsset(relative, starter.source)
            .then(async () => {
              await refresh();
              setPath(relative);
              announce('Cognitive asset created.');
            })
            .catch((failure: Error) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          New asset type
          <select disabled={busy || dirty} value={newType} onChange={(event) => setNewType(event.target.value)}>
            {assetTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          New asset name
          <input
            disabled={busy || dirty}
            maxLength={150}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || dirty}>
          Create asset
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {dirty ? <p>Unsaved asset changes.</p> : null}
      <div aria-busy={busy}>
        {asset?.type === 'outline' ? (
          <OutlineEditor
            value={outline}
            readOnly={busy}
            onChange={(value) => {
              setOutline(value);
              setDirty(true);
            }}
            onSave={save}
          />
        ) : null}
        {asset?.type === 'mindmap' ? (
          <MindMapEditor
            value={mindmap}
            readOnly={busy}
            onChange={(value) => {
              setMindmap(value);
              setDirty(true);
            }}
            onSave={save}
            onExportOutline={(content) => {
              if (busy) return;
              setBusy(true);
              const relative = asset.path.replace(/\.mindmap\.json$/i, '.outline.md');
              void window
                .a11yNotebook!.vault.createAsset(relative, content)
                .then(refresh)
                .then(() => announce('Mind map exported as a Markdown outline.'))
                .catch((failure: Error) => setError(failure.message))
                .finally(() => setBusy(false));
            }}
          />
        ) : null}
        {asset && ['grid', 'markdown-grid'].includes(asset.type) ? (
          <GridEditor
            value={grid}
            readOnly={busy}
            onChange={(value) => {
              setGrid(value);
              setDirty(true);
            }}
            onSave={(source, format) => {
              if (
                (asset.type === 'grid' && format !== 'csv') ||
                (asset.type === 'markdown-grid' && format !== 'markdown')
              ) {
                setError('Choose the format matching this file. Create a separate asset to convert formats.');
                return;
              }
              save(source);
            }}
          />
        ) : null}
        {asset?.type === 'flashcards' && reviewReady && !dirty ? (
          <FlashcardReview
            key={`${asset.path}:${asset.content}`}
            cards={parseFlashcards(asset.content)}
            schedules={schedules}
            announce={announce}
            onSchedule={async (id, schedule) => {
              setBusy(true);
              try {
                await window.a11yNotebook!.vault.saveFlashcardSchedule(asset.path, id, schedule, asset.content);
                setSchedules((stored) => ({ ...stored, [id]: schedule }));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
        {asset?.type === 'flashcards' ? (
          <details>
            <summary>Edit flashcard deck source</summary>
            <label>
              Flashcard deck source
              <textarea
                disabled={busy}
                value={deckSource}
                onChange={(event) => {
                  setDeckSource(event.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <button type="button" disabled={busy} onClick={() => save(deckSource)}>
              Save flashcard deck
            </button>
          </details>
        ) : null}
      </div>
      {asset?.type === 'outline' ? (
        <details>
          <summary>Markdown outline source</summary>
          <pre>{serializeOutline(outline)}</pre>
        </details>
      ) : null}
    </section>
  );
}
