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

  it('parses a reminder time into remindAt, like the HTML task shape', () => {
    expect(
      parseMarkdownTasks('- [ ] Call back due:2026-11-01 priority:normal remind:2026-11-01 09:00', 'Class.md'),
    ).toEqual([
      {
        id: 'Class.md:1',
        path: 'Class.md',
        line: 1,
        text: 'Call back',
        complete: false,
        dueDate: '2026-11-01',
        priority: 'normal',
        remindAt: '2026-11-01 09:00',
      },
    ]);
  });

  it('accepts MM/DD/YYYY dates as the guide documents them, storing YYYY-MM-DD', () => {
    expect(
      parseMarkdownTasks(
        '- [ ] Read chapter due:10/05/2026 priority:high\n- [x] Submit 📅 10/06/2026\n- [ ] Call back remind:10/04/2026 09:30',
        'Class.md',
      ),
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
      { id: 'Class.md:2', path: 'Class.md', line: 2, text: 'Submit', complete: true, dueDate: '2026-10-06' },
      { id: 'Class.md:3', path: 'Class.md', line: 3, text: 'Call back', complete: false, remindAt: '2026-10-04 09:30' },
    ]);
    // One-digit month and day are the same date; impossible dates are not.
    expect(parseMarkdownTasks('- [ ] Read due:2/29/2028', 'Class.md')).toMatchObject([{ dueDate: '2028-02-29' }]);
    expect(parseMarkdownTasks('- [ ] Read due:2/29/2026', 'Class.md')).toMatchObject([{ text: 'Read due:2/29/2026' }]);
    expect(parseMarkdownTasks('- [ ] Read due:13/01/2026', 'Class.md')).toMatchObject([
      { text: 'Read due:13/01/2026' },
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

    it('strips stored markers from the visible text, like Markdown tasks', () => {
      const marked =
        '<li data-a11y-task-id="task-1234" data-a11y-task-complete="false" data-a11y-task-due="2026-10-05" data-a11y-task-priority="high" data-a11y-task-remind="2026-10-05 09:30">Call the dentist remind:2026-10-05 09:30 due:2026-10-05 priority:high</li>';
      expect(parseHtmlTasks(`<ul>${marked}</ul>`, 'Reading.html')).toMatchObject([
        {
          text: 'Call the dentist',
          dueDate: '2026-10-05',
          priority: 'high',
          remindAt: '2026-10-05 09:30',
        },
      ]);
    });

    it('accepts MM/DD/YYYY dates in data attributes, storing YYYY-MM-DD', () => {
      const marked =
        '<li data-a11y-task-id="task-1234" data-a11y-task-complete="false" data-a11y-task-due="10/05/2026" data-a11y-task-remind="10/05/2026 09:30">Call the dentist</li>';
      expect(parseHtmlTasks(`<ul>${marked}</ul>`, 'Reading.html')).toMatchObject([
        {
          text: 'Call the dentist',
          dueDate: '2026-10-05',
          remindAt: '2026-10-05 09:30',
        },
      ]);
      const invalid =
        '<li data-a11y-task-id="task-1234" data-a11y-task-complete="false" data-a11y-task-due="02/29/2026">Call the dentist</li>';
      expect(parseHtmlTasks(`<ul>${invalid}</ul>`, 'Reading.html')).toMatchObject([{ text: 'Call the dentist' }]);
      expect(parseHtmlTasks(`<ul>${invalid}</ul>`, 'Reading.html')[0]).not.toHaveProperty('dueDate');
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
