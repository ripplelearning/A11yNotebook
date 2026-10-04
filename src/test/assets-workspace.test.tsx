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
