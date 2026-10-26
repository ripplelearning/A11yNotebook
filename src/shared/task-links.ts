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
