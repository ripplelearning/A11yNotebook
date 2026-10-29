import type { VaultEntry } from './types';

/**
 * Library views hide files superseded by a managed copy, unless the user
 * turns "Show original files" on. Notebooks always stay: only their
 * superseded leaves are filtered, so the folder structure never shifts.
 */
export function filterHiddenOriginals(entries: VaultEntry[], showOriginals: boolean): VaultEntry[] {
  if (showOriginals) return entries;
  return entries.flatMap((entry) => {
    if (entry.kind === 'notebook')
      return [{ ...entry, children: entry.children ? filterHiddenOriginals(entry.children, false) : undefined }];
    return entry.superseded ? [] : [entry];
  });
}

/** Library-relative paths of superseded files, for filtering search results. */
export function supersededPaths(entries: VaultEntry[]): Set<string> {
  const paths = new Set<string>();
  const collect = (items: VaultEntry[]) => {
    for (const entry of items) {
      if (entry.superseded) paths.add(entry.path);
      if (entry.children) collect(entry.children);
    }
  };
  collect(entries);
  return paths;
}
