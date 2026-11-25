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
  await screen.findByRole('button', { name: 'Note: Guide.md' });
}

function statusBar() {
  return screen.getByLabelText('Status bar');
}

function searchInput() {
  return screen.getByLabelText('Global search');
}

describe('global search Escape', () => {
  it('clears the search text and results from the search input, and announces it', async () => {
    setup();
    await searchFor('review');
    const input = searchInput();
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Note: Guide.md' })).not.toBeInTheDocument();
    expect(statusBar()).toHaveTextContent('Search cleared.');
    expect(input).toHaveFocus();
  });

  it('clears the search text and results from a result row, and moves focus to the search input', async () => {
    setup();
    await searchFor('review');
    const result = screen.getByRole('button', { name: 'Note: Guide.md' });
    result.focus();
    fireEvent.keyDown(result, { key: 'Escape' });

    expect(searchInput()).toHaveValue('');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Note: Guide.md' })).not.toBeInTheDocument();
    expect(statusBar()).toHaveTextContent('Search cleared.');
    expect(searchInput()).toHaveFocus();
  });

  it('clears a filter-only search, so results do not linger after the text is gone', async () => {
    setup();
    await searchFor('review');
    fireEvent.change(screen.getByLabelText('Search kind'), { target: { value: 'task' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Note: Guide.md' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Task: Review the accessibility report' })).toBeInTheDocument();

    const input = searchInput();
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Task: Review the accessibility report' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search kind')).toHaveValue('');
    expect(statusBar()).toHaveTextContent('Search cleared.');
  });

  it('does nothing harmful with no search active', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Study' });
    const input = searchInput();
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });
});

describe('global search Escape with the command palette', () => {
  it('Escape in the palette dismisses the palette and leaves the search results alone', async () => {
    const { menu } = setup();
    await searchFor('review');
    searchInput().focus();

    menu('command-search');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    const paletteSearch = within(dialog).getByRole('searchbox', { name: 'Search Command Palette' });
    expect(paletteSearch).toHaveFocus();
    fireEvent.keyDown(paletteSearch, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    // The global search was untouched: its text and results are still there.
    expect(searchInput()).toHaveValue('review');
    expect(screen.getByRole('button', { name: 'Note: Guide.md' })).toBeInTheDocument();
  });
});
