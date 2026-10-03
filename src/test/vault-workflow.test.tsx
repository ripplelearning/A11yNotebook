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
  vi.restoreAllMocks();
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
        readNote: vi.fn(async () => '# Week 1\n\nImportant material\n- [ ] Submit'),
        saveNote: vi.fn(async () => undefined),
        createNotebook: vi.fn(async () => vault),
        createNote: vi.fn(async () => vault),
        rename: vi.fn(async () => vault),
        reveal: vi.fn(async () => undefined),
        openExternal: vi.fn(async () => undefined),
        importFile: vi.fn(async () => vault),
        delete: vi.fn(async () => vault),
        getTasks: vi.fn(async () => [
          {
            id: 'Class notes/Week 1.md:4',
            path: 'Class notes/Week 1.md',
            line: 4,
            text: 'Submit',
            complete: false,
          },
        ]),
        toggleTask: vi.fn(async () => [
          {
            id: 'Class notes/Week 1.md:4',
            path: 'Class notes/Week 1.md',
            line: 4,
            text: 'Submit',
            complete: true,
          },
        ]),
        getLinkIndex: vi.fn(async () => ({ links: [] })),
        getBookmarks: vi.fn(async () => []),
        toggleBookmark: vi.fn(async () => [
          {
            id: 'Class notes/Week 1.md',
            path: 'Class notes/Week 1.md',
            title: 'Week 1',
            created: '2026-09-30T00:00:00.000Z',
          },
        ]),
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

    fireEvent.click(screen.getByRole('button', { name: 'Bookmark note' }));
    await waitFor(() => expect(bridge.vault.toggleBookmark).toHaveBeenCalledWith('Class notes/Week 1.md'));
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Note bookmarked.');

    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    const editor = await screen.findByRole('textbox', { name: 'Markdown source' });
    fireEvent.change(editor, { target: { value: '# Week 1\n\nUpdated.\n- [ ] Submit' } });
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    await waitFor(() =>
      expect(bridge.vault.saveNote).toHaveBeenCalledWith('Class notes/Week 1.md', '# Week 1\n\nUpdated.\n- [ ] Submit'),
    );
    expect(
      within(screen.getByRole('tablist', { name: 'Open tabs' })).getByRole('tab', { name: 'Week 1' }),
    ).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(
      within(screen.getByRole('complementary', { name: 'Navigation pane' })).getByRole('button', {
        name: 'Open Tasks',
      }),
    );
    const taskTable = await screen.findByRole('table', { name: 'Markdown checkbox tasks in the open vault' });
    fireEvent.click(within(taskTable).getByRole('checkbox', { name: 'Submit' }));
    await waitFor(() => expect(bridge.vault.toggleTask).toHaveBeenCalledWith('Class notes/Week 1.md', 4, true));
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Task marked complete.');

    fireEvent.click(within(screen.getByRole('tablist', { name: 'Open tabs' })).getByRole('tab', { name: 'Week 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown source' }), {
      target: { value: '# Week 1\n\nUnsaved changes.' },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const openVault = screen.getByRole('button', { name: 'Open vault' });
    fireEvent.click(openVault);
    expect(confirm).toHaveBeenCalledWith('Opening another vault will discard unsaved note changes. Continue?');
    expect(bridge.vault.open).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(openVault);
    await waitFor(() => expect(bridge.vault.open).toHaveBeenCalledTimes(1));
  });
});
