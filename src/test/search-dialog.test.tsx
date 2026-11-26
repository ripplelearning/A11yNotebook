import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import App from '../renderer/App';
import SearchDialog from '../renderer/features/search/SearchDialog';
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

const guideResult: VaultSearchResult = {
  path: 'Research/Guide.md',
  title: 'Guide.md',
  kind: 'note',
  notebook: 'Research',
  tags: [],
  modified: '2026-11-01T00:00:00.000Z',
  snippet: 'A guide to review.',
  score: 10,
};

const noteResult: VaultSearchResult = {
  path: 'Research/Note.md',
  title: 'Note.md',
  kind: 'note',
  notebook: 'Research',
  tags: [],
  modified: '2026-11-01T00:00:00.000Z',
  snippet: 'A note to review.',
  score: 9,
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
        query.text.toLowerCase().includes('review') && (!query.kind || query.kind === 'note')
          ? [guideResult, noteResult]
          : [],
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

function searchButton() {
  return screen.getByRole('button', { name: 'Search' });
}

async function openSearchDialog() {
  await screen.findByRole('heading', { name: 'Study' });
  const button = searchButton();
  // jsdom does not move focus on click; focus the invoker first so
  // the dialog's focus restore has somewhere to return to, as a real
  // keyboard or mouse activation would.
  button.focus();
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'Search' });
  return { dialog, input: within(dialog).getByRole('combobox', { name: 'Global search' }) };
}

async function searchFor(text: string) {
  const { dialog, input } = await openSearchDialog();
  fireEvent.change(input, { target: { value: text } });
  await screen.findByRole('button', { name: 'Note: Guide.md' });
  return { dialog, input };
}

function statusBar() {
  return screen.getByLabelText('Status bar');
}

describe('search dialog', () => {
  it('opens from the Search button and focuses the search box', async () => {
    setup();
    const { input } = await openSearchDialog();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'Search library, notes, tasks, files');
  });

  it('shows autocomplete suggestions for the results and fills the box from one', async () => {
    setup();
    const { input } = await searchFor('review');
    const listbox = await screen.findByRole('listbox', { name: 'Search suggestions' });
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Appointment: Team review meeting',
      'Note: Guide.md',
      'Reminder: Review the report',
      'Task: Review the accessibility report',
      'Note: Note.md',
    ]);
    expect(input).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-1');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-1');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Guide.md');
    expect(input).toHaveFocus();
  });

  it('keeps the highlighted suggestion when the results list is re-created with the same titles', () => {
    // The app re-creates the filtered results list on every render, so
    // a fresh array with the same titles must not reset the highlight:
    // in the real app a re-render after ArrowDown used to clear
    // aria-activedescendant before the user could press Enter.
    const results: VaultSearchResult[] = [
      {
        kind: 'note',
        title: 'Review note',
        path: 'Research/Review note.md',
        notebook: 'Research',
        tags: [],
        modified: '2026-11-10',
        snippet: 'review',
        score: 1,
      },
    ];
    const inputRef = { current: null } as unknown as RefObject<HTMLInputElement>;
    const renderDialog = (list: VaultSearchResult[]) =>
      render(
        <SearchDialog
          searchText="review"
          onSearchText={() => undefined}
          searchInputRef={inputRef}
          filters={{}}
          onFilters={() => undefined}
          notebooks={[]}
          results={list}
          active
          scope="library"
          onScope={() => undefined}
          selectedNotebookPath={undefined}
          selectedNotebookName={undefined}
          scopeBlocked={false}
          onOpen={() => undefined}
          onClose={() => undefined}
        />,
      );
    const { rerender } = renderDialog(results);
    const input = screen.getByRole('combobox', { name: 'Global search' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
    rerender(
      <SearchDialog
        searchText="review"
        onSearchText={() => undefined}
        searchInputRef={inputRef}
        filters={{}}
        onFilters={() => undefined}
        notebooks={[]}
        results={[...results]}
        active
        scope="library"
        onScope={() => undefined}
        selectedNotebookPath={undefined}
        selectedNotebookName={undefined}
        scopeBlocked={false}
        onOpen={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
  });

  it('opens from the Open search command', async () => {
    const { menu } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    menu('focus-search');
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    expect(within(dialog).getByRole('combobox', { name: 'Global search' })).toHaveFocus();
  });

  it('Escape in the search box clears the text and results, closes the dialog, and returns focus', async () => {
    setup();
    const { input } = await searchFor('review');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Note: Guide.md' })).not.toBeInTheDocument();
    expect(statusBar()).toHaveTextContent('Search cleared.');
    expect(searchButton()).toHaveFocus();
    // The search is really gone: reopening shows an empty box.
    await openSearchDialog();
    expect(screen.getByRole('combobox', { name: 'Global search' })).toHaveValue('');
  });

  it('Escape from a result row clears the search and closes the dialog', async () => {
    setup();
    await searchFor('review');
    const result = screen.getByRole('button', { name: 'Note: Guide.md' });
    result.focus();
    fireEvent.keyDown(result, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Note: Guide.md' })).not.toBeInTheDocument();
    expect(statusBar()).toHaveTextContent('Search cleared.');
    expect(searchButton()).toHaveFocus();
  });

  it('the Close button clears the search and closes the dialog', async () => {
    setup();
    const { dialog } = await searchFor('review');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Note: Guide.md' })).not.toBeInTheDocument();
    expect(statusBar()).toHaveTextContent('Search cleared.');
    expect(searchButton()).toHaveFocus();
  });

  it('clears a filter-only search on close, so results do not linger', async () => {
    setup();
    const { dialog } = await searchFor('review');
    fireEvent.change(within(dialog).getByLabelText('Search kind'), { target: { value: 'task' } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Note: Guide.md' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Task: Review the accessibility report' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
    const reopened = await openSearchDialog();
    expect(within(reopened.dialog).getByLabelText('Search kind')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Task: Review the accessibility report' })).not.toBeInTheDocument();
  });

  it('activating a task result closes the dialog and focuses the task row', async () => {
    setup();
    await searchFor('review');
    fireEvent.click(screen.getByRole('button', { name: 'Task: Review the accessibility report' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement?.getAttribute('data-task-id')).toBe('t1'));
    expect(statusBar()).toHaveTextContent('Task: Review the accessibility report.');
    // The search is cleared, not merely hidden.
    await openSearchDialog();
    expect(screen.getByRole('combobox', { name: 'Global search' })).toHaveValue('');
  });

  it('activating a file result closes the dialog and opens the note', async () => {
    setup();
    await searchFor('review');
    fireEvent.click(screen.getByRole('button', { name: 'Note: Guide.md' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
    await screen.findByRole('heading', { name: 'Guide' });
  });

  it('Escape in the command palette still dismisses the palette', async () => {
    const { menu } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    menu('command-search');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    const paletteSearch = within(palette).getByRole('searchbox', { name: 'Search Command Palette' });
    expect(paletteSearch).toHaveFocus();
    fireEvent.keyDown(paletteSearch, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });
});
