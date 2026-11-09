// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import { cleanTaskLinks, cleanDismissedTaskAutoLinks, dropLinksForDeletedPath, dropLinksToDeletedPath, dropLinksToMissingTargets, dropMissingStableTaskLinks, migrateTaskLinks, reconcileTaskAutoLinks, type TaskLink } from '../shared/task-links';

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

  it('keeps the auto marker on auto-links', () => {
    expect(cleanTaskLinks([link({ auto: true })])).toEqual([link({ auto: true })]);
    expect(cleanTaskLinks([link({ auto: false })])).toEqual([link()]);
  });
});

describe('cleanDismissedTaskAutoLinks', () => {
  it('keeps non-empty string ids, deduplicated', () => {
    expect(cleanDismissedTaskAutoLinks(['Tasks.md:1', '', 'Tasks.md:1', 7, null, 'Guide.md#abc'])).toEqual([
      'Tasks.md:1',
      'Guide.md#abc',
    ]);
    expect(cleanDismissedTaskAutoLinks(undefined)).toEqual([]);
  });
});

describe('reconcileTaskAutoLinks', () => {
  const tasks = [
    { id: 'Tasks.md:1', path: 'Tasks.md' },
    { id: 'Guide.md#stable123', path: 'Guide.md' },
  ];

  it('creates an auto-link from each task to its own note', () => {
    const result = reconcileTaskAutoLinks(tasks, [], []);
    expect(result.changed).toBe(true);
    expect(result.links).toHaveLength(2);
    expect(result.links[0]).toMatchObject({
      taskId: 'Tasks.md:1',
      taskPath: 'Tasks.md',
      kind: 'note',
      target: 'Tasks.md',
      auto: true,
    });
    expect(result.links[1]).toMatchObject({
      taskId: 'Guide.md#stable123',
      taskPath: 'Guide.md',
      kind: 'note',
      target: 'Guide.md',
      auto: true,
    });
  });

  it('does not duplicate a link a task already has to its own note', () => {
    const userLink = link({ id: 'link-user', taskId: 'Tasks.md:1', taskPath: 'Tasks.md', target: 'Tasks.md' });
    const autoLink = link({
      id: 'link-auto',
      taskId: 'Guide.md#stable123',
      taskPath: 'Guide.md',
      target: 'Guide.md',
      auto: true,
    });
    const result = reconcileTaskAutoLinks(tasks, [userLink, autoLink], []);
    expect(result.changed).toBe(false);
    expect(result.links).toEqual([userLink, autoLink]);
  });

  it('does not re-create an auto-link the user removed', () => {
    const result = reconcileTaskAutoLinks(tasks, [], ['Tasks.md:1']);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].taskId).toBe('Guide.md#stable123');
  });

  it('drops auto-links for tasks that are gone, and prunes their dismissed ids', () => {
    const staleAuto = link({
      id: 'link-stale',
      taskId: 'Tasks.md:2',
      taskPath: 'Tasks.md',
      target: 'Tasks.md',
      auto: true,
    });
    const userLink = link({ id: 'link-user', taskId: 'Tasks.md:2', taskPath: 'Tasks.md' });
    const result = reconcileTaskAutoLinks(
      [{ id: 'Tasks.md:1', path: 'Tasks.md' }],
      [staleAuto, userLink],
      ['Tasks.md:2'],
    );
    // The stale auto-link is gone (its task moved down a line); the user
    // link is never pruned here; the dismissed id for the gone task is
    // dropped so a later task reusing that line is not suppressed.
    expect(result.changed).toBe(true);
    expect(result.links).toEqual([userLink, expect.objectContaining({ taskId: 'Tasks.md:1', auto: true })]);
    expect(result.dismissed).toEqual([]);
  });

  it('reports no change when every task already links to its note', () => {
    const links = tasks.map((task, index) =>
      link({
        id: `link-${index}`,
        taskId: task.id,
        taskPath: task.path,
        target: task.path,
        auto: true,
      }),
    );
    expect(reconcileTaskAutoLinks(tasks, links, []).changed).toBe(false);
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

describe('dropLinksToDeletedPath', () => {
  it('drops links to the deleted note and under a deleted notebook, and keeps the rest', () => {
    const links = [
      link({ id: 'a', target: 'Note.md' }),
      link({ id: 'b', target: 'Work/Note.md' }),
      link({ id: 'c', target: 'Work2/Note.md' }),
      link({ id: 'd', target: 'Other.md' }),
    ];
    expect(dropLinksToDeletedPath(links, 'Note.md')).toEqual([links[1], links[2], links[3]]);
    expect(dropLinksToDeletedPath(links, 'Work')).toEqual([links[0], links[2], links[3]]);
  });
});

describe('dropLinksToMissingTargets', () => {
  it('drops links whose target is not among the current entries', () => {
    const links = [
      link({ id: 'a', target: 'Notes/Guide.md' }),
      link({ id: 'b', target: 'Notes/Gone.md' }),
      link({ id: 'c', kind: 'notebook', target: 'Work' }),
      link({ id: 'd', kind: 'notebook', target: 'Gone' }),
    ];
    expect(
      dropLinksToMissingTargets(links, new Set(['Notes/Guide.md', 'Work', 'Tasks.md'])),
    ).toEqual([links[0], links[2]]);
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

  it('persists dismissed auto-links, and saving links does not wipe them', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-task-links-'));
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    expect(await service.getDismissedTaskAutoLinks()).toEqual([]);
    expect(await service.saveDismissedTaskAutoLinks(['Tasks.md:1', 'Tasks.md:1', ''])).toEqual(['Tasks.md:1']);
    expect(await service.getDismissedTaskAutoLinks()).toEqual(['Tasks.md:1']);
    await service.saveTaskLinks([link()]);
    expect(await service.getDismissedTaskAutoLinks()).toEqual(['Tasks.md:1']);
    expect(await service.getTaskLinks()).toEqual([link()]);
    expect(await service.saveDismissedTaskAutoLinks([])).toEqual([]);
  });
});
