export type TaskLinkKind = 'note' | 'file' | 'notebook';

/**
 * A link from one task to a note, file, or notebook. taskId is the
 * VaultTask id (note path plus a stable marker, or note path plus line
 * number), so links survive task text edits; taskPath is kept alongside
 * for filtering without parsing the id. Both ends follow moves: when a
 * note or notebook moves, migrateTaskLinks rewrites the task's own note
 * and the link target to the new paths.
 *
 * `auto` marks the link the app creates itself from a task to its own
 * note: every task links to the note it lives in unless the user removed
 * that link. Auto-links are reconciled on refresh (see
 * reconcileTaskAutoLinks) and are removable like any other link.
 */
export interface TaskLink {
  id: string;
  taskId: string;
  taskPath: string;
  kind: TaskLinkKind;
  target: string;
  auto?: boolean;
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
      ...(link.auto === true ? { auto: true } : {}),
    });
  }
  return result;
}

/** Keep only well-formed dismissed auto-link ids: non-empty strings, deduplicated. */
export function cleanDismissedTaskAutoLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/**
 * Reconcile the auto-links that tie every task to the note it lives in.
 * For each current task, a link to its own note must exist — an existing
 * link to that note (auto or added by hand) satisfies it — unless the
 * user removed the task's auto-link, which `dismissed` records. Auto-links
 * whose task is gone are dropped, so a task that moved down a line (and
 * so changed its `path:line` id) gets a fresh link at its new line
 * instead of leaving a stale one behind; user links are never pruned
 * here. Dismissed ids for tasks that no longer exist are dropped too, so
 * a later task reusing a line number is not wrongly suppressed.
 * Returns the reconciled links and dismissed list, and whether either
 * changed — callers write back only when something changed.
 */
export function reconcileTaskAutoLinks(
  tasks: readonly { id: string; path: string }[],
  links: readonly TaskLink[],
  dismissed: readonly string[],
): { links: TaskLink[]; dismissed: string[]; changed: boolean } {
  const present = new Set(tasks.map((task) => task.id));
  const keptDismissed = dismissed.filter((id) => present.has(id));
  const dismissedSet = new Set(keptDismissed);
  const kept = links.filter((link) => !link.auto || present.has(link.taskId));
  const linkedToOwnNote = new Set(
    kept
      .filter((link) => link.kind === 'note' && link.target === link.taskPath)
      .map((link) => link.taskId),
  );
  const added: TaskLink[] = [];
  for (const task of tasks) {
    if (linkedToOwnNote.has(task.id) || dismissedSet.has(task.id)) continue;
    added.push({
      id: `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id,
      taskPath: task.path,
      kind: 'note',
      target: task.path,
      auto: true,
    });
  }
  const nextLinks = added.length ? [...kept, ...added] : kept;
  const changed = added.length > 0 || nextLinks.length !== links.length || keptDismissed.length !== dismissed.length;
  return { links: nextLinks, dismissed: keptDismissed, changed };
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
 * Drop links whose target is a deleted note, file, or notebook. A link
 * points at the deleted tree when its target is the deleted path or lives
 * under it. Used alongside dropLinksForDeletedPath when an entry is
 * deleted, so tasks stop showing links to notes that no longer exist.
 */
export function dropLinksToDeletedPath(links: TaskLink[], deletedPath: string): TaskLink[] {
  const prefix = `${deletedPath}/`;
  return links.filter((link) => link.target !== deletedPath && !link.target.startsWith(prefix));
}

/**
 * Drop links whose target is not among the library's current entries.
 * Used when refreshing task links, so links to notes deleted outside the
 * app (or before this cleanup existed) disappear instead of lingering
 * as dead links. A target counts as present only by exact path match:
 * every note, file, and notebook is itself an entry.
 */
export function dropLinksToMissingTargets(links: TaskLink[], existingPaths: ReadonlySet<string>): TaskLink[] {
  return links.filter((link) => existingPaths.has(link.target));
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
