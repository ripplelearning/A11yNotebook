import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { DEFAULT_SETTINGS } from '../shared/settings';

describe('default note open mode settings', () => {
  it('shows Read mode for legacy settings and saves Edit mode', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <SettingsDialog
        settings={{ autosaveDelay: 900, theme: 'dark', fontSize: 16, shortcuts: {} }}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Default note open mode' });
    expect(select).toHaveValue('read-only');
    expect(screen.getByRole('option', { name: 'Read mode' })).toHaveValue('read-only');
    expect(screen.getByRole('option', { name: 'Edit mode' })).toHaveValue('edit');
    fireEvent.change(select, { target: { value: 'edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, defaultNoteOpenMode: 'edit' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('loads a saved Edit mode and resets it to Read mode', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsDialog
        settings={{ ...DEFAULT_SETTINGS, defaultNoteOpenMode: 'edit' }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Default note open mode' });
    expect(select).toHaveValue('edit');
    fireEvent.click(screen.getByRole('button', { name: 'Reset all settings' }));
    expect(select).toHaveValue('read-only');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(DEFAULT_SETTINGS));
  });
});
