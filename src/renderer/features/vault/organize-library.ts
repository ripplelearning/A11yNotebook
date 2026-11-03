import type { VaultEntry } from '../../../shared/types';

/**
 * One library change staged in the Organize Library dialog. Operations are
 * recorded against draft paths in staging order, so applying them in order
 * against the live library reproduces the draft: each operation's source
 * path is the result of the operations before it.
 */
export type StagedOp =
  | { type: 'rename'; from: string; to: string }
  | { type: 'move'; from: string; to: string }
  | { type: 'delete'; path: string; permanent: boolean }
  | { type: 'copy'; from: string; to: string }
  | { type: 'protect'; path: string; value: boolean };

export function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index) : '';
}

export function baseName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

export function isAtOrUnder(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function flattenEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenEntries(entry.children ?? [])]);
}

export function findEntryInTree(entries: VaultEntry[], targetPath: string): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    const nested = entry.children && findEntryInTree(entry.children, targetPath);
    if (nested) return nested;
  }
  return undefined;
}

export function cloneEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.map((entry) => ({
    ...entry,
    ...(entry.children ? { children: cloneEntries(entry.children) } : {}),
  }));
}

function removeNode(entries: VaultEntry[], targetPath: string): VaultEntry[] {
  const result: VaultEntry[] = [];
  for (const entry of entries) {
    if (entry.path === targetPath) continue;
    result.push(entry.children ? { ...entry, children: removeNode(entry.children, targetPath) } : entry);
  }
  return result;
}

function insertSorted(entries: VaultEntry[], node: VaultEntry, parent: string): VaultEntry[] {
  if (!parent) {
    const next = [...entries, node];
    next.sort((a, b) => a.name.localeCompare(b.name));
    return next;
  }
  return entries.map((entry) => {
    if (entry.path !== parent || entry.kind !== 'notebook') return entry;
    const children = [...(entry.children ?? []), node];
    children.sort((a, b) => a.name.localeCompare(b.name));
    return { ...entry, children };
  });
}

function rewritePaths(node: VaultEntry, from: string, to: string): VaultEntry {
  const rewritten: VaultEntry = {
    ...node,
    path: to + node.path.slice(from.length),
    name: node.path === from ? baseName(to) : node.name,
  };
  if (node.children) rewritten.children = node.children.map((child) => rewritePaths(child, from, to));
  return rewritten;
}

/** Move or rename a node inside the draft tree, rewriting its subtree paths. */
export function relocateNode(entries: VaultEntry[], from: string, to: string): VaultEntry[] {
  const node = findEntryInTree(entries, from);
  if (!node) return entries;
  const moved = rewritePaths(node, from, to);
  return insertSorted(removeNode(entries, from), moved, parentPath(to));
}

export function deleteNode(entries: VaultEntry[], targetPath: string): VaultEntry[] {
  return removeNode(entries, targetPath);
}

/** Duplicate a node inside the draft tree; the copy keeps its own subtree paths. */
export function copyNode(entries: VaultEntry[], from: string, to: string): VaultEntry[] {
  const node = findEntryInTree(entries, from);
  if (!node) return entries;
  // A copy is a new file with a new identity, so it starts unprotected:
  // protection records are keyed by file identity and never carry over.
  const stripProtection = (item: VaultEntry): VaultEntry => {
    const next = { ...item };
    delete next.protected;
    if (item.children) next.children = item.children.map(stripProtection);
    return next;
  };
  const copied = stripProtection(rewritePaths(node, from, to));
  return insertSorted(entries, copied, parentPath(to));
}

export function setProtectedFlag(entries: VaultEntry[], targetPath: string, value: boolean): VaultEntry[] {
  return entries.map((entry) => {
    if (entry.path === targetPath) {
      const next = { ...entry };
      if (value) next.protected = true;
      else delete next.protected;
      return next;
    }
    return entry.children ? { ...entry, children: setProtectedFlag(entry.children, targetPath, value) } : entry;
  });
}

/** The protected item blocking a change: the item itself, or its first protected descendant. */
export function findProtectionBlockInTree(
  entries: VaultEntry[],
  targetPath: string,
): { path: string; name: string } | null {
  const entry = findEntryInTree(entries, targetPath);
  if (!entry) return null;
  if (entry.protected) return { path: entry.path, name: entry.name };
  if (entry.children) {
    for (const child of entry.children) {
      const block = findProtectionBlockInTree(entry.children, child.path);
      if (block) return block;
    }
  }
  return null;
}

export type StageCheck =
  | { kind: 'ok' }
  | { kind: 'error'; message: string }
  | { kind: 'protected'; block: { path: string; name: string } };

function siblingNames(entries: VaultEntry[], parent: string): Set<string> {
  if (!parent) return new Set(entries.map((entry) => entry.name));
  const folder = findEntryInTree(entries, parent);
  return new Set((folder?.children ?? []).map((entry) => entry.name));
}

/** Validate staging a rename or move of `from` to `to` inside the draft tree. */
export function validateStageRelocate(entries: VaultEntry[], from: string, to: string): StageCheck {
  const node = findEntryInTree(entries, from);
  if (!node) return { kind: 'error', message: 'The selected item is no longer in the library.' };
  if (from === to) return { kind: 'error', message: 'Choose a different name or notebook.' };
  if (isAtOrUnder(to, from)) return { kind: 'error', message: 'An item cannot be moved inside itself.' };
  const parent = parentPath(to);
  if (parent) {
    const folder = findEntryInTree(entries, parent);
    if (!folder || folder.kind !== 'notebook')
      return { kind: 'error', message: 'The destination notebook must be a folder.' };
  }
  if (parent !== parentPath(from) || baseName(to) !== node.name) {
    if (siblingNames(entries, parent).has(baseName(to)))
      return { kind: 'error', message: 'An item with that name already exists.' };
  }
  const block = findProtectionBlockInTree(entries, from);
  if (block) return { kind: 'protected', block };
  return { kind: 'ok' };
}

/** Validate staging a delete of `path` inside the draft tree. */
export function validateStageDelete(entries: VaultEntry[], targetPath: string): StageCheck {
  const node = findEntryInTree(entries, targetPath);
  if (!node) return { kind: 'error', message: 'The selected item is no longer in the library.' };
  const block = findProtectionBlockInTree(entries, targetPath);
  if (block) return { kind: 'protected', block };
  return { kind: 'ok' };
}

/**
 * The previous and next notebooks in flattened tree order, for Alt+Up and
 * Alt+Down moves. The item's current parent never counts (moving there
 * would change nothing), and a notebook never counts itself or its own
 * descendants. Either side may be empty at the ends of the tree.
 */
export function previousNextNotebook(
  entries: VaultEntry[],
  itemPath: string,
): { previous: VaultEntry | null; next: VaultEntry | null } {
  const flat = flattenEntries(entries);
  const itemIndex = flat.findIndex((entry) => entry.path === itemPath);
  if (itemIndex < 0) return { previous: null, next: null };
  const item = flat[itemIndex];
  const currentParent = parentPath(itemPath);
  const candidates = flat.filter((entry) => {
    if (entry.kind !== 'notebook') return false;
    if (entry.path === currentParent) return false;
    if (item.kind === 'notebook' && isAtOrUnder(entry.path, itemPath)) return false;
    return true;
  });
  let previous: VaultEntry | null = null;
  let next: VaultEntry | null = null;
  for (const candidate of candidates) {
    const index = flat.indexOf(candidate);
    if (index < itemIndex) previous = candidate;
    if (index > itemIndex && !next) next = candidate;
  }
  return { previous, next };
}

/** A copy name no sibling already uses: "Name copy.ext", then "Name copy 2.ext". */
export function nonCollidingCopyName(entries: VaultEntry[], parent: string, name: string): string {
  const taken = siblingNames(entries, parent);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = `${stem} copy${ext}`;
  let count = 2;
  while (taken.has(candidate)) {
    candidate = `${stem} copy ${count}${ext}`;
    count += 1;
  }
  return candidate;
}

/**
 * Map a draft path back to the live path it came from, by inverting staged
 * renames and moves in reverse order. Returns null for an item the staged
 * changes create (a copy), which has no live path yet.
 */
export function draftPathToLivePath(draftPath: string, ops: readonly StagedOp[]): string | null {
  let current = draftPath;
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    const op = ops[index];
    if (op.type === 'rename' || op.type === 'move') {
      if (current === op.to || current.startsWith(`${op.to}/`)) current = op.from + current.slice(op.to.length);
    } else if (op.type === 'copy') {
      if (current === op.to || current.startsWith(`${op.to}/`)) return null;
    }
  }
  return current;
}

/**
 * Follow one live path through staged operations, for remapping open tabs
 * after a commit: renames and moves rewrite the path, deletes remove it
 * (null), copies and protections leave it alone.
 */
export function remapPathAfterOps(path: string, ops: readonly StagedOp[]): string | null {
  let current: string | null = path;
  for (const op of ops) {
    if (current === null) return null;
    if (op.type === 'rename' || op.type === 'move') {
      if (current === op.from || current.startsWith(`${op.from}/`))
        current = op.to + current.slice(op.from.length);
    } else if (op.type === 'delete') {
      if (current === op.path || current.startsWith(`${op.path}/`)) return null;
    }
  }
  return current;
}
