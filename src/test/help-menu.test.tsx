import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { UpdaterStatus } from '../shared/updater';

function installBridge() {
  let statusListener: ((status: UpdaterStatus) => void) | null = null;
  let menuListener: ((command: MenuCommand) => void) | null = null;
  const bridge: NotebookBridge = {
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: (callback) => {
        statusListener = callback;
        return () => {
          statusListener = null;
        };
      },
    },
    vault: {
      open: vi.fn(async () => null),
      get: vi.fn(async () => null),
      readNote: vi.fn(async () => ''),
      saveNote: vi.fn(async () => undefined),
      createNotebook: vi.fn(async () => ({ name: 'Vault', path: '/vault', entries: [] })),
      createNote: vi.fn(async () => ({ name: 'Vault', path: '/vault', entries: [] })),
      rename: vi.fn(async () => ({ name: 'Vault', path: '/vault', entries: [] })),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => null),
      delete: vi.fn(async () => ({ name: 'Vault', path: '/vault', entries: [] })),
      getTasks: vi.fn(async () => []),
      toggleTask: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      toggleBookmark: vi.fn(async () => []),
    },
    onMenuCommand: (callback) => {
      menuListener = callback;
      return () => {
        menuListener = null;
      };
    },
  };
  window.a11yNotebook = bridge;
  return {
    bridge,
    emit: (status: unknown) => act(() => statusListener?.(status as UpdaterStatus)),
    menu: (command: string) => act(() => menuListener?.(command as MenuCommand)),
  };
}

afterEach(() => {
  delete window.a11yNotebook;
});

const helpMenu = () => screen.getByRole('group', { name: 'Help' });

describe('Help menu', () => {
  it('contains keyboard-operable Help commands with clear names', () => {
    render(<App />);
    const help = helpMenu();
    for (const name of ['Check for Updates', 'Keyboard Shortcuts', 'About A11y Notebook']) {
      expect(within(help).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('shows the About dialog with name, version, and repository link', () => {
    render(<App />);
    const opener = within(helpMenu()).getByRole('button', { name: 'About A11y Notebook' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'About A11y Notebook' });
    expect(dialog).toHaveTextContent(`version ${__APP_VERSION__}`);
    expect(
      within(dialog).getByRole('link', { name: 'https://github.com/ripplelearning/A11yNotebook' }),
    ).toHaveAttribute('href', 'https://github.com/ripplelearning/A11yNotebook');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(opener).toHaveFocus();
  });

  it('lists keyboard shortcuts including F6 and Shift+F6', () => {
    render(<App />);
    fireEvent.keyDown(document.body, { key: 'F1' });
    const dialog = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    expect(within(dialog).getByRole('rowheader', { name: 'Move to the next pane' })).toBeInTheDocument();
    expect(within(dialog).getByRole('cell', { name: 'Shift+F6' })).toBeInTheDocument();
    expect(within(dialog).getByRole('cell', { name: 'Ctrl+K' })).toBeInTheDocument();
  });

  it('uses the accessible notebook-name dialog from both notebook entry points', async () => {
    const { bridge } = installBridge();
    vi.mocked(bridge.vault.get).mockResolvedValue({ name: 'Vault', path: '/vault', entries: [] });
    render(<App />);

    await screen.findByRole('heading', { name: 'Vault' });
    const navigationAction = within(screen.getByRole('complementary', { name: 'Navigation pane' })).getByRole(
      'button',
      { name: 'New notebook' },
    );
    navigationAction.focus();
    fireEvent.click(navigationAction);
    let dialog = screen.getByRole('dialog', { name: 'New notebook' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'Notebook name' });
    expect(nameInput).toHaveFocus();
    fireEvent.change(nameInput, { target: { value: 'Research' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bridge.vault.createNotebook).toHaveBeenCalledWith('Research');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Notebook created.'));
    expect(navigationAction).toHaveFocus();

    const menuAction = within(screen.getByRole('group', { name: 'Vault' })).getByRole('button', {
      name: 'New notebook',
    });
    menuAction.focus();
    fireEvent.click(menuAction);
    dialog = screen.getByRole('dialog', { name: 'New notebook' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(menuAction).toHaveFocus();
  });
});

describe('Check for Updates', () => {
  it('explains that updates need the installed build when no updater bridge is present', () => {
    render(<App />);
    fireEvent.click(within(helpMenu()).getByRole('button', { name: 'Check for Updates' }));
    const dialog = screen.getByRole('dialog', { name: 'Software update' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Updates are only available in the installed build.');
  });

  it('walks through check, consented download with progress, and install', () => {
    const { bridge, emit } = installBridge();
    render(<App />);
    const opener = within(helpMenu()).getByRole('button', { name: 'Check for Updates' });
    opener.focus();
    fireEvent.click(opener);

    expect(bridge.updater.check).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog', { name: 'Software update' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Checking for updates.');

    emit({ state: 'update-available', version: '9.9.9', releaseNotes: 'Faster search.' });
    expect(dialog).toHaveTextContent('Version 9.9.9 is available.');
    expect(dialog).toHaveTextContent('Faster search.');
    const download = within(dialog).getByRole('button', { name: 'Download' });
    expect(download).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(bridge.updater.download).not.toHaveBeenCalled();

    fireEvent.click(download);
    expect(bridge.updater.download).toHaveBeenCalledTimes(1);

    emit({ state: 'download-progress', percent: 0 });
    emit({ state: 'download-progress', percent: 12 });
    const liveRegion = within(dialog).getByRole('status');
    expect(liveRegion).toHaveTextContent('Downloading update: 10 percent complete.');
    emit({ state: 'download-progress', percent: 17 });
    expect(liveRegion).toHaveTextContent('Downloading update: 10 percent complete.');
    emit({ state: 'download-progress', percent: 23 });
    expect(liveRegion).toHaveTextContent('Downloading update: 20 percent complete.');

    const progressbar = within(dialog).getByRole('progressbar', { name: 'Download progress' });
    expect(progressbar).toHaveAttribute('aria-valuenow', '23');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Update download: 23%');

    emit({ state: 'update-downloaded', version: '9.9.9' });
    const restart = within(dialog).getByRole('button', { name: 'Restart and install' });
    expect(restart).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Install on exit' })).toBeInTheDocument();
    fireEvent.click(restart);
    expect(bridge.updater.installNow).toHaveBeenCalledTimes(1);
  });

  it('confirms "Install on exit" only after the main process accepts it', async () => {
    const { bridge, emit } = installBridge();
    render(<App />);
    fireEvent.click(within(helpMenu()).getByRole('button', { name: 'Check for Updates' }));
    emit({ state: 'update-downloaded', version: '9.9.9' });
    const dialog = screen.getByRole('dialog', { name: 'Software update' });

    vi.mocked(bridge.updater.installOnExit).mockImplementationOnce(async () => {
      emit({ state: 'error', message: 'No downloaded update is ready to install.' });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Install on exit' }));
    });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('No downloaded update is ready to install.');
    expect(screen.getByLabelText('Status bar')).not.toHaveTextContent('installed when you exit');

    emit({ state: 'update-downloaded', version: '9.9.9' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Install on exit' }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status bar')).toHaveTextContent(
      'The update will be installed when you exit A11y Notebook.',
    );
  });

  it('keeps the readable main-process error when the IPC call also rejects', async () => {
    const { bridge, emit } = installBridge();
    render(<App />);
    vi.mocked(bridge.updater.check).mockImplementationOnce(async () => {
      emit({ state: 'error', message: 'Could not reach GitHub.' });
      throw new Error("Error invoking remote method 'updater:check': Error: boom");
    });
    await act(async () => {
      fireEvent.click(within(helpMenu()).getByRole('button', { name: 'Check for Updates' }));
    });
    const dialog = screen.getByRole('dialog', { name: 'Software update' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not reach GitHub.');
  });

  it('announces errors with an alert and offers a retry', () => {
    const { bridge, emit } = installBridge();
    render(<App />);
    fireEvent.click(within(helpMenu()).getByRole('button', { name: 'Check for Updates' }));
    emit({ state: 'error', message: 'Could not reach GitHub.' });
    const dialog = screen.getByRole('dialog', { name: 'Software update' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not reach GitHub.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(bridge.updater.check).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape, restores focus, and announces later progress in the status bar', () => {
    const { emit } = installBridge();
    render(<App />);
    const opener = within(helpMenu()).getByRole('button', { name: 'Check for Updates' });
    opener.focus();
    fireEvent.click(opener);
    emit({ state: 'update-available', version: '9.9.9', releaseNotes: '' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    emit({ state: 'download-progress', percent: 55 });
    expect(within(screen.getByLabelText('Status bar')).getByRole('status')).toHaveTextContent(
      'Downloading update: 50 percent complete.',
    );
  });

  it('ignores malformed status messages', () => {
    const { emit } = installBridge();
    render(<App />);
    fireEvent.click(within(helpMenu()).getByRole('button', { name: 'Check for Updates' }));
    emit({ state: 'update-available', version: 42 });
    expect(screen.getByRole('dialog')).not.toHaveTextContent('is available');
  });

  it('opens the update dialog from the native Help menu and the command palette', () => {
    const { bridge, menu } = installBridge();
    render(<App />);
    menu('check-for-updates');
    expect(screen.getByRole('dialog', { name: 'Software update' })).toBeInTheDocument();
    expect(bridge.updater.check).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    menu('not-a-real-command');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const palette = screen.getByRole('dialog', { name: 'Command palette' });
    fireEvent.click(within(palette).getByRole('button', { name: 'Check for Updates' }));
    expect(screen.getByRole('dialog', { name: 'Software update' })).toBeInTheDocument();
    expect(bridge.updater.check).toHaveBeenCalledTimes(2);
  });
});
