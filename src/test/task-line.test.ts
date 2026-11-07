// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseTaskReminders } from '../../electron/vault/reminders';
import { updateMarkdownTaskLine } from '../shared/task-line';

const LINE_WITH_ID = '- [ ] Read chapter <!-- a11y-task-id:task-1234abcd -->';
const LINE_WITHOUT_ID = '- [ ] Read chapter';

describe('updateMarkdownTaskLine', () => {
  it('places schedule markers before the id comment so the stable id survives', () => {
    const updated = updateMarkdownTaskLine(LINE_WITH_ID, {
      schedule: { dueDate: '2026-11-07', dueTime: '09:30', remindAt: '2026-11-06 08:00' },
    });
    expect(updated).toBe(
      '- [ ] Read chapter due:2026-11-07 due-time:09:30 remind:2026-11-06 08:00 <!-- a11y-task-id:task-1234abcd -->',
    );
    const [parsed] = parseTaskReminders(updated, 'Class.md');
    expect(parsed.id).toBe(`task:Class.md:md:task-1234abcd:${new Date(2026, 10, 6, 8, 0).toISOString()}`);
  });

  it('places priority markers before the id comment', () => {
    const updated = updateMarkdownTaskLine(LINE_WITH_ID, { priority: 'high' });
    expect(updated).toBe('- [ ] Read chapter priority:high <!-- a11y-task-id:task-1234abcd -->');
  });

  it('appends markers at the end when there is no id comment', () => {
    const updated = updateMarkdownTaskLine(LINE_WITHOUT_ID, {
      schedule: { dueDate: '2026-11-07', dueTime: '', remindAt: '' },
    });
    expect(updated).toBe('- [ ] Read chapter due:2026-11-07');
  });

  it('replaces existing markers instead of duplicating them', () => {
    const withMarkers = updateMarkdownTaskLine(LINE_WITH_ID, {
      schedule: { dueDate: '2026-11-07', dueTime: '09:30', remindAt: '2026-11-06 08:00' },
    });
    const replaced = updateMarkdownTaskLine(withMarkers, {
      schedule: { dueDate: '2026-11-08', dueTime: '', remindAt: '' },
    });
    expect(replaced).toBe('- [ ] Read chapter due:2026-11-08 <!-- a11y-task-id:task-1234abcd -->');
    expect(replaced).not.toContain('remind:');
  });

  it('clears the priority without moving the id comment', () => {
    const withPriority = updateMarkdownTaskLine(LINE_WITH_ID, { priority: 'high' });
    expect(updateMarkdownTaskLine(withPriority, { priority: '' })).toBe(LINE_WITH_ID);
  });
});
