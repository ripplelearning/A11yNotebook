import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';

const vault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Class notes',
      path: 'Class notes',
      kind: 'notebook',
      children: [{ name: 'Week 1.md', path: 'Class notes/Week 1.md', kind: 'note' }],
    },
  ],
};

afterEach(() => {
  delete window.a11yNotebook;
});

describe('local vault workflow', () => {
  it('opens a note, edits its Markdown source, and saves through the typed bridge', async () => {
    const bridge: NotebookBridge = {
      updater: {
        check: vi.fn(async () => undefined),
        download: vi.fn(async () => undefined),
        installNow: vi.fn(async () => undefined),
        installOnExit: vi.fn(async () => undefined),
        onStatus: vi.fn(() => () => undefined),
      },
      vault: {
        open: vi.fn(async () => vault),
        get: vi.fn(async () => vault),
        readNote: vi.fn(async () => '# Week 1\n\nImportant material'),
        saveNote: vi.fn(async () => undefined),
        createNotebook: vi.fn(async () => vault),
        createNote: vi.fn(async () => vault),
        rename: vi.fn(async () => vault),
        reveal: vi.fn(async () => undefined),
        openExternal: vi.fn(async () => undefined),
        importFile: vi.fn(async () => vault),
        delete: vi.fn(async () => vault),
      },
      onMenuCommand: vi.fn(() => () => undefined),
    };
    window.a11yNotebook = bridge;
    render(<App />);

    await screen.findByRole('heading', { name: 'Study' });
    const folder = screen.getByRole('treeitem', { name: /Class notes/ });
    fireEvent.click(folder);
    fireEvent.click(screen.getByRole('treeitem', { name: /Week 1.md/ }));
    expect(await screen.findByRole('heading', { name: 'Week 1', level: 2 })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = await screen.findByRole('textbox', { name: 'Markdown source' });
    fireEvent.change(editor, { target: { value: '# Week 1\n\nUpdated.' } });
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    await waitFor(() =>
      expect(bridge.vault.saveNote).toHaveBeenCalledWith('Class notes/Week 1.md', '# Week 1\n\nUpdated.'),
    );
    expect(
      within(screen.getByRole('tablist', { name: 'Open tabs' })).getByRole('tab', { name: 'Week 1' }),
    ).toHaveAttribute('aria-selected', 'true');
  });
});
