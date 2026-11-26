import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';
import { openTreeLeaf } from './library-navigation';

afterEach(() => {
  delete window.a11yNotebook;
});

/**
 * The search dialog needs a library (its Search button is disabled
 * without one), so the tests that open it install a minimal library
 * bridge first. The other tests in this file render the bare app.
 */
function installLibraryBridge() {
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [],
  };
  let menuListener: ((command: MenuCommand) => void) | undefined;
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, showCommandButtons: true, autosaveDelay: 0 })),
    },
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      onStatus: () => () => undefined,
    },
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      menuListener = callback;
      return () => {
        menuListener = undefined;
      };
    },
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  return { bridge, menu: (command: MenuCommand) => act(() => menuListener?.(command)) };
}

const pressF6 = (shiftKey = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F6', shiftKey });

describe('F6 pane navigation', () => {
  it('starts on the selected tab, then moves forward through main, right pane, status, and navigation, then wraps', () => {
    render(<App />);
    const navigation = screen.getByRole('complementary', { name: 'Navigation pane' });
    const selectedTab = screen.getByRole('tab', { name: 'Notes & Files' });
    const panel = screen.getByRole('tabpanel');
    const rightPane = screen.getByRole('complementary', { name: 'Right information pane' });
    const status = screen.getByLabelText('Status bar');

    // Opening the app focuses the selected tab (instead of leaving focus
    // on the body, which made JAWS read the whole window on open).
    expect(selectedTab).toHaveFocus();

    pressF6();
    expect(panel).toHaveFocus();
    pressF6();
    expect(rightPane).toHaveFocus();
    pressF6();
    expect(status).toHaveFocus();
    pressF6();
    expect(navigation).toHaveFocus();
    pressF6();
    expect(selectedTab).toHaveFocus();
  });

  it('moves backward exactly one pane with Shift+F6', () => {
    render(<App />);
    const panel = screen.getByRole('tabpanel');
    panel.focus();

    pressF6(true);
    expect(screen.getByRole('tab', { name: 'Notes & Files' })).toHaveFocus();
    pressF6(true);
    expect(screen.getByRole('complementary', { name: 'Navigation pane' })).toHaveFocus();
    pressF6(true);
    expect(screen.getByLabelText('Status bar')).toHaveFocus();
  });

  it('skips the right pane when it is hidden', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle right pane' }));
    expect(screen.queryByRole('complementary', { name: 'Right information pane' })).not.toBeInTheDocument();

    screen.getByRole('tabpanel').focus();
    pressF6();
    expect(screen.getByLabelText('Status bar')).toHaveFocus();
    pressF6(true);
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('makes region containers programmatically focusable without adding them to the Tab order', () => {
    render(<App />);
    expect(screen.getByRole('complementary', { name: 'Navigation pane' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('complementary', { name: 'Right information pane' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByLabelText('Status bar')).toHaveAttribute('tabindex', '-1');
  });
});

describe('focus commands', () => {
  it('opens the search dialog with the Open search menu command', async () => {
    installLibraryBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
    expect(screen.getByRole('combobox', { name: 'Global search' })).toHaveFocus();
  });

  it('reopens the right pane with its toggle and reaches it with F6', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle right pane' }));
    expect(screen.queryByRole('complementary', { name: 'Right information pane' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle right pane' }));
    screen.getByRole('tabpanel').focus();
    pressF6();
    expect(screen.getByRole('complementary', { name: 'Right information pane' })).toHaveFocus();
  });

  it('runs keyboard shortcuts from the command registry', async () => {
    installLibraryBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.keyDown(document.body, { key: 'q', altKey: true });
    expect(screen.getByRole('combobox', { name: 'Global search' })).toHaveFocus();

    // Shortcuts are ignored while a dialog is open, so close the search
    // dialog first; Escape clears the search and closes it.
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Global search' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    expect(within(screen.getByLabelText('Status bar')).getByRole('status')).toHaveTextContent(
      'This view has no note editor.',
    );
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Mode: read-only');
  });
});

describe('command palette', () => {
  it('opens with Ctrl+Shift+P and finds legacy command names without changing displayed labels', () => {
    render(<App />);
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true, shiftKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    const search = within(dialog).getByRole('searchbox', { name: 'Search Command Palette' });

    fireEvent.change(search, { target: { value: 'Open command search' } });
    expect(within(dialog).getByRole('button', { name: 'Command Palette' })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'Open library' } });
    expect(within(dialog).getByRole('button', { name: 'Open library' })).toBeInTheDocument();
  });

  it('focuses the search input, traps Tab, and restores focus on Escape', () => {
    render(<App />);
    const opener = screen.getByRole('button', { name: /^(?:Open command search|Command Palette)$/i });
    opener.focus();
    fireEvent.keyDown(opener, { key: 'p', ctrlKey: true, shiftKey: true });

    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const input = within(dialog).getByRole('searchbox', { name: 'Search Command Palette' });
    expect(input).toHaveFocus();

    const buttons = within(dialog).getAllByRole('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('filters commands and runs the chosen command', async () => {
    installLibraryBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study' });
    fireEvent.click(screen.getByRole('button', { name: /^(?:Open command search|Command Palette)$/i }));
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'focus search' } });
    expect(within(dialog).getByText('1 command')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open search' }));
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Global search' })).toHaveFocus();
  });
});

describe('tabs', () => {
  it('starts with one real notes-files tab and a labelled tab panel', () => {
    render(<App />);
    const tablist = screen.getByRole('tablist', { name: 'Open tabs' });
    const tabs = within(tablist).getAllByRole('tab');
    const [notesFiles] = tabs;

    expect(tabs).toHaveLength(1);
    expect(notesFiles).toHaveAttribute('aria-selected', 'true');
    expect(notesFiles).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Notes and Files');
  });

  it('moves focus and selection across multiple tabs with arrow, Home, and End keys', async () => {
    const vault: VaultInfo = {
      name: 'Study',
      path: '/study',
      entries: [{ name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' }],
    };
    let menuListener: ((command: MenuCommand) => void) | undefined;
    window.a11yNotebook = {
      updater: { onStatus: () => () => undefined },
      onMenuCommand: (callback: (command: MenuCommand) => void) => {
        menuListener = callback;
        return () => {
          menuListener = undefined;
        };
      },
      vault: {
        ...vaultExtensions(),
        get: async () => vault,
        getTasks: async () => [],
        getLinkIndex: async () => ({ links: [] }),
        getBookmarks: async () => [],
        readNote: async () => '# Note',
      },
    } as unknown as NotebookBridge;
    render(<App />);

    const tablist = screen.getByRole('tablist', { name: 'Open tabs' });
    const navigation = screen.getByRole('complementary', { name: 'Navigation pane' });
    await within(navigation).findByRole('heading', { name: 'Study' });
    act(() => menuListener?.('show-tasks'));
    await openTreeLeaf(/Note\.md/);
    await screen.findByRole('tab', { name: 'Note' });

    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['Tasks', 'Note']);
    const [tasks, note] = tabs;
    const panel = screen.getByRole('tabpanel');
    expect(note).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAttribute('aria-labelledby', note.id);

    fireEvent.keyDown(note, { key: 'ArrowRight' });
    expect(tasks).toHaveFocus();
    expect(tasks).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAccessibleName('Tasks in Study');

    fireEvent.keyDown(tasks, { key: 'ArrowLeft' });
    expect(note).toHaveFocus();
    expect(note).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAttribute('aria-labelledby', note.id);

    fireEvent.keyDown(note, { key: 'Home' });
    expect(tasks).toHaveFocus();
    expect(tasks).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAccessibleName('Tasks in Study');

    fireEvent.keyDown(tasks, { key: 'End' });
    expect(note).toHaveFocus();
    expect(note).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAttribute('aria-labelledby', note.id);

    fireEvent.keyDown(note, { key: 'ArrowLeft' });
    expect(tasks).toHaveFocus();
    expect(tasks).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAccessibleName('Tasks in Study');
  });
});
