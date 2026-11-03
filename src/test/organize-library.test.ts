import { describe, expect, it } from 'vitest';
import type { VaultEntry } from '../shared/types';
import {
  baseName,
  cloneEntries,
  copyNode,
  deleteNode,
  draftPathToLivePath,
  findEntryInTree,
  findProtectionBlockInTree,
  nonCollidingCopyName,
  parentPath,
  previousNextNotebook,
  relocateNode,
  remapPathAfterOps,
  setProtectedFlag,
  validateStageDelete,
  validateStageRelocate,
} from '../renderer/features/vault/organize-library';

function fixture(): VaultEntry[] {
  return [
    {
      name: 'Work',
      path: 'Work',
      kind: 'notebook',
      children: [
        { name: 'Guide.md', path: 'Work/Guide.md', kind: 'note' },
        { name: 'Tasks.md', path: 'Work/Tasks.md', kind: 'note', protected: true },
      ],
    },
    {
      name: 'Archive',
      path: 'Archive',
      kind: 'notebook',
      children: [{ name: 'Old.md', path: 'Archive/Old.md', kind: 'note' }],
    },
    { name: 'Top.md', path: 'Top.md', kind: 'note' },
  ];
}

describe('organize-library helpers', () => {
  it('relocates a note into another notebook and rewrites descendant paths', () => {
    const next = relocateNode(fixture(), 'Work/Guide.md', 'Archive/Guide.md');
    expect(findEntryInTree(next, 'Archive/Guide.md')?.name).toBe('Guide.md');
    expect(findEntryInTree(next, 'Work/Guide.md')).toBeUndefined();
    expect(findEntryInTree(next, 'Work/Tasks.md')).toBeDefined();
  });

  it('relocates a notebook with its whole subtree and keeps tree order sorted', () => {
    const next = relocateNode(fixture(), 'Work', 'Archive/Work');
    expect(findEntryInTree(next, 'Archive/Work/Guide.md')).toBeDefined();
    expect(findEntryInTree(next, 'Work')).toBeUndefined();
    const archive = findEntryInTree(next, 'Archive');
    expect(archive?.children?.map((child) => child.name)).toEqual(['Old.md', 'Work']);
  });

  it('deletes a subtree and leaves siblings alone', () => {
    const next = deleteNode(fixture(), 'Work');
    expect(findEntryInTree(next, 'Work')).toBeUndefined();
    expect(findEntryInTree(next, 'Archive/Old.md')).toBeDefined();
    expect(findEntryInTree(next, 'Top.md')).toBeDefined();
  });

  it('copies a subtree without carrying protection flags', () => {
    const next = copyNode(fixture(), 'Work', 'Work-copy');
    const copy = findEntryInTree(next, 'Work-copy');
    expect(copy?.children?.map((child) => child.name)).toEqual(['Guide.md', 'Tasks.md']);
    expect(findEntryInTree(next, 'Work-copy/Tasks.md')?.protected).toBeUndefined();
    expect(findEntryInTree(next, 'Work/Tasks.md')?.protected).toBe(true);
  });

  it('sets and clears a protection flag without touching siblings', () => {
    const flagged = setProtectedFlag(fixture(), 'Top.md', true);
    expect(findEntryInTree(flagged, 'Top.md')?.protected).toBe(true);
    const cleared = setProtectedFlag(flagged, 'Top.md', false);
    expect(findEntryInTree(cleared, 'Top.md')?.protected).toBeUndefined();
  });

  it('finds a protection block on the item itself or its first protected descendant', () => {
    const entries = fixture();
    expect(findProtectionBlockInTree(entries, 'Work/Tasks.md')?.path).toBe('Work/Tasks.md');
    expect(findProtectionBlockInTree(entries, 'Work')?.path).toBe('Work/Tasks.md');
    expect(findProtectionBlockInTree(entries, 'Archive')).toBeNull();
    expect(findProtectionBlockInTree(entries, 'Missing.md')).toBeNull();
  });

  it('validates staged relocates: missing, same path, self-move, descendant move, collision, protected', () => {
    const entries = fixture();
    expect(validateStageRelocate(entries, 'Missing.md', 'Archive/Missing.md').kind).toBe('error');
    expect(validateStageRelocate(entries, 'Top.md', 'Top.md').kind).toBe('error');
    expect(validateStageRelocate(entries, 'Work', 'Work/Work').kind).toBe('error');
    expect(validateStageRelocate(entries, 'Archive', 'Archive/Old.md').kind).toBe('error');
    expect(validateStageRelocate(entries, 'Top.md', 'Archive/Old.md').kind).toBe('error');
    expect(validateStageRelocate(entries, 'Top.md', 'Archive/Top.md').kind).toBe('ok');
    const blocked = validateStageRelocate(entries, 'Work', 'Archive/Work');
    expect(blocked.kind).toBe('protected');
    if (blocked.kind === 'protected') expect(blocked.block.path).toBe('Work/Tasks.md');
  });

  it('validates staged deletes: missing and protected', () => {
    const entries = fixture();
    expect(validateStageDelete(entries, 'Missing.md').kind).toBe('error');
    expect(validateStageDelete(entries, 'Top.md').kind).toBe('ok');
    const blocked = validateStageDelete(entries, 'Work');
    expect(blocked.kind).toBe('protected');
  });

  it('picks the previous and next notebooks, excluding the current parent, self, and descendants', () => {
    const entries = fixture();
    // Top.md sits at root: both notebooks count, Archive is the nearest before it.
    expect(previousNextNotebook(entries, 'Top.md')).toEqual({
      previous: expect.objectContaining({ path: 'Archive' }),
      next: null,
    });
    // Guide.md lives in Work, so Work is excluded: Archive is next, nothing before.
    expect(previousNextNotebook(entries, 'Work/Guide.md')).toEqual({
      previous: null,
      next: expect.objectContaining({ path: 'Archive' }),
    });
    // A notebook never lists itself or its descendants as a destination.
    expect(previousNextNotebook(entries, 'Work')).toEqual({
      previous: null,
      next: expect.objectContaining({ path: 'Archive' }),
    });
    // Old.md lives in Archive, so Archive is excluded: Work is previous.
    expect(previousNextNotebook(entries, 'Archive/Old.md')).toEqual({
      previous: expect.objectContaining({ path: 'Work' }),
      next: null,
    });
  });

  it('names copies without colliding, with and without an extension', () => {
    const entries = fixture();
    expect(nonCollidingCopyName(entries, 'Archive', 'Old.md')).toBe('Old copy.md');
    const withCopy = copyNode(entries, 'Archive/Old.md', 'Archive/Old copy.md');
    expect(nonCollidingCopyName(withCopy, 'Archive', 'Old.md')).toBe('Old copy 2.md');
    expect(nonCollidingCopyName(entries, '', 'Work')).toBe('Work copy');
  });

  it('maps draft paths back to live paths and reports staged copies as not yet created', () => {
    const ops = [
      { type: 'rename' as const, from: 'Work/Guide.md', to: 'Work/Guide2.md' },
      { type: 'move' as const, from: 'Top.md', to: 'Archive/Top.md' },
      { type: 'copy' as const, from: 'Archive/Old.md', to: 'Archive/Old copy.md' },
    ];
    expect(draftPathToLivePath('Work/Guide2.md', ops)).toBe('Work/Guide.md');
    expect(draftPathToLivePath('Archive/Top.md', ops)).toBe('Top.md');
    expect(draftPathToLivePath('Archive/Old copy.md', ops)).toBeNull();
    expect(draftPathToLivePath('Archive/Old.md', ops)).toBe('Archive/Old.md');
  });

  it('remaps paths after ops, drops deleted paths, and is idempotent', () => {
    const ops = [
      { type: 'move' as const, from: 'Work', to: 'Archive/Work' },
      { type: 'delete' as const, path: 'Top.md', permanent: false },
      { type: 'copy' as const, from: 'Archive/Old.md', to: 'Archive/Old copy.md' },
    ];
    expect(remapPathAfterOps('Work/Guide.md', ops)).toBe('Archive/Work/Guide.md');
    expect(remapPathAfterOps('Top.md', ops)).toBeNull();
    expect(remapPathAfterOps('Archive/Old.md', ops)).toBe('Archive/Old.md');
    const once = remapPathAfterOps('Work/Guide.md', ops);
    expect(once && remapPathAfterOps(once, ops)).toBe(once);
  });

  it('clones entries deeply and exposes parent and base names', () => {
    const entries = fixture();
    const cloned = cloneEntries(entries);
    cloned[0].children![0].name = 'Changed.md';
    expect(entries[0].children![0].name).toBe('Guide.md');
    expect(parentPath('Work/Guide.md')).toBe('Work');
    expect(parentPath('Top.md')).toBe('');
    expect(baseName('Work/Guide.md')).toBe('Guide.md');
  });
});
