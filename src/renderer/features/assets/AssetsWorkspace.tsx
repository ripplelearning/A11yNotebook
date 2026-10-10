import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assetTypes,
  createAssetRegistry,
  parseOutline,
  parseMindMap,
  parseFlashcards,
  parseCsv,
  parseGridMarkdown,
  serializeOutline,
  serializeMindMap,
  serializeCsv,
  serializeGridMarkdown,
  type OutlineNode,
  type GridData,
  type CardSchedule,
} from '../../../shared/assets';
import type { VaultAsset } from '../../../shared/asset-bridge';
import type { AssetDraft, AssetDraftRecovery } from '../../../shared/asset-drafts';
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
  const [recovery, setRecovery] = useState<AssetDraftRecovery | null>(null);
  const [compare, setCompare] = useState(false);
  const [checkpointStatus, setCheckpointStatus] = useState('');
  const [restoredConflict, setRestoredConflict] = useState(false);
  const session = useRef(0);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const discoveredDraft = useRef('');
  const returnToEditor = useRef(false);
  useEffect(() => {
    if (busy) return;
    if (recovery?.draft) {
      const identity = `${recovery.draft.path}:${recovery.draft.revision}`;
      if (discoveredDraft.current !== identity) {
        discoveredDraft.current = identity;
        restoreButton.current?.focus();
        announce(`Unsaved asset checkpoint from ${recovery.draft.updatedAt} found. Restore, discard, or compare it.`);
      }
    } else if (returnToEditor.current) {
      returnToEditor.current = false;
      const target =
        editor.current?.querySelector<HTMLElement>('textarea:not(:disabled), input:not(:disabled)') ??
        editor.current?.querySelector<HTMLElement>('button:not(:disabled)');
      const details = target?.closest('details');
      if (details) details.open = true;
      target?.focus();
    }
  }, [busy, recovery, announce]);
  const loadContent = useCallback((value: VaultAsset) => {
    if (value.type === 'outline') setOutline(parseOutline(value.content));
    if (value.type === 'mindmap') setMindmap(parseMindMap(value.content));
    if (value.type === 'grid' || value.type === 'markdown-grid')
      setGrid(value.type === 'grid' ? parseCsv(value.content) : parseGridMarkdown(value.content));
    if (value.type === 'flashcards') setDeckSource(value.content);
  }, []);
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
    session.current += 1;
    setBusy(true);
    setReviewReady(false);
    setAsset(null);
    setRecovery(null);
    discoveredDraft.current = '';
    returnToEditor.current = false;
    setCompare(false);
    setRestoredConflict(false);
    setCheckpointStatus('');
    void window
      .a11yNotebook!.vault.readAsset(path)
      .then(async (value) => {
        if (cancelled) return;
        loadContent(value);
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
        const recoverable = await window.a11yNotebook!.vault.readAssetDraft?.(path);
        if (!cancelled) setRecovery(recoverable ?? { enabled: false, token: '', draft: null });
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(failure.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      session.current += 1;
    };
  }, [path, loadContent]);

  const source =
    asset?.type === 'outline'
      ? serializeOutline(outline)
      : asset?.type === 'mindmap'
        ? serializeMindMap(mindmap)
        : asset?.type === 'grid'
          ? serializeCsv(grid)
          : asset?.type === 'markdown-grid'
            ? serializeGridMarkdown(grid)
            : deckSource;
  useEffect(() => {
    if (!asset || !dirty || busy || !recovery?.enabled || recovery.draft) return;
    const generation = session.current;
    setCheckpointStatus('Encrypted checkpoint pending.');
    const timer = setTimeout(() => {
      void window.a11yNotebook!.vault.checkpointAssetDraft!(
        {
          path: asset.path,
          type: asset.type,
          baselineContent: asset.content,
          content: source,
        },
        recovery.token,
      )
        .then(() => {
          if (session.current === generation) setCheckpointStatus('Encrypted checkpoint saved.');
        })
        .catch((failure: Error) => {
          if (session.current === generation) setCheckpointStatus(`Checkpoint failed: ${failure.message}`);
        });
    }, 750);
    return () => clearTimeout(timer);
  }, [asset, dirty, busy, recovery, source]);

  const discardRecovery = async (draft: AssetDraft) => {
    if (!asset || !recovery || busy) return;
    const generation = session.current;
    setBusy(true);
    try {
      await window.a11yNotebook!.vault.discardAssetDraft!(asset.path, draft.revision, recovery.token);
      if (session.current !== generation) return;
      const next = await window.a11yNotebook!.vault.readAssetDraft!(asset.path);
      if (session.current !== generation) return;
      setRecovery(next);
      returnToEditor.current = true;
      setCompare(false);
      announce('Recovered draft discarded. The source file was not changed.');
    } catch (failure) {
      if (session.current === generation) setError((failure as Error).message);
    } finally {
      if (session.current === generation) setBusy(false);
    }
  };
  const discardEdits = async () => {
    if (!asset || busy) return;
    session.current += 1;
    const generation = session.current;
    setBusy(true);
    try {
      const latest = await window.a11yNotebook!.vault.readAssetDraft?.(asset.path);
      if (session.current !== generation) return;
      if (latest?.draft)
        await window.a11yNotebook!.vault.discardAssetDraft!(asset.path, latest.draft.revision, latest.token);
      if (session.current !== generation) return;
      const next = latest?.enabled ? await window.a11yNotebook!.vault.readAssetDraft!(asset.path) : latest;
      if (session.current !== generation) return;
      loadContent(asset);
      setDirty(false);
      setRestoredConflict(false);
      setReviewReady(asset.type === 'flashcards');
      setCheckpointStatus('');
      setRecovery(next ?? recovery);
      announce('Unsaved changes and their checkpoint discarded. Source file unchanged.');
    } catch (failure) {
      if (session.current === generation) setError((failure as Error).message);
    } finally {
      if (session.current === generation) setBusy(false);
    }
  };

  const save = (content: string) => {
    if (!asset || busy || recovery?.draft) return;
    session.current += 1;
    const saveGeneration = session.current;
    setBusy(true);
    if (asset.type === 'flashcards') setReviewReady(false);
    void window
      .a11yNotebook!.vault.saveAsset(asset.path, content, asset.content)
      .then(async () => {
        if (session.current !== saveGeneration) return;
        setAsset({ ...asset, content });
        setDirty(false);
        setRestoredConflict(false);
        if (asset.type === 'flashcards') {
          setDeckSource(content);
          setSchedules(await window.a11yNotebook!.vault.getFlashcardSchedules(asset.path));
          setReviewReady(true);
        }
        await refresh();
        const nextRecovery = await window.a11yNotebook!.vault.readAssetDraft?.(asset.path);
        if (session.current !== saveGeneration) return;
        if (nextRecovery) setRecovery(nextRecovery);
        setCheckpointStatus('');
        announce('Cognitive asset saved.');
      })
      .catch(async (failure: Error) => {
        if (session.current !== saveGeneration) return;
        setError(failure.message);
        try {
          const nextRecovery = await window.a11yNotebook!.vault.readAssetDraft?.(asset.path);
          if (nextRecovery && session.current === saveGeneration) setRecovery({ ...nextRecovery, draft: null });
        } catch {
          // A failed protected-store read must not turn into plaintext draft persistence.
        }
      })
      .finally(() => {
        if (session.current === saveGeneration) setBusy(false);
      });
  };
  return (
    <section aria-labelledby="assets-heading">
      <h2 id="assets-heading">Cognitive tools</h2>
      <p>
        Save changes before switching files or closing this view. Encrypted checkpoints require opted-in metadata
        protection; the latest edits within 750 milliseconds may be lost.
      </p>
      {recovery && !recovery.enabled ? <p>Encrypted recovery is off. Unsaved changes stay only in this view.</p> : null}
      {checkpointStatus ? <p role="status">{checkpointStatus}</p> : null}
      {recovery?.draft && asset ? (
        <section role="region" aria-labelledby="asset-recovery-heading">
          <h3 id="asset-recovery-heading">Recover unsaved asset changes</h3>
          <p>
            Checkpoint from {recovery.draft.updatedAt}. Restore changes only in the editor; saving is a separate action.
          </p>
          {recovery.draft.baselineContent !== asset.content ? (
            <p role="alert">
              Conflict: the source file changed since this checkpoint. Compare before restoring. Nothing will be
              overwritten automatically.
            </p>
          ) : null}
          <button
            ref={restoreButton}
            disabled={busy}
            onClick={() => {
              try {
                loadContent({ ...asset, content: recovery.draft!.content });
                setRestoredConflict(recovery.draft!.baselineContent !== asset.content);
                setDirty(true);
                setReviewReady(false);
                setRecovery({ ...recovery, draft: null });
                returnToEditor.current = true;
                setCompare(false);
                announce('Draft restored as unsaved changes. The source file was not changed.');
              } catch (failure) {
                setError(
                  `Draft source is incomplete. Compare and copy it before discarding: ${(failure as Error).message}`,
                );
                setCompare(true);
              }
            }}
          >
            Restore as unsaved changes
          </button>
          <button disabled={busy} onClick={() => void discardRecovery(recovery.draft!)}>
            Discard recovered draft
          </button>
          <button disabled={busy} aria-expanded={compare} onClick={() => setCompare(!compare)}>
            Compare recovered draft
          </button>
          {compare ? (
            <div>
              <label>
                Checkpoint baseline
                <textarea readOnly value={recovery.draft.baselineContent} />
              </label>
              <label>
                Current source
                <textarea readOnly value={asset.content} />
              </label>
              <label>
                Recovered unsaved source
                <textarea readOnly value={recovery.draft.content} />
              </label>
            </div>
          ) : null}
        </section>
      ) : null}
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
      {dirty ? (
        <div>
          <p>Unsaved asset changes.</p>
          <button disabled={busy} onClick={() => void discardEdits()}>
            Discard unsaved asset changes
          </button>
        </div>
      ) : null}
      {restoredConflict ? (
        <p role="alert">
          Restored draft conflicts with the checkpoint baseline. Your explicit save will replace the current source only
          if it has not changed again. Review your changes first.
        </p>
      ) : null}
      <div ref={editor} aria-busy={busy}>
        {asset?.type === 'outline' ? (
          <OutlineEditor
            value={outline}
            readOnly={busy || !!recovery?.draft}
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
            readOnly={busy || !!recovery?.draft}
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
            readOnly={busy || !!recovery?.draft}
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
        {asset?.type === 'flashcards' && reviewReady && !dirty && !recovery?.draft ? (
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
                disabled={busy || !!recovery?.draft}
                value={deckSource}
                onChange={(event) => {
                  setDeckSource(event.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <button type="button" disabled={busy || !!recovery?.draft} onClick={() => save(deckSource)}>
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
