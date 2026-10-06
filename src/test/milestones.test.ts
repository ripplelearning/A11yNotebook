// @vitest-environment node
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMetadataStore } from '../../electron/vault/metadata';
import { createMilestoneStore, validateMilestoneStore } from '../../electron/vault/milestones';
import { createVaultService } from '../../electron/vault/service';
import type { NewMilestone } from '../shared/milestones';

let temporary = '';
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

const input: NewMilestone = { title: 'Project', dueDate: '2026-10-10', status: 'active' };
async function fixture() {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'a11y-milestones-'));
  const vault = createVaultService(temporary);
  await vault.initialize();
  await vault.createFolder('Study');
  await vault.createNote('Study/Plan.md', '- [ ] First\r\n- [x] Second\r\n');
  await vault.createNote(
    'Study/Plan.html',
    '<li data-a11y-task-id="html-task-1234" data-a11y-task-complete="true">HTML task</li>',
  );
  const metadata = createMetadataStore(vault);
  const options = {
    readStore: () => metadata.read('milestones.json'),
    writeStore: vi.fn((value: unknown) => metadata.write('milestones.json', value)),
    getTasks: () => vault.getTasks(),
    readNote: (relative: string) => vault.readNote(relative),
    saveNote: (relative: string, content: string, expected: string) => vault.saveNote(relative, content, expected),
    validateNote: async (relative: string) => {
      await vault.readNote(relative);
    },
  };
  return { vault, metadata, options, service: createMilestoneStore(options) };
}

describe('milestone persistence and identity', () => {
  it('creates, updates, reopens and deletes milestones without changing IDs or creation time', async () => {
    const f = await fixture();
    const created = await f.service.createMilestone({ ...input, title: ' Project ', notePaths: ['Study/Plan.md'] });
    expect(created).toMatchObject({ title: 'Project', progress: { total: 0, percentage: 0 } });
    const updated = await f.service.updateMilestone(created.id, { title: 'Renamed', status: 'completed' });
    expect(updated).toMatchObject({ id: created.id, createdAt: created.createdAt, title: 'Renamed' });
    const reopened = createMilestoneStore(f.options);
    expect(await reopened.getMilestones()).toEqual([updated]);
    await reopened.deleteMilestone(created.id);
    expect(await createMilestoneStore(f.options).getMilestones()).toEqual([]);
    await expect(reopened.updateMilestone(created.id, { title: 'Missing' })).rejects.toThrow('no longer exists');
    await expect(reopened.deleteMilestone(created.id)).rejects.toThrow('no longer exists');
  });

  it('assigns Markdown identities, preserves HTML IDs, and calculates live progress', async () => {
    const f = await fixture();
    const tasks = await f.vault.getTasks();
    const created = await f.service.createMilestone({
      ...input,
      tasks: tasks.map((task) => ({ path: task.path, taskId: task.taskId ?? task.id })),
    });
    expect(created.progress).toEqual({
      total: 3,
      completed: 2,
      missing: 0,
      percentage: 67,
      summary: '2 of 3 tasks complete',
    });
    expect(created.tasks.find((task) => task.path.endsWith('.html'))?.taskId).toBe('html-task-1234');
    const anchored = await f.vault.readNote('Study/Plan.md');
    expect(anchored.match(/a11y-task-id:/g)).toHaveLength(2);
    expect(anchored.split('\r\n')).toHaveLength(3);
    await f.vault.saveNote('Study/Plan.md', `# New heading\r\n${anchored.replace('[ ] First', '[x] Edited')}`);
    const [updated] = await f.service.getMilestones();
    expect(updated.tasks).toEqual(created.tasks);
    expect(updated.progress).toMatchObject({ completed: 3, percentage: 100 });
    expect(await f.vault.readNote('Study/Plan.html')).not.toContain('a11y-task-id:');
  });

  it('preserves milestone/task identities across notebook moves and missing notes', async () => {
    const f = await fixture();
    const [task] = (await f.vault.getTasks()).filter((item) => item.path.endsWith('.md'));
    const created = await f.service.createMilestone({
      ...input,
      notePaths: ['Study/Plan.md'],
      tasks: [{ path: task.path, taskId: task.id }],
    });
    await f.vault.moveEntry('Study', 'Archive');
    await f.service.migratePaths('Study', 'Archive');
    const [moved] = await f.service.getMilestones();
    expect(moved).toMatchObject({ id: created.id, notePaths: ['Archive/Plan.md'] });
    expect(moved.tasks).toEqual([{ path: 'Archive/Plan.md', taskId: created.tasks[0].taskId }]);
    await unlink(path.join(temporary, 'Archive', 'Plan.md'));
    const missing = await f.service.updateMilestone(created.id, { title: 'Still associated' });
    expect(missing.tasks).toEqual(moved.tasks);
    expect(missing.progress).toMatchObject({ total: 1, completed: 0, missing: 1 });
  });

  it('serializes concurrent writes and retains state when persistence fails', async () => {
    const f = await fixture();
    const created = await Promise.all([f.service.createMilestone(input), f.service.createMilestone(input)]);
    expect(new Set(created.map((item) => item.id)).size).toBe(2);
    f.options.writeStore.mockRejectedValueOnce(new Error('Disk full'));
    await expect(f.service.updateMilestone(created[0].id, { title: 'Not saved' })).rejects.toThrow('Disk full');
    expect((await f.service.getMilestones())[0].title).toBe('Project');
  });

  it('rejects malformed metadata, unsafe paths, invalid dates, and duplicate associations', async () => {
    const f = await fixture();
    expect(validateMilestoneStore(null)).toEqual({ version: 1, milestones: [] });
    expect(() => validateMilestoneStore({ version: 2, milestones: [] })).toThrow();
    const created = await f.service.createMilestone(input);
    expect(() => validateMilestoneStore({ version: 1, milestones: [created, created] })).toThrow();
    for (const change of [
      { title: '' },
      { dueDate: '2026-02-30' },
      { status: 'invalid' },
      { notePaths: ['../outside.md'] },
      { notePaths: ['.a11ynotebook/data.md'] },
      { tasks: [{ path: 'Study/Plan.md', taskId: 'missing-task' }] },
    ]) {
      await expect(f.service.createMilestone({ ...input, ...change } as NewMilestone)).rejects.toThrow();
    }
    const [task] = await f.vault.getTasks();
    const reference = { path: task.path, taskId: task.taskId ?? task.id };
    await expect(f.service.createMilestone({ ...input, tasks: [reference, reference] })).rejects.toThrow('once');
    await expect(f.service.migratePaths('../Study', 'Archive')).rejects.toThrow();
  });

  it('rejects duplicate stable identities and never counts ambiguous tasks as completed', async () => {
    const f = await fixture();
    const source = '- [x] Original <!-- a11y-task-id:stable-task-1234 -->';
    await f.vault.saveNote('Study/Plan.md', source);
    const reference = { path: 'Study/Plan.md', taskId: 'stable-task-1234' };
    const created = await f.service.createMilestone({ ...input, tasks: [reference] });
    expect(created.progress.completed).toBe(1);
    await expect(
      f.service.createMilestone({
        ...input,
        tasks: [reference, { ...reference, taskId: 'Study/Plan.md#stable-task-1234' }],
      }),
    ).rejects.toThrow('once');
    await f.vault.saveNote('Study/Plan.md', `${source}\n${source}`);
    await expect(f.service.createMilestone({ ...input, tasks: [reference] })).rejects.toThrow('ambiguous');
    expect((await f.service.getMilestones())[0].progress).toMatchObject({
      total: 1,
      completed: 0,
      missing: 1,
      percentage: 0,
    });
  });

  it('refuses to assign an identity after a task changes at its source line', async () => {
    const f = await fixture();
    const [task] = (await f.vault.getTasks()).filter((item) => item.path.endsWith('.md'));
    const service = createMilestoneStore({
      ...f.options,
      getTasks: async () => [task],
      readNote: async () => '- [ ] Replacement',
    });
    await expect(service.createMilestone({ ...input, tasks: [{ path: task.path, taskId: task.id }] })).rejects.toThrow(
      'task changed',
    );
    expect(await f.vault.readNote(task.path)).not.toContain('a11y-task-id');
  });
});
