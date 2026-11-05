import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

const vault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Research',
      path: 'Research',
      kind: 'notebook',
      children: [{ name: 'Idea.md', path: 'Research/Idea.md', kind: 'note', provenance: 'created' }],
    },
    {
      name: 'Archive',
      path: 'Archive',
      kind: 'notebook',
      children: [{ name: 'Old.md', path: 'Archive/Old.md', kind: 'note', provenance: 'created' }],
    },
  ],
};

function renderLibrary(initialVault: VaultInfo | null) {
  let menuListener: ((command: MenuCommand) => void) | undefined;
  const bridge = {
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
    },
    vault: {
      ...vaultExtensions(),
      get: vi.fn(async () => initialVault),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getRecentLibraries: vi.fn(async () => []),
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async () => '# Idea\n\nIdea again'),
      readAttachment: vi.fn(async () => ({ path: 'Research/Idea.md', text: 'Idea', kind: 'text' })),
      rename: vi.fn(),
      delete: vi.fn(),
      open: vi.fn(async () => vault),
      onSecurityLocked: vi.fn(() => () => undefined),
      unlockVault: vi.fn(async () => vault),
    },
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      menuListener = callback;
      return () => {
        menuListener = undefined;
      };
    },
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
  render(<App />);
  return { menu: (command: MenuCommand) => act(() => menuListener?.(command)), bridge };
}

async function openNotebook() {
  await screen.findByRole('heading', { name: 'Study', level: 2 });
  fireEvent.keyDown(await screen.findByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
  await screen.findByText('Items in Research');
}

describe('Quick Task prompts when no notebook is open', () => {
  it('prompts for a notebook on the landing grid instead of using the remembered notebook', async () => {
    const { menu, bridge } = renderLibrary(vault);
    await openNotebook();
    // Back to the Notebooks landing grid: the remembered notebook path
    // stays in state, but no notebook is visibly open anymore.
    menu('show-notebooks');
    await screen.findByRole('grid', { name: 'Notebooks' });
    menu('quick-task');
    expect(screen.getByRole('dialog', { name: 'Quick Task notebook' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Quick Task' })).not.toBeInTheDocument();
    expect(bridge.vault.createTask).not.toHaveBeenCalled();
  });

  it('opens the task dialog directly when a notebook is open', async () => {
    const { menu } = renderLibrary(vault);
    await openNotebook();
    menu('quick-task');
    expect(screen.getByRole('dialog', { name: 'Quick Task' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Quick Task notebook' })).not.toBeInTheDocument();
  });

  it('asks for a library first when none is open, then a notebook', async () => {
    const { menu } = renderLibrary(null);
    await screen.findByRole('tab', { name: 'Libraries' });
    menu('quick-task');
    expect(screen.getByRole('dialog', { name: 'Quick Task library' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open library…' }));
    expect(await screen.findByRole('dialog', { name: 'Quick Task notebook' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Quick Task' })).not.toBeInTheDocument();
  });
});
