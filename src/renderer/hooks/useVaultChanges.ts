import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { VaultInfo } from '../../shared/types';
import type { OpenNote, NoteConflict } from '../features/vault/open-note';

export function useVaultChanges(
  vault: VaultInfo | null,
  notes: OpenNote[],
  setNotes: Dispatch<SetStateAction<OpenNote[]>>,
  setVault: Dispatch<SetStateAction<VaultInfo | null>>,
  announce: (message: string) => void,
  /**
   * Called for each note whose content the hook replaces with the disk
   * version. Callers use it to drop state chained to the old content —
   * the fallback undo history, whose snapshots would otherwise let
   * undo resurrect pre-reload content over the reloaded content.
   */
  onContentReplaced?: (path: string) => void,
) {
  const notesRef = useRef(notes);
  const rootRef = useRef(vault?.path);
  const onContentReplacedRef = useRef(onContentReplaced);
  notesRef.current = notes;
  rootRef.current = vault?.path;
  onContentReplacedRef.current = onContentReplaced;
  const [conflicts, setConflicts] = useState<NoteConflict[]>([]);
  const [checking, setChecking] = useState(false);
  const vaultPath = vault?.path;
  const operations = useRef(0);
  // Waiters for the disk-check queue to drain, so a manual save that
  // lands mid-check can wait instead of being dropped silently.
  const idleWaitersRef = useRef<Array<() => void>>([]);

  /**
   * Resolves once the current disk-check queue has drained (no check in
   * flight). Resolves immediately when nothing is checking.
   */
  const whenIdle = useCallback(() => {
    if (operations.current === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      idleWaitersRef.current.push(resolve);
    });
  }, []);

  const checkDisk = useCallback(
    async (notePath?: string) => {
      const bridge = window.a11yNotebook?.vault;
      const root = rootRef.current;
      if (!bridge || !root) return;
      operations.current += 1;
      setChecking(true);
      try {
        const latest = await bridge.get();
        if (!latest || latest.path !== root || rootRef.current !== root) return;
        setVault(latest);
        const exists = (entries: VaultInfo['entries'], relative: string): boolean =>
          entries.some((entry) => entry.path === relative || (entry.children && exists(entry.children, relative)));
        for (const snapshot of [...notesRef.current]) {
          if (notePath && snapshot.path !== notePath) continue;
          let disk: string | null;
          try {
            disk = exists(latest.entries, snapshot.path) ? await bridge.readNote(snapshot.path) : null;
          } catch (failure) {
            // An Alius whose original is gone cannot be read: surface the
            // conflict dialog (with a Save copy option) instead of only
            // announcing a refresh failure. Other notes keep the
            // fail-closed announce below.
            if (!snapshot.aliusTarget) throw failure;
            disk = null;
          }
          if (rootRef.current !== root) return;
          const current = notesRef.current.find((note) => note.path === snapshot.path);
          if (!current || disk === current.saved) continue;
          if (disk !== null && (current.content === current.saved || current.content === disk)) {
            setNotes((items) =>
              items.map((item) =>
                item.path === current.path && (item.content === item.saved || item.content === disk)
                  ? { ...item, content: disk, saved: disk }
                  : item,
              ),
            );
            if (disk !== current.content) onContentReplacedRef.current?.(current.path);
            setConflicts((items) => items.filter((item) => item.path !== current.path));
          } else {
            setConflicts((items) => [
              ...items.filter((item) => item.path !== current.path),
              { path: current.path, disk, ...(current.aliusTarget ? { aliusTarget: current.aliusTarget } : {}) },
            ]);
            announce(`External changes conflict with ${current.title}. Choose how to resolve them.`);
          }
        }
      } catch {
        announce('Could not refresh external library changes. Your unsaved edits are preserved.');
      } finally {
        operations.current -= 1;
        if (!operations.current) {
          setChecking(false);
          idleWaitersRef.current.splice(0).forEach((resolve) => resolve());
        }
      }
    },
    [announce, setNotes, setVault],
  );
  const clearAllConflicts = useCallback(() => setConflicts([]), []);

  useEffect(() => {
    setConflicts([]);
    const bridge = window.a11yNotebook?.vault;
    if (!vaultPath || !bridge?.onChanged) return;
    let queue = Promise.resolve();
    return bridge.onChanged((event) => {
      if (event.vaultPath !== rootRef.current) return;
      setChecking(true);
      queue = queue.then(() => checkDisk()).catch(() => announce('Could not synchronize the library.'));
    });
  }, [vaultPath, checkDisk, announce]);

  return {
    conflicts,
    checking,
    checkDisk,
    whenIdle,
    clearAllConflicts,
    clearConflict: (relative: string) => setConflicts((items) => items.filter((item) => item.path !== relative)),
  };
}
