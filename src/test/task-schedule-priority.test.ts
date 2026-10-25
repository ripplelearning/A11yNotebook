// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  parseHtmlTasks,
  parseMarkdownTasks,
  updateHtmlTaskPriority,
  updateHtmlTaskSchedule,
} from '../../electron/vault/tasks';
import { normalizePriorityOptions } from '../../src/shared/settings';

const HTML_NOTE =
  '<ul><li data-a11y-task-id="task-1234" data-a11y-task-complete="false" data-a11y-task-due="2026-10-05">Read chapter</li></ul>';

describe('task schedule and priority storage', () => {
  it('parses Markdown due times and custom priority names', () => {
    const [task] = parseMarkdownTasks(
      '- [ ] Read chapter due:2026-10-05 due-time:09:30 priority:Critical',
      'Class.md',
    );
    expect(task.dueDate).toBe('2026-10-05');
    expect(task.dueTime).toBe('09:30');
    expect(task.priority).toBe('critical');
    expect(task.text).toBe('Read chapter');
  });

  it('parses HTML due times and keeps legacy priority values', () => {
    const [task] = parseHtmlTasks(
      '<ul><li data-a11y-task-id="task-1234" data-a11y-task-complete="false" data-a11y-task-due="2026-10-05" data-a11y-task-due-time="09:30" data-a11y-task-priority="normal">Read chapter</li></ul>',
      'Class.html',
    );
    expect(task.dueTime).toBe('09:30');
    expect(task.priority).toBe('normal');
  });

  it('sets and clears an HTML task schedule without touching other bytes', () => {
    const updated = updateHtmlTaskSchedule(HTML_NOTE, 'task-1234', {
      dueDate: '2026-11-01',
      dueTime: '14:00',
      remindAt: '2026-10-31 09:00',
    });
    expect(updated).toContain('data-a11y-task-due="2026-11-01"');
    expect(updated).toContain('data-a11y-task-due-time="14:00"');
    expect(updated).toContain('data-a11y-task-remind="2026-10-31 09:00"');
    expect(updated).toContain('>Read chapter</li>');
    const cleared = updateHtmlTaskSchedule(updated, 'task-1234', { dueDate: '', dueTime: '', remindAt: '' });
    expect(cleared).not.toContain('data-a11y-task-due');
    expect(cleared).not.toContain('data-a11y-task-remind');
    expect(cleared).toContain('>Read chapter</li>');
  });

  it('rejects invalid schedule values', () => {
    expect(() =>
      updateHtmlTaskSchedule(HTML_NOTE, 'task-1234', { dueDate: '2026-02-30', dueTime: '', remindAt: '' }),
    ).toThrow();
    expect(() =>
      updateHtmlTaskSchedule(HTML_NOTE, 'task-1234', { dueDate: '', dueTime: '25:00', remindAt: '' }),
    ).toThrow();
  });

  it('sets and clears an HTML task priority', () => {
    const updated = updateHtmlTaskPriority(HTML_NOTE, 'task-1234', 'critical');
    expect(updated).toContain('data-a11y-task-priority="critical"');
    expect(updateHtmlTaskPriority(updated, 'task-1234', '')).not.toContain('data-a11y-task-priority');
    expect(() => updateHtmlTaskPriority(HTML_NOTE, 'task-1234', 'very high')).toThrow();
  });
});

describe('priority option lists', () => {
  it('defaults, dedupes, and drops multi-word names', () => {
    expect(normalizePriorityOptions(undefined)).toEqual(['critical', 'high', 'medium', 'low', 'optional']);
    expect(normalizePriorityOptions(['High', 'high', 'very high', 'Soon', ''])).toEqual(['high', 'soon']);
    expect(normalizePriorityOptions(['very high'])).toEqual(['critical', 'high', 'medium', 'low', 'optional']);
  });
});
