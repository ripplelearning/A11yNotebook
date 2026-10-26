// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import { cleanTaskLinks, type TaskLink } from '../shared/task-links';

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
});
