import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { render } from '@testing-library/react';
import React from 'react';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import AppointmentDialog from '../renderer/features/calendar/AppointmentDialog';
import CalendarScreen from '../renderer/features/calendar/CalendarScreen';
import NewTaskDialog from '../renderer/features/reminders/NewTaskDialog';
import TaskScheduleDialog from '../renderer/features/reminders/TaskScheduleDialog';
import TaskPriorityDialog from '../renderer/features/reminders/TaskPriorityDialog';
import TaskLinkDialog from '../renderer/features/reminders/TaskLinkDialog';
import ReminderAlertDialog from '../renderer/features/reminders/ReminderAlertDialog';
import CreateReminderDialog from '../renderer/features/reminders/CreateReminderDialog';
import SpellingDialog from '../renderer/features/vault/SpellingDialog';
import ThesaurusDialog from '../renderer/features/vault/ThesaurusDialog';
import CitationDialog from '../renderer/features/vault/CitationDialog';
import ExportNoteDialog from '../renderer/features/vault/ExportNoteDialog';
import ConflictDialog from '../renderer/features/vault/ConflictDialog';
import NoteMetadataDialog from '../renderer/components/NoteMetadataDialog';
import { KeyboardShortcutsDialog } from '../renderer/components/HelpDialogs';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { VaultTask } from '../shared/types';
import type { Reminder } from '../shared/reminders';

/**
 * Accessibility audit harness (WCAG 2.2 AA).
 *
 * The tag set covers every WCAG level-A/AA rule axe-core 4.14 carries:
 * wcag2a/wcag2aa (2.0), wcag21a/wcag21aa (2.1 additions), wcag22aa (2.2
 * additions, which in this axe version is only target-size, 2.5.8).
 * Correction to the October 26 run: that run used only the wcag2a/wcag2aa
 * tags, so the 2.1-specific rules (autocomplete-valid, avoid-inline-spacing,
 * css-orientation-lock, label-content-name-mismatch) were not actually in
 * scope; this run closes that gap.
 *
 * Scope notes, stated so the report is honest about what this run does and
 * does not cover:
 * - jsdom has no layout engine, so axe cannot evaluate color-contrast here;
 *   that rule is disabled in this file and contrast is audited separately
 *   by computing ratios from the app's actual stylesheet colors and by the
 *   live Playwright run, which does evaluate contrast.
 * - Renders are component fragments, so the page-level rules document-title
 *   and html-has-lang are disabled here: the real shell (index.html) was
 *   verified to carry <html lang="en"> and <title>A11y Notebook</title>.
 *   Landmarks and page headings are reviewed separately, not gated here.
 * - Native menus, forced-colors mode, and real screen-reader runs need a
 *   Windows machine and are outside this automated pass.
 * - The per-surface violation report goes to the platform temp directory
 *   (os.tmpdir()), because a hardcoded /tmp does not exist on Windows and
 *   a failed report write must never mask the axe verdict itself.
 */
const REPORT_PATH = path.join(tmpdir(), 'a11y-audit.json');

async function audit(label: string): Promise<void> {
  const results = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: {
      'color-contrast': { enabled: false },
      'document-title': { enabled: false },
      'html-has-lang': { enabled: false },
    },
  });
  let report: Record<string, unknown> = {};
  try {
    report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    report = {};
  }
  report[label] = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  }));
  try {
    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  } catch (error) {
    // Diagnostic only: a failed report write must not fail the audit.
    console.warn(`Could not write the axe report to ${REPORT_PATH}:`, error);
  }
  if (results.violations.length > 0) {
    const detail = results.violations
      .map((violation) => {
        const nodes = violation.nodes.map((node) => `  - ${node.html} (${node.failureSummary})`).join('\n');
        return `${violation.id} [${violation.impact}] ${violation.help}\n${nodes}`;
      })
      .join('\n');
    expect(`\n${label} axe violations:\n${detail}\n`).toBe('');
  }
  expect(results.violations).toEqual([]);
}

describe('accessibility audit (axe, WCAG 2.2 AA)', () => {
  it('settings dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(SettingsDialog, {
        settings: DEFAULT_SETTINGS,
        onSave: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }),
    );
    await audit('Settings dialog');
  });

  it('new appointment dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(AppointmentDialog, {
        notePaths: [],
        filePaths: [],
        tasks: [],
        onSave: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }),
    );
    await audit('Appointment dialog');
  });

  it('new task dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(NewTaskDialog, {
        onCreate: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }),
    );
    await audit('New task dialog');
  });

  it('create reminder dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(CreateReminderDialog, {
        notePaths: [],
        onCreate: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await audit('Create reminder dialog');
  });

  it('keyboard shortcuts dialog has no WCAG AA violations', async () => {
    render(React.createElement(KeyboardShortcutsDialog, { onClose: vi.fn() }));
    await audit('Keyboard shortcuts dialog');
  });

  it('task schedule dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(TaskScheduleDialog, {
        task,
        onSave: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }),
    );
    await audit('Task schedule dialog');
  });

  it('task priority dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(TaskPriorityDialog, {
        task,
        options: ['low', 'normal', 'high', 'urgent'],
        onSave: vi.fn(async () => undefined),
        onOptionsChange: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }),
    );
    await audit('Task priority dialog');
  });

  it('task link dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(TaskLinkDialog, {
        task,
        kind: 'note',
        targets: ['Notes/Chapter.md'],
        onSave: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }),
    );
    await audit('Task link dialog');
  });

  it('reminder alert dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(ReminderAlertDialog, {
        reminder,
        count: 1,
        onComplete: vi.fn(async () => undefined),
        onDismiss: vi.fn(async () => undefined),
        onSnooze: vi.fn(async () => undefined),
        onLater: vi.fn(),
      }),
    );
    await audit('Reminder alert dialog');
  });

  it('spelling dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(SpellingDialog, {
        notePath: 'Note.md',
        content: 'This is a test note with a misspelled wrod.',
        customWords: [],
        onApply: vi.fn(),
        onAddToDictionary: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await audit('Spelling dialog');
  });

  it('thesaurus dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(ThesaurusDialog, {
        initialWord: 'happy',
        canReplace: true,
        onReplace: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await audit('Thesaurus dialog');
  });

  it('citation dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(CitationDialog, {
        notebookPath: '/vault',
        initialView: 'generator',
        onInsertInText: vi.fn(),
        onInsertBibliography: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await audit('Citation dialog');
  });

  it('export note dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(ExportNoteDialog, {
        path: 'Note.md',
        content: '# Hello',
        sourceFormat: 'markdown',
        protectedNote: false,
        onExport: vi.fn(async () => undefined),
        onClose: vi.fn(),
      }),
    );
    await audit('Export note dialog');
  });

  it('conflict dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(ConflictDialog, {
        conflict: { path: 'Note.md', disk: 'Disk version' },
        onResolve: vi.fn(async () => undefined),
      }),
    );
    await audit('Conflict dialog');
  });

  it('note metadata dialog has no WCAG AA violations', async () => {
    render(
      React.createElement(NoteMetadataDialog, {
        noteTitle: 'Note',
        content: '---\ntags: [study]\n---\n# Hello',
        libraryTags: ['study', 'work'],
        onApply: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await audit('Note metadata dialog');
  });

  it('calendar screen has no WCAG AA violations', async () => {
    const previous = (window as unknown as { a11yNotebook?: unknown }).a11yNotebook;
    (window as unknown as { a11yNotebook: unknown }).a11yNotebook = {
      vault: {
        getCalendar: vi.fn(async () => []),
        getTasks: vi.fn(async () => []),
        saveCalendar: vi.fn(async (items: unknown) => items),
      },
    };
    try {
      render(
        React.createElement(CalendarScreen, {
          vaultPath: '/vault',
          notePaths: [],
          filePaths: [],
          isCurrent: () => true,
          onOpenEntry: vi.fn(async () => undefined),
          announce: vi.fn(),
        }),
      );
      await audit('Calendar screen');
    } finally {
      if (previous === undefined) {
        delete (window as unknown as { a11yNotebook?: unknown }).a11yNotebook;
      } else {
        (window as unknown as { a11yNotebook: unknown }).a11yNotebook = previous;
      }
    }
  });
});

const task: VaultTask = {
  id: 'Class.md#task-1',
  path: 'Class.md',
  line: 1,
  text: 'Read chapter',
  complete: false,
  dueDate: '2026-10-05',
  dueTime: '09:30',
  remindAt: '2026-10-04 08:00',
  priority: 'high',
};

const reminder: Reminder = {
  id: 'standalone:one',
  source: 'standalone',
  title: 'Private meeting',
  path: 'Study.md',
  scheduledAt: '2026-10-03T09:00:00.000Z',
  originalScheduledAt: '2026-10-03T09:00:00.000Z',
  status: 'fired',
};
