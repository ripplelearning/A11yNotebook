// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import { cleanTaskLinks, dropLinksForDeletedPath, dropMissingStableTaskLinks, migrateTaskLinks, type TaskLink } from '../shared/task-links';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = '';
});

const link = (overrides: Partial<TaskLink> = {}): TaskLink => ({
  id: 'link-1',
  taskId: 'Tasks.md:1',
  taskPath: 'Tasks.md',
  kind: 'note',
  target: 'Notes/Guide.md',
  ...overrides,
});

describe('cleanTaskLinks', () => {
  it('keeps well-formed links and drops invalid entries and exact duplicates', () => {
    expect(
      cleanTaskLinks([
        link(),
        link({ id: 'link-2', kind: 'file', target: 'Files/report.pdf' }),
        link({ id: 'link-3', kind: 'notebook', target: 'Work' }),
        link({ id: 'link-4', kind: 'note', target: 'Notes/Guide.md' }),
        link({ id: '', kind: 'note', target: 'Notes/Other.md' }),
        link({ id: 'link-5', kind: 'bogus' as never, target: 'Notes/Other.md' }),
        link({ id: 'link-6', kind: 'note', target: '' }),
        'not a link',
        null,
      ]),
    ).toEqual([
      link(),
      link({ id: 'link-2', kind: 'file', target: 'Files/report.pdf' }),
      link({ id: 'link-3', kind: 'notebook', target: 'Work' }),
    ]);
  });

  it('returns an empty list for non-list input', () => {
    expect(cleanTaskLinks(undefined)).toEqual([]);
    expect(cleanTaskLinks({ links: [link()] })).toEqual([]);
  });
});

describe('dropLinksForDeletedPath', () => {
  it('drops links in the deleted note and under a deleted notebook, and keeps the rest', () => {
    const links = [
      link({ id: 'a', taskPath: 'Note.md' }),
      link({ id: 'b', taskPath: 'Work/Note.md' }),
      link({ id: 'c', taskPath: 'Work2/Note.md' }),
      link({ id: 'd', taskPath: 'Other.md' }),
    ];
    expect(dropLinksForDeletedPath(links, 'Note.md')).toEqual([links[1], links[2], links[3]]);
    expect(dropLinksForDeletedPath(links, 'Work')).toEqual([links[0], links[2], links[3]]);
  });
});

describe('dropMissingStableTaskLinks', () => {
  it('drops only missing stable-id links in the saved note', () => {
    const links = [
      link({ id: 'a', taskId: 'Note.md#gone1234', taskPath: 'Note.md' }),
      link({ id: 'b', taskId: 'Note.md#kept1234', taskPath: 'Note.md' }),
      link({ id: 'c', taskId: 'Note.md:3', taskPath: 'Note.md' }),
      link({ id: 'd', taskId: 'Other.md#gone1234', taskPath: 'Other.md' }),
    ];
    expect(dropMissingStableTaskLinks(links, 'Note.md', new Set(['Note.md#kept1234']))).toEqual([
      links[1],
      links[2],
      links[3],
    ]);
  });
});

describe('migrateTaskLinks', () => {
  it('rewrites the task note and the target when either moves', () => {
    const links = [
      link({ id: 'a', taskId: 'Tasks.md#stable123', taskPath: 'Tasks.md', target: 'Notes/Guide.md' }),
      link({ id: 'b', taskId: 'Tasks.md:2', taskPath: 'Tasks.md', target: 'Tasks.md' }),
      link({ id: 'c', taskId: 'Other.md#stable123', taskPath: 'Other.md', target: 'Notes/Guide.md' }),
    ];
    expect(migrateTaskLinks(links, 'Tasks.md', 'Work/Tasks.md')).toEqual([
      link({ id: 'a', taskId: 'Work/Tasks.md#stable123', taskPath: 'Work/Tasks.md', target: 'Notes/Guide.md' }),
      link({ id: 'b', taskId: 'Work/Tasks.md:2', taskPath: 'Work/Tasks.md', target: 'Work/Tasks.md' }),
      link({ id: 'c', taskId: 'Other.md#stable123', taskPath: 'Other.md', target: 'Notes/Guide.md' }),
    ]);
    expect(migrateTaskLinks(links, 'Notes/Guide.md', 'Notes/Handbook.md')).toEqual([
      link({ id: 'a', taskId: 'Tasks.md#stable123', taskPath: 'Tasks.md', target: 'Notes/Handbook.md' }),
      link({ id: 'b', taskId: 'Tasks.md:2', taskPath: 'Tasks.md', target: 'Tasks.md' }),
      link({ id: 'c', taskId: 'Other.md#stable123', taskPath: 'Other.md', target: 'Notes/Handbook.md' }),
    ]);
  });

  it('follows whole-notebook moves on both ends and leaves unrelated links alone', () => {
    const links = [
      link({ id: 'a', taskId: 'Work/Tasks.md#stable123', taskPath: 'Work/Tasks.md', target: 'Work/Guide.md' }),
      link({ id: 'b', taskId: 'Other.md:1', taskPath: 'Other.md', target: 'Elsewhere.md' }),
    ];
    const migrated = migrateTaskLinks(links, 'Work', 'Archive/Work');
    expect(migrated).toEqual([
      link({
        id: 'a',
        taskId: 'Archive/Work/Tasks.md#stable123',
        taskPath: 'Archive/Work/Tasks.md',
        target: 'Archive/Work/Guide.md',
      }),
      links[1],
    ]);
    expect(migrateTaskLinks(links, 'Missing.md', 'Elsewhere.md')).toBe(links);
  });
});

describe('task link storage', () => {
  it('persists links and cleans them on save and read', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-task-links-'));
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    expect(await service.getTaskLinks()).toEqual([]);
    const saved = await service.saveTaskLinks([
      link(),
      link({ id: 'link-2', kind: 'notebook', target: 'Work' }),
      link({ id: '', kind: 'note', target: 'Notes/Other.md' }),
    ]);
    expect(saved).toEqual([
      link(),
      link({ id: 'link-2', kind: 'notebook', target: 'Work' }),
    ]);
    expect(await service.getTaskLinks()).toEqual(saved);
    expect(await service.saveTaskLinks([])).toEqual([]);
  });

  it('prunes stable-id links when a note save removes their task, and keeps line-number links', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-task-links-'));
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    await service.createNote(
      'Note.md',
      '- [ ] Stable task <!-- a11y-task-id:stable123 -->\n- [ ] Plain task\n',
    );
    await service.saveTaskLinks([
      link({ id: 'link-stable', taskId: 'Note.md#stable123', taskPath: 'Note.md' }),
      link({ id: 'link-line', taskId: 'Note.md:2', taskPath: 'Note.md' }),
      link({ id: 'link-other', taskId: 'Other.md#other123', taskPath: 'Other.md' }),
    ]);
    await service.saveNote('Note.md', '# Note\n\nNo tasks here.\n');
    expect(await service.getTaskLinks()).toEqual([
      link({ id: 'link-line', taskId: 'Note.md:2', taskPath: 'Note.md' }),
      link({ id: 'link-other', taskId: 'Other.md#other123', taskPath: 'Other.md' }),
    ]);
  });
});
