import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings';
import SecurityGate from '../renderer/features/security/SecurityGate';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';

describe('security controls', () => {
  it('requires a password to unlock and reports authentication failures', async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error('wrong password'));
    render(<SecurityGate onUnlock={onUnlock} />);
    fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'wrong password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect');
    expect(onUnlock).toHaveBeenCalledWith('wrong password');
  });

  it('saves configurable idle and unsaved-edit lock delays', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/Vault idle lock in minutes/), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/Lock editing after unsaved changes/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      vaultLockMinutes: 25,
      noteEditLockMinutes: 3,
    })));
    expect(onClose).toHaveBeenCalled();
  });
});
