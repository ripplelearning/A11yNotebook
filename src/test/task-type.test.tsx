import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

function renderLibrary(initialVault: VaultInfo, onCreateTask?: (text: string, notebookPath?: string) => void) {
  let vault = initialVault;
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
      get: vi.fn(async () => vault),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      isNoteEncrypted: vi.fn(async () => false),
      readNote: vi.fn(async () => '# Checklist\n\n- [ ] Buy milk\n'),
      readAttachment: vi.fn(async () => ({ path: 'Research/Checklist.md', text: 'Checklist', kind: 'text' })),
      createTask: vi.fn(async ({ notebookPath, text }: { notebookPath?: string; text: string }) => {
        onCreateTask?.(text, notebookPath);
        return [{ text, complete: false, path: `${notebookPath}/${text}.md` }];
      }),
      rename: vi.fn(),
      delete: vi.fn(),
      open: vi.fn(),
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
  return {
    menu: (command: MenuCommand) => act(() => menuListener?.(command)),
    setVault: (next: VaultInfo) => {
      vault = next;
    },
  };
}

async function openNotebook() {
  await screen.findByRole('heading', { name: 'Study', level: 2 });
  fireEvent.keyDown(await screen.findByRole('gridcell', { name: 'Research' }), { key: 'Enter' });
  await screen.findByText('Items in Research');
  return screen.getByRole('grid', { name: 'Notes and files' });
}

const researchVault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Research',
      path: 'Research',
      kind: 'notebook',
      children: [
        { name: 'Buy milk.md', path: 'Research/Buy milk.md', kind: 'note', provenance: 'task' },
        { name: 'Checklist.md', path: 'Research/Checklist.md', kind: 'note', provenance: 'created' },
        { name: 'Plain.md', path: 'Research/Plain.md', kind: 'note', provenance: 'created' },
      ],
    },
  ],
};

describe('task Type in Notes and Files', () => {
  it('shows Task only for the note created as a task', async () => {
    renderLibrary(researchVault);
    const grid = await openNotebook();
    expect(within(grid).getByRole('gridcell', { name: 'Task' })).toBeInTheDocument();
    expect(within(grid).getAllByRole('gridcell', { name: 'note' })).toHaveLength(2);
  });

  it('shows Task for a note just created with Quick Task', async () => {
    const vault: VaultInfo = {
      name: 'Study',
      path: 'C:/Study',
      entries: [
        {
          name: 'Research',
          path: 'Research',
          kind: 'notebook',
          children: [
            { name: 'Checklist.md', path: 'Research/Checklist.md', kind: 'note', provenance: 'created' },
            { name: 'Plain.md', path: 'Research/Plain.md', kind: 'note', provenance: 'created' },
          ],
        },
      ],
    };
    const { menu } = renderLibrary(vault, (text, notebookPath) => {
      const notebook = vault.entries.find((entry) => entry.path === notebookPath);
      notebook?.children?.push({
        name: `${text}.md`,
        path: `${notebookPath}/${text}.md`,
        kind: 'note',
        provenance: 'task',
      });
    });
    const grid = await openNotebook();
    menu('quick-task');
    expect(screen.getByRole('dialog', { name: 'Quick Task' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Quick Task' }), { target: { value: 'Buy milk' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await screen.findByRole('gridcell', { name: 'Buy milk.md' })).toBeInTheDocument();
    expect(within(grid).getByRole('gridcell', { name: 'Task' })).toBeInTheDocument();
  });
});
