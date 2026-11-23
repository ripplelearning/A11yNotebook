import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

function installBridge() {
  let listener: ((command: MenuCommand) => void) | undefined;
  const vault: VaultInfo = {
    name: 'Study library',
    path: '/study',
    entries: [
      { name: 'Idea.md', path: 'Idea.md', kind: 'note', provenance: 'created' },
      { name: 'Research', path: 'Research', kind: 'notebook', children: [] },
    ],
  };
  const bridge = {
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    setShortcutCaptureActive: vi.fn(),
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    vault: {
      ...vaultExtensions(),
      get: vi.fn(async () => vault),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, showCommandButtons: true, autosaveDelay: 0 })),
      readNote: vi.fn(async () => '# Idea'),
      saveNote: vi.fn(async () => undefined),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      reveal: vi.fn(async () => undefined),
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  return {
    bridge,
    menu: (command: MenuCommand) => act(() => listener?.(command)),
  };
}

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

async function openPalette(menu: (command: MenuCommand) => void) {
  menu('command-search');
  const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
  return dialog;
}

async function runPaletteCommand(menu: (command: MenuCommand) => void, query: string, label: string) {
  const dialog = await openPalette(menu);
  const search = within(dialog).getByRole('searchbox', { name: 'Search Command Palette' });
  fireEvent.change(search, { target: { value: query } });
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
}

describe('command palette dismissal', () => {
  it('dismisses after Create reminder and focuses the new reminder dialog', async () => {
    const { menu } = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });

    // Tristen's exact repro: search for 'remi', activate Create Reminder.
    await runPaletteCommand(menu, 'remi', 'Create reminder');

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    const reminderDialog = await screen.findByRole('dialog', { name: 'Create reminder' });
    expect(reminderDialog).toBeInTheDocument();
    expect(reminderDialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveAttribute('id', expect.stringContaining('-name'));
  });

  it('dismisses after Settings and focuses inside the settings dialog', async () => {
    const { menu } = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });

    await runPaletteCommand(menu, 'settings', 'Settings');

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    const settingsDialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(settingsDialog.contains(document.activeElement)).toBe(true);
  });

  it('dismisses after navigating to Calendar and leaves focus on a real element, not the body', async () => {
    const { menu } = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });

    await runPaletteCommand(menu, 'calendar', 'Calendar');

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Calendar in Study library');
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBeNull();
  });

  it('keeps the palette open when the palette command itself is chosen', async () => {
    const { menu } = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });

    const dialog = await openPalette(menu);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Command Palette' }));
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('dismisses with Escape from the search input, even with a query typed, and restores focus', async () => {
    const { menu } = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    const opener = screen.getByRole('button', { name: /^(?:Open command search|Command Palette)$/i });
    opener.focus();

    const dialog = await openPalette(menu);
    const search = within(dialog).getByRole('searchbox', { name: 'Search Command Palette' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'remi' } });
    fireEvent.keyDown(search, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('dismisses after a command that opens nothing and only acts (Reveal)', async () => {
    const { menu, bridge } = installBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study library' });
    fireEvent.click(await screen.findByRole('gridcell', { name: 'Research' }));

    await runPaletteCommand(menu, 'reveal selected', 'Reveal selected item in Explorer');

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(bridge.vault.reveal).toHaveBeenCalledWith('Research');
  });
});
