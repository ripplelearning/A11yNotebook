import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import type { TaskLink } from '../shared/task-links';
import { vaultExtensions } from './vault-extensions';

const vault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    { name: 'Tasks.md', path: 'Tasks.md', kind: 'note', provenance: 'created' },
    { name: 'Guide.md', path: 'Guide.md', kind: 'note', provenance: 'created' },
  ],
};

const liveLink: TaskLink = {
  id: 'link-live',
  taskId: 'Tasks.md:1',
  taskPath: 'Tasks.md',
  kind: 'note',
  target: 'Guide.md',
};
const deadLink: TaskLink = {
  id: 'link-dead',
  taskId: 'Tasks.md:1',
  taskPath: 'Tasks.md',
  kind: 'note',
  target: 'Gone.md',
};

afterEach(() => {
  delete window.a11yNotebook;
  vi.restoreAllMocks();
});

function setup() {
  let menuListener: ((command: MenuCommand) => void) | undefined;
  let links = [liveLink, deadLink];
  const bridge: NotebookBridge = {
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
    },
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => '# Tasks\n\n- [ ] Read the guide'),
      saveNote: vi.fn(async () => undefined),
      createNotebook: vi.fn(async () => vault),
      createNote: vi.fn(async () => vault),
      rename: vi.fn(async () => vault),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => vault),
      delete: vi.fn(async () => vault),
      deletePermanently: vi.fn(async () => vault),
      getTasks: vi.fn(async () => [
        {
          id: 'Tasks.md:1',
          path: 'Tasks.md',
          line: 1,
          text: 'Read the guide',
          complete: false,
        },
      ]),
      toggleTask: vi.fn(async () => []),
      setHtmlTaskDueDate: vi.fn(async () => []),
      getTaskLinks: vi.fn(async () => links),
      saveTaskLinks: vi.fn(async (next: TaskLink[]) => {
        links = next;
        return links;
      }),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      lookupThesaurus: vi.fn(async () => []),
      getBibliography: vi.fn(async () => []),
      saveBibliography: vi.fn(async () => []),
      getCalendar: vi.fn(async () => []),
      saveCalendar: vi.fn(async (appointments) => appointments),
      fetchCitationMetadata: vi.fn(async () => ({})),
      toggleBookmark: vi.fn(async () => []),
      addBookmark: vi.fn(async () => []),
      removeBookmark: vi.fn(async () => []),
    },
    onMenuCommand: (callback) => {
      menuListener = callback;
      return () => {
        menuListener = undefined;
      };
    },
  };
  window.a11yNotebook = bridge;
  render(<App />);
  return {
    bridge,
    menu: (command: MenuCommand) => act(() => menuListener?.(command)),
  };
}

async function openTasksTable(menu: (command: MenuCommand) => void) {
  await screen.findByRole('heading', { name: 'Study' });
  menu('show-tasks');
  return screen.findByRole('table', { name: 'Tasks in Study' });
}

function lastSavedLinks(bridge: NotebookBridge): TaskLink[] {
  const calls = vi.mocked(bridge.vault.saveTaskLinks!).mock.calls;
  return calls[calls.length - 1]?.[0] ?? [];
}

describe('dead task links', () => {
  it('drops the link when opening it finds the target is gone', async () => {
    const { bridge, menu } = setup();
    const taskTable = await openTasksTable(menu);
    fireEvent.click(within(taskTable).getByRole('button', { name: 'Open note: Gone.md' }));
    await waitFor(() => {
      const saved = lastSavedLinks(bridge);
      expect(saved).toContainEqual(liveLink);
      expect(saved).toContainEqual(
        expect.objectContaining({ taskId: 'Tasks.md:1', target: 'Tasks.md', auto: true }),
      );
      expect(saved).not.toContainEqual(deadLink);
    });
    expect(screen.getByLabelText('Status bar')).toHaveTextContent(
      'The linked note is no longer in the library, so its link was removed.',
    );
    expect(within(taskTable).queryByRole('button', { name: 'Open note: Gone.md' })).toBeNull();
  });

  it('drops dead links on refresh (F5) instead of leaving them displayed', async () => {
    const { bridge, menu } = setup();
    await screen.findByRole('heading', { name: 'Study' });
    menu('refresh-links');
    await waitFor(() => {
      const saved = lastSavedLinks(bridge);
      expect(saved).toContainEqual(liveLink);
      expect(saved).not.toContainEqual(deadLink);
    });
    const taskTable = await openTasksTable(menu);
    expect(within(taskTable).queryByRole('button', { name: 'Open note: Gone.md' })).toBeNull();
    expect(within(taskTable).getByRole('button', { name: 'Open note: Guide.md' })).toBeInTheDocument();
  });
});

describe('task auto-links', () => {
  it('links each task to its own note in the Links column', async () => {
    const { menu } = setup();
    const taskTable = await openTasksTable(menu);
    await waitFor(() =>
      expect(within(taskTable).getByRole('button', { name: 'Open note: Tasks.md' })).toBeInTheDocument(),
    );
    expect(within(taskTable).getByRole('button', { name: 'Open note: Guide.md' })).toBeInTheDocument();
  });

  it('keeps a removed auto-link removed instead of re-creating it', async () => {
    const { bridge, menu } = setup();
    const taskTable = await openTasksTable(menu);
    await waitFor(() =>
      expect(within(taskTable).getByRole('button', { name: 'Open note: Tasks.md' })).toBeInTheDocument(),
    );
    fireEvent.click(within(taskTable).getByRole('button', { name: 'Remove link to Tasks.md' }));
    await waitFor(() =>
      expect(bridge.vault.saveDismissedTaskAutoLinks).toHaveBeenCalledWith(['Tasks.md:1']),
    );
    expect(within(taskTable).queryByRole('button', { name: 'Open note: Tasks.md' })).toBeNull();
    expect(lastSavedLinks(bridge).find((link) => link.auto)).toBeUndefined();
  });
});
