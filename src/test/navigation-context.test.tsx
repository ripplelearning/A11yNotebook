import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import { vaultExtensions } from './vault-extensions';
import { DEFAULT_SETTINGS } from '../shared/settings';

afterEach(() => {
  delete window.a11yNotebook;
});

function setup(hasLibrary = true, editByDefault = false) {
  const vault: VaultInfo = {
    path: '/study',
    name: 'Study',
    entries: [{ name: 'Research', path: 'Research', kind: 'notebook', children: [] }],
  };
  window.a11yNotebook = {
    onMenuCommand: vi.fn(() => () => undefined),
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    vault: {
      ...vaultExtensions(),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, defaultNoteOpenMode: editByDefault ? 'edit' : 'read' })),
      get: vi.fn(async () => (hasLibrary ? vault : null)),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
    },
  } as unknown as NotebookBridge;
  render(<App />);
}

function navigate(key: string) {
  fireEvent.keyDown(document.body, { key, ctrlKey: true });
}

describe('contextual navigation names and repeated focus', () => {
  it('names the library, notebook list, and selected notebook view truthfully', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Study' });
    navigate('1');
    const libraries = screen.getByRole('tabpanel', { name: 'Study' });
    expect(within(libraries).getByRole('heading', { name: 'Study' })).toBeInTheDocument();
    navigate('2');
    const notebooks = screen.getByRole('tabpanel', { name: 'Notebooks in Study' });
    expect(within(notebooks).getByRole('heading', { name: 'Notebooks in Study' })).toBeInTheDocument();
    fireEvent.click(within(notebooks).getByRole('gridcell', { name: 'Research' }));
    navigate('3');
    const files = screen.getByRole('tabpanel', { name: 'Notes and Files in Research' });
    expect(within(files).getByRole('heading', { name: 'Notes and Files in Research' })).toBeInTheDocument();
    await waitFor(() => expect(files).toHaveFocus());
    const focus = vi.fn();
    files.addEventListener('focus', focus);
    const status = screen.getByLabelText('Status bar').textContent;
    navigate('3');
    await waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(files).toHaveFocus();
    expect(screen.getByLabelText('Status bar').textContent).toBe(status);
    files.removeEventListener('focus', focus);
  });

  it('uses clear fallback names without a library or notebook', async () => {
    setup(false);
    await waitFor(() => expect(window.a11yNotebook!.vault.get).toHaveBeenCalled());
    for (const [key, name] of [
      ['1', 'Libraries'],
      ['2', 'Notebooks'],
      ['3', 'Notes and Files'],
      ['4', 'Tasks'],
      ['5', 'Cognitive Tools'],
    ]) {
      navigate(key);
      expect(screen.getByRole('tabpanel', { name })).toHaveFocus();
      expect(within(screen.getByRole('tabpanel', { name })).getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  it('disables direct note creation without a selected notebook and explains contextual New', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Study' });
    navigate('3');
    const view = within(screen.getByRole('tabpanel'));
    expect(view.getByRole('button', { name: 'New note' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'New note from template' })).toBeDisabled();
    navigate('n');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Select a notebook before creating a note.');
  });

  it('never describes a view without a note editor as editable', async () => {
    setup(true, true);
    await screen.findByRole('heading', { name: 'Study' });
    navigate('3');
    navigate('e');
    expect(screen.getByText('Mode: read-only')).toBeInTheDocument();
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('This view has no note editor.');
  });

  it('blocks native creation while a reminder alert dialog owns focus', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Study' });
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alertdialog');
    document.body.append(alert);
    try {
      const dispatch = vi.mocked(window.a11yNotebook!.onMenuCommand).mock.calls[0][0];
      dispatch('new-task');
      expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument();
    } finally {
      alert.remove();
    }
  });

  it('does not hijack navigation or contextual New in editable controls', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Study' });
    const input = screen.getByRole('searchbox', { name: 'Global search' });
    input.focus();
    for (const key of ['1', '2', '3', 'n']) fireEvent.keyDown(input, { key, ctrlKey: true });
    expect(input).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Welcome' })).toBeInTheDocument();
  });
});
