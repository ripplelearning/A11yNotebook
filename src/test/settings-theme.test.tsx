import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { DEFAULT_SETTINGS } from '../shared/settings';

describe('Settings theme option', () => {
  it('saves the Light theme when the Theme select changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <SettingsDialog
        settings={DEFAULT_SETTINGS}
        onSave={onSave}
        onClose={onClose}
        onShortcutCaptureChange={vi.fn()}
      />,
    );
    const themeSelect = screen.getByLabelText('Theme', { selector: 'select' }) as HTMLSelectElement;
    expect(themeSelect.value).toBe('dark');
    fireEvent.change(themeSelect, { target: { value: 'light' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' })));
  });
});
