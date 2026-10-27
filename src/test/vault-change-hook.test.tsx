import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVaultChanges } from '../renderer/hooks/useVaultChanges';
import type { OpenNote } from '../renderer/features/vault/open-note';
import type { VaultChangedEvent } from '../shared/search';
import type { VaultInfo } from '../shared/types';
import type { NotebookBridge } from '../shared/bridge';
import { vaultExtensions } from './vault-extensions';

const vault: VaultInfo = { name: 'Vault', path: '/vault', entries: [{ name: 'N.md', path: 'N.md', kind: 'note' }] };
let listener: (event: VaultChangedEvent) => void;
let disk = 'initial';
const announce = vi.fn();
const onContentReplaced = vi.fn();
function Harness() {
  const [notes, setNotes] = useState<OpenNote[]>([
    { id: 'N.md', path: 'N.md', title: 'N', content: 'initial', saved: 'initial' },
  ]);
  const [currentVault, setVault] = useState<VaultInfo | null>(vault);
  const { conflicts } = useVaultChanges(currentVault, notes, setNotes, setVault, announce, onContentReplaced);
  return (
    <>
      <input
        aria-label="Note text"
        value={notes[0].content}
        onChange={(event) => setNotes([{ ...notes[0], content: event.target.value }])}
      />
      <p>{conflicts.length ? 'Conflict pending' : 'No conflicts'}</p>
    </>
  );
}
function setup() {
  disk = 'initial';
  window.a11yNotebook = {
    vault: {
      ...vaultExtensions(),
      get: async () => vault,
      readNote: async () => disk,
      onChanged: (callback: typeof listener) => {
        listener = callback;
        return () => undefined;
      },
    },
  } as unknown as NotebookBridge;
  render(<Harness />);
}
afterEach(() => {
  delete window.a11yNotebook;
  vi.clearAllMocks();
});

describe('external vault change synchronization', () => {
  it('reloads a clean note and ignores a different vault event', async () => {
    setup();
    disk = 'updated';
    act(() => listener({ vaultPath: '/different', paths: ['N.md'] }));
    expect(screen.getByLabelText('Note text')).toHaveValue('initial');
    act(() => listener({ vaultPath: '/vault', paths: ['N.md'] }));
    await waitFor(() => expect(screen.getByLabelText('Note text')).toHaveValue('updated'));
    expect(screen.getByText('No conflicts')).toBeInTheDocument();
  });
  it('preserves dirty edits and opens a conflict instead of overwriting them', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'mine' } });
    disk = 'external';
    act(() => listener({ vaultPath: '/vault', paths: ['N.md'] }));
    await screen.findByText('Conflict pending');
    expect(screen.getByLabelText('Note text')).toHaveValue('mine');
  });
  it('announces a failed library refresh without discarding unsaved edits', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'mine' } });
    window.a11yNotebook!.vault.get = vi.fn().mockRejectedValue(new Error('Read failed'));
    act(() => listener({ vaultPath: '/vault', paths: ['N.md'] }));
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith(
        'Could not refresh external library changes. Your unsaved edits are preserved.',
      ),
    );
    expect(screen.getByLabelText('Note text')).toHaveValue('mine');
  });
  it('does not treat an app save as a conflicting external change', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'mine' } });
    disk = 'mine';
    act(() => listener({ vaultPath: '/vault', paths: ['N.md'] }));
    await waitFor(() => expect(announce).not.toHaveBeenCalled());
    expect(screen.getByText('No conflicts')).toBeInTheDocument();
    // The refresh rewrites identical content, so no replacement is reported.
    expect(onContentReplaced).not.toHaveBeenCalled();
  });
  it('reports a note whose content was replaced, but not a conflict or an identical refresh', async () => {
    setup();
    disk = 'updated';
    act(() => listener({ vaultPath: '/vault', paths: ['N.md'] }));
    await waitFor(() => expect(screen.getByLabelText('Note text')).toHaveValue('updated'));
    expect(onContentReplaced).toHaveBeenCalledWith('N.md');
    expect(onContentReplaced).toHaveBeenCalledTimes(1);
  });
  it('does not report a note kept back by a conflict', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'mine' } });
    disk = 'external';
    act(() => listener({ vaultPath: '/vault', paths: ['N.md'] }));
    await screen.findByText('Conflict pending');
    expect(onContentReplaced).not.toHaveBeenCalled();
  });
});
