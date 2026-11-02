import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { DEFAULT_SETTINGS } from '../shared/settings';

describe('Settings interaction options', () => {
  it('saves Immersive Focus mode and auto-focus on grids when both are checked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsDialog
        settings={DEFAULT_SETTINGS}
        onSave={onSave}
        onClose={vi.fn()}
        onShortcutCaptureChange={vi.fn()}
      />,
    );
    const immersive = screen.getByLabelText('Immersive Focus mode') as HTMLInputElement;
    const autoFocus = screen.getByLabelText(
      'Auto-focus on grids when switching views',
    ) as HTMLInputElement;
    expect(immersive.checked).toBe(false);
    expect(autoFocus.checked).toBe(false);
    fireEvent.click(immersive);
    fireEvent.click(autoFocus);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ immersiveFocusMode: true, autoFocusGridsOnViewSwitch: true }),
      ),
    );
  });
});
