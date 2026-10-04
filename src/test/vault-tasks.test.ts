// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultService } from '../../electron/vault/service';
import { parseHtmlTasks, parseMarkdownTasks, toggleHtmlTask } from '../../electron/vault/tasks';

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

  describe('HTML checklist tasks', () => {
    const task =
      '<li data-a11y-task-id="task-1234" data-a11y-task-complete="false" data-a11y-task-due="2026-10-05" data-a11y-task-priority="high"><strong>Read</strong> chapter</li>';

    it('indexes stable identity, completion, due date, priority, and revision', () => {
      expect(parseHtmlTasks(`<h2>Reading</h2><ul>${task}</ul>`, 'Reading.html')).toMatchObject([
        {
          id: 'Reading.html#task-1234',
          taskId: 'task-1234',
          htmlTask: true,
          path: 'Reading.html',
          text: 'Read chapter',
          complete: false,
          dueDate: '2026-10-05',
          priority: 'high',
          revision: expect.stringMatching(/^[\da-f]{64}$/),
        },
      ]);
    });

    it('toggles only the completion attribute and ignores duplicate task identities', () => {
      const source = `<article><h2>Keep</h2><ul>${task}</ul><p>Also keep</p></article>`;
      const toggled = toggleHtmlTask(source, 'task-1234', true);
      expect(toggled).toBe(source.replace('data-a11y-task-complete="false"', 'data-a11y-task-complete="true"'));
      expect(parseHtmlTasks(`<ul>${task}${task}</ul>`, 'Reading.html')).toEqual([]);
      expect(() => toggleHtmlTask(`<ul>${task}${task}</ul>`, 'task-1234', true)).toThrow(/ambiguous/);
    });

    it('rejects stale revisions rather than toggling an externally changed note', async () => {
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-html-tasks-'));
      const service = createVaultService(temporaryDirectory);
      await service.initialize();
      await service.createNote('Reading.html', `<article><h2>Keep</h2><ul>${task}</ul><p>Original</p></article>`);
      const [indexed] = await service.getTasks();
      await service.saveNote('Reading.html', `<article><h2>Keep</h2><ul>${task}</ul><p>External edit</p></article>`);
      await expect(service.toggleTask('Reading.html', indexed.taskId!, true, indexed.revision)).rejects.toThrow(
        /changed on disk/,
      );
      expect(await service.readNote('Reading.html')).toContain('External edit');
    });

    it('updates an HTML task due date by stable identity without reserializing surrounding source', async () => {
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'a11y-html-task-date-'));
      const service = createVaultService(temporaryDirectory);
      await service.initialize();
      const original = `<article><h2>Keep</h2><ul>${task}</ul><p>Same bytes</p></article>`;
      await service.createNote('Reading.html', original);
      const [indexed] = await service.getTasks();
      const updated = await service.setHtmlTaskDueDate(
        'Reading.html',
        indexed.taskId!,
        '2026-10-06',
        indexed.revision!,
      );
      expect(updated[0].dueDate).toBe('2026-10-06');
      expect(await service.readNote('Reading.html')).toBe(
        original.replace('data-a11y-task-due="2026-10-05"', 'data-a11y-task-due="2026-10-06"'),
      );
      await expect(
        service.setHtmlTaskDueDate('Reading.html', indexed.taskId!, '2026-02-30', updated[0].revision!),
      ).rejects.toThrow(/real date/);
    });
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
