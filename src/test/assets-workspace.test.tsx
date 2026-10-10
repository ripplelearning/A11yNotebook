import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetsWorkspace from '../renderer/features/assets/AssetsWorkspace';
import type { NotebookBridge } from '../shared/bridge';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
});

function setup() {
  const vault = vaultExtensions();
  vault.readAsset.mockImplementation(async (path: string) => ({
    path,
    type: 'flashcards',
    content: path === 'First.cards.md' ? 'Alpha :: One\nBeta :: Two\n' : 'Gamma :: Three\n',
  }));
  window.a11yNotebook = { vault } as unknown as NotebookBridge;
  const props = {
    paths: ['First.cards.md', 'Second.cards.md'],
    initialPath: 'First.cards.md',
    selectionVersion: 0,
    refresh: vi.fn(async () => undefined),
    announce: vi.fn(),
    onDirty: vi.fn(),
    onBusy: vi.fn(),
  };
  return { vault, props, ...render(<AssetsWorkspace {...props} />) };
}

describe('vault-backed cognitive workspace', () => {
  it('debounces encrypted editor checkpoints and does not save source', async () => {
    const { vault, props, unmount } = setup();
    const checkpoint = vi.fn(async () => ({}) as never);
    window.a11yNotebook!.vault.readAssetDraft = vi.fn(async () => ({ enabled: true, token: 'session', draft: null }));
    window.a11yNotebook!.vault.checkpointAssetDraft = checkpoint;
    await screen.findByText('Alpha');
    await waitFor(() =>
      expect(
        screen.queryByText('Encrypted recovery is off. Unsaved changes stay only in this view.'),
      ).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText('Flashcard deck source'), { target: { value: 'One :: Edit\n' } });
    fireEvent.change(screen.getByLabelText('Flashcard deck source'), { target: { value: 'Newest :: Edit\n' } });
    expect(checkpoint).not.toHaveBeenCalled();
    await waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(checkpoint).toHaveBeenCalledWith(
      {
        path: 'First.cards.md',
        type: 'flashcards',
        baselineContent: 'Alpha :: One\nBeta :: Two\n',
        content: 'Newest :: Edit\n',
      },
      'session',
    );
    expect(vault.saveAsset).not.toHaveBeenCalled();
    expect(props.onDirty).toHaveBeenLastCalledWith(true);
    unmount();
  });

  it('offers accessible explicit compare and restores conflicts as unsaved edits without saving', async () => {
    const vault = vaultExtensions();
    vault.readAsset.mockResolvedValue({ path: 'Plan.cards.md', type: 'flashcards', content: 'Disk :: Current\n' });
    const discard = vi.fn(async () => undefined);
    const checkpoint = vi.fn(async () => ({}) as never);
    window.a11yNotebook = {
      vault: {
        ...vault,
        readAssetDraft: vi.fn(async () => ({
          enabled: true,
          token: 'session',
          draft: {
            path: 'Plan.cards.md',
            type: 'flashcards',
            revision: 'revision',
            updatedAt: '2026-10-10T00:00:00.000Z',
            expiresAt: '2026-10-17T00:00:00.000Z',
            baselineHash: 'hash',
            baselineContent: 'Before :: Baseline\n',
            content: 'Recovered :: Unsaved\n',
          },
        })),
        checkpointAssetDraft: checkpoint,
        discardAssetDraft: discard,
      },
    } as unknown as NotebookBridge;
    const announce = vi.fn();
    render(
      <AssetsWorkspace
        paths={['Plan.cards.md']}
        initialPath="Plan.cards.md"
        refresh={async () => undefined}
        announce={announce}
        onDirty={vi.fn()}
        onBusy={vi.fn()}
      />,
    );
    await screen.findByRole('heading', { name: 'Recover unsaved asset changes' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore as unsaved changes' })).toHaveFocus());
    expect(announce).toHaveBeenCalledWith(
      'Unsaved asset checkpoint from 2026-10-10T00:00:00.000Z found. Restore, discard, or compare it.',
    );
    expect(screen.getByLabelText('Flashcard deck source')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Compare recovered draft' }));
    expect(screen.getByLabelText('Checkpoint baseline')).toHaveValue('Before :: Baseline\n');
    expect(screen.getByLabelText('Current source')).toHaveValue('Disk :: Current\n');
    const restore = screen.getByRole('button', { name: 'Restore as unsaved changes' });
    restore.focus();
    expect(restore).toHaveFocus();
    fireEvent.keyDown(restore, { key: 'Enter' });
    fireEvent.click(restore, { detail: 0 });
    expect(screen.getByLabelText('Flashcard deck source')).toHaveValue('Recovered :: Unsaved\n');
    expect(screen.getByLabelText('Flashcard deck source')).toHaveFocus();
    expect(screen.getByText('Unsaved asset changes.')).toBeInTheDocument();
    expect(vault.saveAsset).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith('Draft restored as unsaved changes. The source file was not changed.');
  });

  it('discards recovery by revision without writing a source file', async () => {
    const vault = vaultExtensions();
    vault.readAsset.mockResolvedValue({ path: 'Plan.cards.md', type: 'flashcards', content: 'Disk :: Current\n' });
    const discard = vi.fn(async () => undefined);
    let discarded = false;
    discard.mockImplementation(async () => {
      discarded = true;
    });
    window.a11yNotebook = {
      vault: {
        ...vault,
        readAssetDraft: vi.fn(async () => ({
          enabled: true,
          token: 'session',
          draft: discarded
            ? null
            : {
                path: 'Plan.cards.md',
                type: 'flashcards',
                revision: 'revision',
                updatedAt: '2026-10-10T00:00:00.000Z',
                expiresAt: '2026-10-17T00:00:00.000Z',
                baselineHash: 'hash',
                baselineContent: 'Disk :: Current\n',
                content: 'Recovered :: Unsaved\n',
              },
        })),
        discardAssetDraft: discard,
      },
    } as unknown as NotebookBridge;
    render(
      <AssetsWorkspace
        paths={['Plan.cards.md']}
        initialPath="Plan.cards.md"
        refresh={async () => undefined}
        announce={vi.fn()}
        onDirty={vi.fn()}
        onBusy={vi.fn()}
      />,
    );
    await screen.findByRole('heading', { name: 'Recover unsaved asset changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard recovered draft' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Recover unsaved asset changes' })).not.toBeInTheDocument(),
    );
    expect(discard).toHaveBeenCalledWith('Plan.cards.md', 'revision', 'session');
    await waitFor(() => expect(screen.getByLabelText('Flashcard deck source')).toHaveFocus());
    expect(vault.saveAsset).not.toHaveBeenCalled();
  });

  it('loads a newly requested asset instead of retaining the previous file', async () => {
    const { props, rerender } = setup();
    await screen.findByText('Alpha');
    rerender(<AssetsWorkspace {...props} initialPath="Second.cards.md" selectionVersion={1} />);
    await screen.findByText('Gamma');
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Asset file' })).toHaveValue('Second.cards.md');
  });

  it('blocks switching and deck edits until a card rating is persisted', async () => {
    const { props } = setup();
    let finish: () => void = () => undefined;
    vi.mocked(window.a11yNotebook!.vault.saveFlashcardSchedule).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    expect(screen.getByRole('combobox', { name: 'Asset file' })).toBeDisabled();
    expect(screen.getByLabelText('Flashcard deck source')).toBeDisabled();
    expect(props.onBusy).toHaveBeenLastCalledWith(true);
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Asset file' })).not.toBeDisabled());
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('reloads fingerprint-mapped schedules and resets review state after deck edits', async () => {
    const { vault } = setup();
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    await screen.findByText('Beta');
    const schedule = vi.mocked(window.a11yNotebook!.vault.saveFlashcardSchedule).mock.calls[0][2];
    vi.mocked(window.a11yNotebook!.vault.getFlashcardSchedules).mockResolvedValue({ 'card-2': schedule });
    fireEvent.change(screen.getByLabelText('Flashcard deck source'), {
      target: { value: 'New :: Answer\nAlpha :: One\nBeta :: Two\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save flashcard deck' }));
    await screen.findByText('New');
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(vault.getFlashcardSchedules).toHaveBeenCalledTimes(2);
  });
});
