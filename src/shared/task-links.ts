export type TaskLinkKind = 'note' | 'file' | 'notebook';

/**
 * A link from one task to a note, file, or notebook. taskId is the
 * VaultTask id (note path plus a stable marker, or note path plus line
 * number), so links survive task text edits; taskPath is kept alongside
 * for filtering without parsing the id. Both ends follow moves: when a
 * note or notebook moves, migrateTaskLinks rewrites the task's own note
 * and the link target to the new paths.
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

function rewriteMovedPath(value: string, source: string, destination: string): string {
  return value === source || value.startsWith(`${source}/`) ? destination + value.slice(source.length) : value;
}

function rewriteMovedTaskId(taskId: string, oldTaskPath: string, newTaskPath: string): string {
  if (taskId.startsWith(`${oldTaskPath}#`)) return `${newTaskPath}#${taskId.slice(oldTaskPath.length + 1)}`;
  if (taskId.startsWith(`${oldTaskPath}:`)) return `${newTaskPath}:${taskId.slice(oldTaskPath.length + 1)}`;
  return taskId;
}

/**
 * Rewrite links for a move of a note, file, or notebook: the task's own
 * note (taskPath and the path prefix of taskId) and the link target both
 * follow the moved path, so a task keeps its links when its note moves
 * and keeps pointing at a target that moved. Returns the input unchanged
 * when no link mentions the moved path.
 */
export function migrateTaskLinks(links: TaskLink[], source: string, destination: string): TaskLink[] {
  let changed = false;
  const migrated = links.map((link) => {
    const taskPath = rewriteMovedPath(link.taskPath, source, destination);
    const taskId = rewriteMovedTaskId(link.taskId, link.taskPath, taskPath);
    const target = rewriteMovedPath(link.target, source, destination);
    if (taskPath !== link.taskPath || taskId !== link.taskId || target !== link.target) changed = true;
    return taskPath === link.taskPath && taskId === link.taskId && target === link.target
      ? link
      : { ...link, taskId, taskPath, target };
  });
  return changed ? cleanTaskLinks(migrated) : links;
}
