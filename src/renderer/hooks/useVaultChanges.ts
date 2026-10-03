import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { VaultInfo } from '../../shared/types';
import type { OpenNote, NoteConflict } from '../features/vault/open-note';

export function useVaultChanges(
  vault: VaultInfo | null,
  notes: OpenNote[],
  setNotes: Dispatch<SetStateAction<OpenNote[]>>,
  setVault: Dispatch<SetStateAction<VaultInfo | null>>,
  announce: (message: string) => void,
) {
  const notesRef = useRef(notes);
  const rootRef = useRef(vault?.path);
  notesRef.current = notes;
  rootRef.current = vault?.path;
  const [conflicts, setConflicts] = useState<NoteConflict[]>([]);
  const [checking, setChecking] = useState(false);
  const vaultPath = vault?.path;
  const operations = useRef(0);

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
          const disk = exists(latest.entries, snapshot.path) ? await bridge.readNote(snapshot.path) : null;
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
            setConflicts((items) => items.filter((item) => item.path !== current.path));
          } else {
            setConflicts((items) => [
              ...items.filter((item) => item.path !== current.path),
              { path: current.path, disk },
            ]);
            announce(`External changes conflict with ${current.title}. Choose how to resolve them.`);
          }
        }
      } catch {
        announce('Could not refresh external vault changes. Your unsaved edits are preserved.');
      } finally {
        operations.current -= 1;
        if (!operations.current) setChecking(false);
      }
    },
    [announce, setNotes, setVault],
  );

  useEffect(() => {
    setConflicts([]);
    const bridge = window.a11yNotebook?.vault;
    if (!vaultPath || !bridge?.onChanged) return;
    let queue = Promise.resolve();
    return bridge.onChanged((event) => {
      if (event.vaultPath !== rootRef.current) return;
      setChecking(true);
      queue = queue.then(() => checkDisk()).catch(() => announce('Could not synchronize the vault.'));
    });
  }, [vaultPath, checkDisk, announce]);

  return {
    conflicts,
    checking,
    checkDisk,
    clearConflict: (relative: string) => setConflicts((items) => items.filter((item) => item.path !== relative)),
  };
}
