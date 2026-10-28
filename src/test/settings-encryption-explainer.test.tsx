import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';

describe('Settings encryption explainer', () => {
  it('keeps the long encryption explainer collapsed and outside any live region', async () => {
    (window as unknown as { a11yNotebook: unknown }).a11yNotebook = {
      vault: {
        getMetadataProtectionStatus: async () => ({
          enabled: true,
          protectedStores: [],
          cleanupRequired: false,
        }),
      },
    };
    const { container } = render(
      <SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    const details = await screen.findByText('About scoped metadata encryption');
    expect(details.tagName).toBe('SUMMARY');
    const detailsElement = details.closest('details');
    expect(detailsElement).not.toBeNull();
    expect(detailsElement!.open).toBe(false);
    expect(detailsElement).toHaveTextContent('This is not whole-library encryption.');
    const live = container.querySelectorAll('[aria-live], [role="status"], [role="alert"]');
    for (const element of Array.from(live)) {
      expect(element.textContent ?? '').not.toContain('This is not whole-library encryption.');
    }
    delete (window as unknown as { a11yNotebook?: unknown }).a11yNotebook;
  });
});
