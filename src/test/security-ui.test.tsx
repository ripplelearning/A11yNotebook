import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings';
import SecurityGate from '../renderer/features/security/SecurityGate';
import NotePasswordDialog, { generateNotePassword } from '../renderer/features/security/NotePasswordDialog';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';

describe('security controls', () => {
  it('generates a 24-character password and clears copied secrets only if unchanged', async () => {
    const password = generateNotePassword();
    expect(password).toHaveLength(24);
    expect(() => generateNotePassword(7)).toThrow();
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(password),
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    vi.useFakeTimers();
    try {
      render(<NotePasswordDialog action="encrypt" noteName="Research" onSubmit={vi.fn()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Generate password' }));
      const input = screen.getByLabelText('Note password');
      const generated = (input as HTMLInputElement).value;
      expect(generated).toMatch(/^[A-Za-z0-9!@#$%^&*()\-_=+]{24}$/);
      clipboard.readText.mockResolvedValue(generated);
      fireEvent.click(screen.getByRole('button', { name: 'Copy generated password' }));
      await Promise.resolve();
      expect(clipboard.writeText).toHaveBeenCalledWith(generated);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(clipboard.writeText).toHaveBeenLastCalledWith('');
    } finally {
      vi.useRealTimers();
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('requires a password to unlock and reports authentication failures', async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error('wrong password'));
    render(<SecurityGate onUnlock={onUnlock} />);
    fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'wrong password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect');
    expect(onUnlock).toHaveBeenCalledWith('wrong password');
  });

  it('provides a keyboard-focused recovery reset path when a recovery key exists', async () => {
    const onRecover = vi.fn().mockResolvedValue(undefined);
    render(<SecurityGate onUnlock={vi.fn()} recoveryAvailable onRecover={onRecover} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use recovery key' }));
    const keyInput = screen.getByLabelText('Vault recovery key');
    await waitFor(() => expect(keyInput).toHaveFocus());
    fireEvent.change(keyInput, { target: { value: 'A'.repeat(43) } });
    fireEvent.change(screen.getByLabelText('New vault password (at least 8 characters)'), {
      target: { value: 'new vault password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new vault password'), {
      target: { value: 'new vault password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password and unlock' }));
    await waitFor(() => expect(onRecover).toHaveBeenCalledWith('A'.repeat(43), 'new vault password'));
  });

  it('requires explicit acknowledgment before committing a displayed recovery key', async () => {
    const onPrepareRecovery = vi.fn().mockResolvedValue('A'.repeat(43));
    const onAcknowledgeRecovery = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsDialog
        settings={DEFAULT_SETTINGS}
        onSave={vi.fn()}
        onClose={vi.fn()}
        securityEnabled
        onPrepareRecovery={onPrepareRecovery}
        onAcknowledgeRecovery={onAcknowledgeRecovery}
      />,
    );
    fireEvent.change(screen.getByLabelText('Current vault password'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable vault recovery' }));
    const keyInput = await screen.findByLabelText('One-time vault recovery key');
    await waitFor(() => expect(keyInput).toHaveValue('A'.repeat(43)));
    await waitFor(() => expect(keyInput).toHaveFocus());
    const confirm = screen.getByRole('button', { name: 'Confirm saved recovery key' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I have saved this recovery key somewhere secure'));
    fireEvent.click(confirm);
    await waitFor(() => expect(onAcknowledgeRecovery).toHaveBeenCalledOnce());
    expect(await screen.findByRole('alert')).toHaveTextContent('Recovery key saved and enabled.');
  });

  it('saves configurable idle and unsaved-edit lock delays', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/Vault idle lock in minutes/), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/Lock editing after unsaved changes/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          vaultLockMinutes: 25,
          noteEditLockMinutes: 3,
        }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('requires a confirmed note password before encrypting a note', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NotePasswordDialog action="encrypt" noteName="Research" onSubmit={onSubmit} onClose={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Encrypt note' });
    fireEvent.change(screen.getByLabelText('Note password'), { target: { value: 'private note password' } });
    fireEvent.change(screen.getByLabelText('Confirm note password'), { target: { value: 'different password' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirm note password'), {
      target: { value: 'private note password' },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('private note password'));
  });

  it('shows note-password errors without closing the unlock dialog', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Incorrect note password.'));
    render(<NotePasswordDialog action="unlock" noteName="Research" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Note password'), { target: { value: 'wrong password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect note password.');
    expect(screen.getByRole('heading', { name: 'Unlock encrypted note' })).toBeInTheDocument();
  });
});
