export type TaskLinkKind = 'note' | 'file' | 'notebook';

/**
 * A link from one task to a note, file, or notebook. taskId is the
 * VaultTask id (note path plus a stable marker, or note path plus line
 * number), so links survive task text edits but not note moves; taskPath
 * is kept alongside for filtering without parsing the id.
 */
export interface TaskLink {
  id: string;
  taskId: string;
  taskPath: string;
  kind: TaskLinkKind;
  target: string;
}

const KINDS: ReadonlySet<string> = new Set(['note', 'file', 'notebook']);

/** Keep only well-formed links, dropping invalid entries and exact duplicates. */
export function cleanTaskLinks(value: unknown): TaskLink[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: TaskLink[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const link = item as TaskLink;
    if (typeof link.id !== 'string' || !link.id) continue;
    if (typeof link.taskId !== 'string' || !link.taskId) continue;
    if (typeof link.taskPath !== 'string' || !link.taskPath) continue;
    if (typeof link.kind !== 'string' || !KINDS.has(link.kind)) continue;
    if (typeof link.target !== 'string' || !link.target) continue;
    const key = JSON.stringify([link.taskId, link.kind, link.target]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: link.id,
      taskId: link.taskId,
      taskPath: link.taskPath,
      kind: link.kind,
      target: link.target,
    });
  }
  return result;
}

/**
 * Drop links that point at tasks in a deleted note or notebook. A link
 * belongs to the deleted tree when its taskPath is the deleted path or
 * lives under it. Used when an entry is moved to the Recycle Bin.
 */
export function dropLinksForDeletedPath(links: TaskLink[], deletedPath: string): TaskLink[] {
  const prefix = `${deletedPath}/`;
  return links.filter((link) => link.taskPath !== deletedPath && !link.taskPath.startsWith(prefix));
}

/**
 * Drop links to stable-id tasks that no longer exist in the given note's
 * freshly saved content. Only `#stable-id` links are pruned: a
 * line-number link (`path:line`) cannot tell a deleted task from a task
 * that moved down a line, so those are kept.
 */
export function dropMissingStableTaskLinks(
  links: TaskLink[],
  notePath: string,
  presentTaskIds: ReadonlySet<string>,
): TaskLink[] {
  return links.filter((link) => {
    if (!link.taskId.startsWith(`${notePath}#`)) return true;
    return presentTaskIds.has(link.taskId);
  });
}
