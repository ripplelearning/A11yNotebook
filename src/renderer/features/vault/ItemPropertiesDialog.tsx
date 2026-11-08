import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import type { ItemStats, VaultBookmark, VaultEntry, VaultLink, VaultTask } from '../../../shared/types';
import type { Reminder } from '../../../shared/reminders';
import { assetTypes, createAssetRegistry } from '../../../shared/assets';
import { attachmentTypeLabel } from '../../../shared/attachments';

const assetRegistry = createAssetRegistry(assetTypes);

interface Props {
  /** The item to describe; for staged copies this is the draft entry. */
  entry: VaultEntry;
  /** Live path for stats and counts, or null when the item exists only in draft. */
  livePath: string | null;
  /** Live library tree, for contained counts and the protected flag. */
  liveEntries: VaultEntry[];
  tasks: VaultTask[];
  bookmarks: VaultBookmark[];
  reminders: Reminder[];
  links: VaultLink[];
  onClose: () => void;
}

function formatDate(milliseconds: number | null): string {
  return milliseconds === null ? 'Unknown' : new Date(milliseconds).toLocaleString();
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function collectDescendants(entry: VaultEntry): VaultEntry[] {
  return (entry.children ?? []).flatMap((child) => [child, ...collectDescendants(child)]);
}

function isUnder(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

function findLiveEntry(entries: VaultEntry[], targetPath: string): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    const nested = entry.children && findLiveEntry(entry.children, targetPath);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Details and counts for one library item. Stats (location, dates, size)
 * come from the main process; counts come from the library state. The
 * annotation row is omitted for notebooks, whose annotations are not
 * listed anywhere in one place today.
 */
export default function ItemPropertiesDialog({
  entry,
  livePath,
  liveEntries,
  tasks,
  bookmarks,
  reminders,
  links,
  onClose,
}: Props) {
  const [stats, setStats] = useState<ItemStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [annotationCount, setAnnotationCount] = useState<number | null>(null);

  useEffect(() => {
    if (!livePath) return;
    let cancelled = false;
    const bridge = window.a11yNotebook?.vault;
    if (!bridge?.getItemStats) {
      setStatsError(true);
      return;
    }
    void bridge
      .getItemStats(livePath)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch(() => {
        if (!cancelled) setStatsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [livePath]);

  useEffect(() => {
    if (!livePath) return;
    let cancelled = false;
    const bridge = window.a11yNotebook?.vault;
    const lower = livePath.toLowerCase();
    const query = entry.kind === 'note'
      ? bridge?.getAnnotations?.(livePath)
      : lower.endsWith('.pdf')
        ? bridge?.listPdfAnnotations?.(livePath)
        : lower.endsWith('.docx')
          ? bridge?.listDocxAnnotations?.(livePath)
          : lower.endsWith('.epub')
            ? bridge?.listEpubAnnotations?.(livePath)
            : undefined;
    if (!query) return;
    void query
      .then((result) => {
        if (!cancelled) setAnnotationCount(result.length);
      })
      .catch(() => {
        // An unreadable annotation store hides the row rather than guessing.
      });
    return () => {
      cancelled = true;
    };
  }, [livePath, entry.kind]);

  const kindLabel =
    entry.kind === 'notebook'
      ? 'Notebook'
      : entry.kind === 'note'
        ? 'Note'
        : entry.kind === 'link'
          ? 'Link'
          : attachmentTypeLabel(entry.path);
  const liveEntry = livePath ? findLiveEntry(liveEntries, livePath) : undefined;
  const descendants = liveEntry?.children ? collectDescendants(liveEntry) : [];
  const taskCount = livePath
    ? tasks.filter((task) => (entry.kind === 'notebook' ? isUnder(task.path, livePath) : task.path === livePath)).length
    : 0;
  const reminderCount = livePath
    ? reminders.filter(
        (reminder) => reminder.path && (entry.kind === 'notebook' ? isUnder(reminder.path, livePath) : reminder.path === livePath),
      ).length
    : 0;
  const bookmarkCount = livePath
    ? bookmarks.filter((bookmark) => (entry.kind === 'notebook' ? isUnder(bookmark.path, livePath) : bookmark.path === livePath))
        .length
    : 0;
  const linkedPaths = new Set<string>();
  if (livePath) {
    for (const link of links) {
      const touches =
        entry.kind === 'notebook'
          ? isUnder(link.sourcePath, livePath) || (link.targetPath && isUnder(link.targetPath, livePath))
          : link.sourcePath === livePath || link.targetPath === livePath;
      if (!touches) continue;
      for (const counterpart of [link.sourcePath, link.targetPath]) {
        if (counterpart && !(entry.kind === 'notebook' ? isUnder(counterpart, livePath) : counterpart === livePath))
          linkedPaths.add(counterpart);
      }
    }
  }
  const toolCount = livePath
    ? entry.kind === 'notebook'
      ? descendants.filter((item) => assetRegistry.resolve(item.path)).length
      : assetRegistry.resolve(livePath)
        ? 1
        : 0
    : 0;

  return (
    <Modal title="Properties" titleId="item-properties-title" onClose={onClose}>
      <h3>
        {entry.name} ({kindLabel})
      </h3>
      {!livePath ? (
        <p>This item has not been created yet. Apply the staged changes first, then open its properties.</p>
      ) : (
        <>
          {statsError ? <p role="alert">File details could not be read.</p> : !stats ? <p>Loading file details…</p> : null}
          <dl>
            {stats ? (
              <>
                <div>
                  <dt>Saved location</dt>
                  <dd>{stats.absolutePath}</dd>
                </div>
                <div>
                  <dt>Date created</dt>
                  <dd>{formatDate(stats.createdMs)}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{formatDate(stats.modifiedMs)}</dd>
                </div>
                <div>
                  <dt>Size on disk</dt>
                  <dd>{formatBytes(stats.size)}</dd>
                </div>
              </>
            ) : null}
          <div>
            <dt>Protected</dt>
            <dd>{liveEntry?.protected ? 'Protected' : 'Not protected'}</dd>
          </div>
          <div>
            <dt>Tasks</dt>
            <dd>{taskCount}</dd>
          </div>
          <div>
            <dt>Reminders</dt>
            <dd>{reminderCount}</dd>
          </div>
          <div>
            <dt>Bookmarks</dt>
            <dd>{bookmarkCount}</dd>
          </div>
          {annotationCount !== null ? (
            <div>
              <dt>Annotations</dt>
              <dd>{annotationCount}</dd>
            </div>
          ) : null}
          <div>
            <dt>Cognitive tools</dt>
            <dd>{toolCount}</dd>
          </div>
          {entry.kind === 'notebook' ? (
            <>
              <div>
                <dt>Contained notes</dt>
                <dd>{descendants.filter((item) => item.kind === 'note').length}</dd>
              </div>
              <div>
                <dt>Contained files</dt>
                <dd>{descendants.filter((item) => item.kind === 'attachment').length}</dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>Linked items</dt>
            <dd>{linkedPaths.size}</dd>
          </div>
          </dl>
        </>
      )}
      <button type="button" data-default data-autofocus onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}
