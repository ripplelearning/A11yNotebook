import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo, VaultTask } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { CalendarAppointment } from '../shared/calendar';
import type { Reminder } from '../shared/reminders';
import type { VaultSearchResult } from '../shared/search';
import { vaultExtensions } from './vault-extensions';

// jsdom does not implement scrollIntoView; the app only needs the call to
// be harmless, so stub it once for this file.
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  configurable: true,
});

const vault: VaultInfo = {
  name: 'Study',
  path: '/study',
  entries: [
    {
      name: 'Research',
      path: 'Research',
      kind: 'notebook',
      children: [
        { name: 'Note.md', path: 'Research/Note.md', kind: 'note', provenance: 'created' },
        { name: 'Guide.md', path: 'Research/Guide.md', kind: 'note', provenance: 'created' },
      ],
    },
    {
      name: 'Archive',
      path: 'Archive',
      kind: 'notebook',
      children: [{ name: 'Old.md', path: 'Archive/Old.md', kind: 'note', provenance: 'created' }],
    },
  ],
};

const tasks: VaultTask[] = [
  {
    id: 't1',
    path: 'Research/Note.md',
    text: 'Review the accessibility report',
    complete: false,
    dueDate: '2026-11-10',
    priority: 'high',
  },
  { id: 't2', path: 'Research/Note.md', text: 'Buy milk', complete: true },
];

const reminders: Reminder[] = [
  {
    id: 'r1',
    source: 'task',
    title: 'Review the report',
    path: 'Research/Note.md',
    scheduledAt: '2026-11-08T09:00:00-08:00',
    originalScheduledAt: '2026-11-08T09:00:00-08:00',
    status: 'pending',
  },
];

const appointments: CalendarAppointment[] = [
  {
    id: 'a1',
    title: 'Team review meeting',
    start: '2026-11-10T14:00:00-08:00',
    allDay: false,
    location: 'Room 4',
    description: 'Quarterly accessibility review',
  },
];

const fileResult: VaultSearchResult = {
  path: 'Research/Guide.md',
  title: 'Guide.md',
  kind: 'note',
  notebook: 'Research',
  tags: [],
  modified: '2026-11-01T00:00:00.000Z',
  snippet: 'A guide to review.',
  score: 10,
};

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

function setup() {
  let menuListener: (command: MenuCommand) => void = () => undefined;
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => '# Idea\n\nIdea again'),
      saveNote: vi.fn(async () => undefined),
      getTasks: vi.fn(async () => tasks),
      getTaskLinks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getReadingPosition: vi.fn(async () => null),
      setReadingPosition: vi.fn(async () => undefined),
      getReminders: vi.fn(async () => reminders),
      getCalendar: vi.fn(async () => appointments),
      saveCalendar: vi.fn(async () => undefined),
      search: vi.fn(async (query: { text: string; kind?: string }) =>
        query.text.toLowerCase().includes('review') && (!query.kind || query.kind === 'note') ? [fileResult] : [],
      ),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autosaveDelay: 0 })),
    },
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    setShortcutCaptureActive: vi.fn(),
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      menuListener = callback;
      return () => {
        menuListener = () => undefined;
      };
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  render(<App />);
  return { bridge, menu: (command: MenuCommand) => act(() => menuListener(command)) };
}

async function searchFor(text: string) {
  await screen.findByRole('heading', { name: 'Study' });
  fireEvent.change(screen.getByLabelText('Global search'), { target: { value: text } });
}

function statusBar() {
  return screen.getByLabelText('Status bar');
}

describe('global search scope', () => {
  it('shows tasks, reminders, and appointments alongside file results', async () => {
    setup();
    await searchFor('review');
    expect(await screen.findByRole('button', { name: 'Note: Guide.md' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Task: Review the accessibility report' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reminder: Review the report' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Appointment: Team review meeting' })).toBeInTheDocument();
    expect(statusBar()).toHaveTextContent('4 search results shown in the whole library.');
  });

  it('opens a task result in the Tasks view and focuses the task row', async () => {
    setup();
    await searchFor('milk');
    fireEvent.click(await screen.findByRole('button', { name: 'Task: Buy milk' }));
    // The task is done and the default Tasks filter shows open tasks
    // only: opening from search resets the filters so the row is there.
    await waitFor(() => expect(document.activeElement?.getAttribute('data-task-id')).toBe('t2'));
    expect(statusBar()).toHaveTextContent('Task: Buy milk.');
  });

  it('opens a reminder result on the Reminders tab and focuses the reminder row', async () => {
    setup();
    await searchFor('report');
    fireEvent.click(await screen.findByRole('button', { name: 'Reminder: Review the report' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-reminder-id')).toBe('r1'));
    expect(statusBar()).toHaveTextContent('Reminder: Review the report,');
  });

  it('opens an appointment result in its appointment dialog', async () => {
    setup();
    await searchFor('Team review');
    fireEvent.click(await screen.findByRole('button', { name: 'Appointment: Team review meeting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit appointment' });
    expect(within(dialog).getByDisplayValue('Team review meeting')).toBeInTheDocument();
  });

  it('narrows results to tasks with the kind filter', async () => {
    setup();
    await searchFor('review');
    await screen.findByRole('button', { name: 'Note: Guide.md' });
    fireEvent.change(screen.getByLabelText('Search kind'), { target: { value: 'task' } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Note: Guide.md' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Reminder: Review the report' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Appointment: Team review meeting' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task: Review the accessibility report' })).toBeInTheDocument();
    expect(statusBar()).toHaveTextContent('1 search results shown in the whole library.');
  });

  it('still opens a file result in the note', async () => {
    setup();
    await searchFor('review');
    fireEvent.click(await screen.findByRole('button', { name: 'Note: Guide.md' }));
    await screen.findByRole('heading', { name: 'Guide' });
  });
});
