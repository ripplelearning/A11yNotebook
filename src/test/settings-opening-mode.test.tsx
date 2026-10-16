import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { DEFAULT_SETTINGS } from '../shared/settings';

afterEach(() => {
  delete window.a11yNotebook;
});

describe('default note opening preference', () => {
  it('exposes Read mode for legacy settings and saves Edit mode through validated settings', async () => {
    const legacy = { ...DEFAULT_SETTINGS };
    delete legacy.defaultNoteOpenMode;
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SettingsDialog settings={legacy} onSave={onSave} onClose={onClose} />);
    const select = screen.getByRole('combobox', { name: 'Default Open behavior for notes' });
    expect(select).toHaveValue('read');
    fireEvent.change(select, { target: { value: 'edit' } });
    fireEvent.submit(select.closest('form')!);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ defaultNoteOpenMode: 'edit' })));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('retains the dialog and chosen preference if saving fails', async () => {
    const onClose = vi.fn();
    render(
      <SettingsDialog
        settings={{ ...DEFAULT_SETTINGS, defaultNoteOpenMode: 'edit' }}
        onSave={vi.fn().mockRejectedValue(new Error('Write failed'))}
        onClose={onClose}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Default Open behavior for notes' });
    fireEvent.submit(select.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save settings.');
    expect(select).toHaveValue('edit');
    expect(onClose).not.toHaveBeenCalled();
  });
});
