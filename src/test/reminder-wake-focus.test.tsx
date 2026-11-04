import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import type { Reminder } from '../shared/reminders';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2100-01-01T00:00:00.000Z';

function setup(focus: { libraryPath: string; reminderId: string } | null, reminders: Reminder[]) {
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [{ name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' }],
  };
  const bridge: NotebookBridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      rename: vi.fn(async () => vault),
      delete: vi.fn(async () => vault),
      deletePermanently: vi.fn(async () => vault),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => null),
      toggleTask: vi.fn(async () => []),
      openLibraryPath: vi.fn(async () => vault),
      getRecentLibraries: vi.fn(async () => [{ path: '/study', name: 'Study', lastOpenedAt: '2026-11-01T00:00:00.000Z' }]),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, reminderAlerts: false })),
      getReminders: vi.fn(async () => reminders),
      getTasks: vi.fn(async () => []),
      getCalendar: vi.fn(async () => []),
      getBookmarks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      lookupThesaurus: vi.fn(async () => []),
      getBibliography: vi.fn(async () => []),
      saveBibliography: vi.fn(async () => []),
      fetchCitationMetadata: vi.fn(async () => ({})),
      toggleBookmark: vi.fn(async () => []),
      addBookmark: vi.fn(async () => []),
      removeBookmark: vi.fn(async () => []),
      readNote: vi.fn(async () => '# Note\n\ntext'),
      saveNote: vi.fn(async () => undefined),
      onSecurityLocked: () => () => undefined,
      onReminder: () => () => undefined,
      reminderWakeFocus: vi.fn(async () => focus),
    },
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: () => () => undefined,
    },
    onMenuCommand: () => () => undefined,
  };
  window.a11yNotebook = bridge;
  render(<App />);
}

function dueReminder(): Reminder {
  return {
    id: 'reminder-due',
    source: 'standalone',
    title: 'Take medicine',
    scheduledAt: PAST,
    originalScheduledAt: PAST,
    status: 'fired',
  };
}

function laterReminder(): Reminder {
  return {
    id: 'reminder-later',
    source: 'standalone',
    title: 'Later thing',
    scheduledAt: FUTURE,
    originalScheduledAt: FUTURE,
    status: 'pending',
  };
}

describe('closed-app reminder wake focus', () => {
  it('opens the due reminder library, shows Reminders, and focuses the due reminder', async () => {
    setup({ libraryPath: '/study', reminderId: 'reminder-due' }, [dueReminder(), laterReminder()]);
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-reminder-id')).toBe('reminder-due');
    });
    expect(screen.getByRole('heading', { name: /Reminders/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(screen.getByLabelText('Status bar')).getByRole('status')).toHaveTextContent(
        'Due reminder: Take medicine',
      );
    });
  });

  it('announces a missing reminder and stays on the normal startup view', async () => {
    setup({ libraryPath: '/study', reminderId: 'reminder-gone' }, [laterReminder()]);
    await waitFor(() => {
      expect(within(screen.getByLabelText('Status bar')).getByRole('status')).toHaveTextContent(
        'The due reminder is no longer available.',
      );
    });
    expect(screen.queryByRole('heading', { name: /Reminders/ })).toBeNull();
  });
});
