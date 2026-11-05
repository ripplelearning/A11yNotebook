import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';
import { openTreeLeaf } from './library-navigation';

afterEach(() => {
  delete window.a11yNotebook;
});

function setup() {
  const content = '# Note\n\ntext';
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [{ name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' }],
  };
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => content),
      saveNote: vi.fn(async () => undefined),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      rename: vi.fn(async () => vault),
      delete: vi.fn(async () => vault),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => null),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getCalendar: vi.fn(async () => []),
      saveCalendar: vi.fn(async (appointments: unknown) => appointments),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      unlockVault: vi.fn(async () => vault),
      onSecurityLocked: () => () => undefined,
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, showCommandButtons: true, autosaveDelay: 0 })),
      search: vi.fn(async () => []),
    },
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: () => () => undefined,
    },
    onMenuCommand: () => () => undefined,
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  render(<App />);
}

describe('settings dialog title', () => {
  it('names the settings dialog in document.title while open', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Study' });
    await openTreeLeaf(/Note.md/);
    await screen.findByRole('heading', { name: 'Note', level: 2 });
    expect(document.title).toBe('Note | Study | A11y Notebook');
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true, altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(document.title).toBe('Settings | A11y Notebook');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await screen.findByRole('heading', { name: 'Note', level: 2 });
    expect(document.title).toBe('Note | Study | A11y Notebook');
  });
});
