// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import { parseMarkdownTasks } from '../../electron/vault/tasks';

let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('Markdown task indexing', () => {
  it('parses checkboxes, due dates, priorities, and source line numbers', () => {
    expect(
      parseMarkdownTasks('- [ ] Read chapter due:2026-10-05 priority:high\n- [x] Submit 📅 2026-10-06', 'Class.md'),
    ).toEqual([
      {
        id: 'Class.md:1',
        path: 'Class.md',
        line: 1,
        text: 'Read chapter',
        complete: false,
        dueDate: '2026-10-05',
        priority: 'high',
      },
      {
        id: 'Class.md:2',
        path: 'Class.md',
        line: 2,
        text: 'Submit',
        complete: true,
        dueDate: '2026-10-06',
      },
    ]);
  });

  it('updates a checkbox in its Markdown source and reindexes the task', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-tasks-'));
    const service = createVaultService(temporaryDirectory);
    await service.initialize();
    await service.createNote('Tasks.md');
    await service.saveNote('Tasks.md', '# Plan\n\n- [ ] First task\n');
    const tasks = await service.getTasks();
    expect(tasks[0]).toMatchObject({ path: 'Tasks.md', line: 3, text: 'First task', complete: false });
    expect(await service.toggleTask('Tasks.md', 3, true)).toMatchObject([
      { path: 'Tasks.md', line: 3, text: 'First task', complete: true },
    ]);
  });
});
