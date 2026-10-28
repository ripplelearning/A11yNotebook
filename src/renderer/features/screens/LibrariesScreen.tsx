import { useMemo } from 'react';
import DetailsView from '../../components/DetailsView';
import type { RecentLibrary, VaultInfo } from '../../../shared/types';

interface LibrariesScreenProps {
  vault: VaultInfo | null;
  recentLibraries?: RecentLibrary[];
  onOpenLibrary: () => void;
  onNewLibrary?: () => void;
  onOpenRecent?: (path: string) => void;
  disabled?: boolean;
  showCommandButtons?: boolean;
}

export default function LibrariesScreen({
  vault,
  recentLibraries = [],
  onOpenLibrary,
  onNewLibrary,
  onOpenRecent,
  disabled,
  showCommandButtons = true,
}: LibrariesScreenProps) {
  // Every library the app knows about: the open one first, then recent
  // ones, deduplicated by path. The grid sorts by name; the open library
  // row is marked selected.
  const libraries = useMemo(() => {
    const byPath = new Map<string, { name: string; path: string; kind: 'library' }>();
    if (vault) byPath.set(vault.path, { name: vault.name, path: vault.path, kind: 'library' });
    for (const library of recentLibraries) {
      if (!byPath.has(library.path)) {
        byPath.set(library.path, { name: library.name, path: library.path, kind: 'library' });
      }
    }
    return [...byPath.values()];
  }, [vault, recentLibraries]);

  return (
    <section aria-labelledby="libraries-heading">
      <h2 id="libraries-heading">{vault?.name ?? 'Libraries'}</h2>
      {showCommandButtons && (
        <>
          <button type="button" onClick={onNewLibrary} disabled={disabled || !onNewLibrary}>
            New library
          </button>
          <button type="button" onClick={onOpenLibrary} disabled={disabled}>
            Open library
          </button>
        </>
      )}
      {!vault && <p>No library is open. Open a local library to get started.</p>}
      <DetailsView
        label="Libraries"
        items={libraries}
        columns={['name', 'path']}
        selectedPath={vault?.path ?? null}
        // Selecting a row has no side effect here; the open library row
        // is marked selected, and Enter opens a library.
        onSelect={() => undefined}
        onOpen={(entry) => {
          if (!disabled && entry.path !== vault?.path) onOpenRecent?.(entry.path);
        }}
        emptyMessage="No libraries yet. Open or create a library to get started."
      />
    </section>
  );
}
