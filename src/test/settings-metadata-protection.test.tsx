import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { NotebookBridge } from '../shared/bridge';
import type { MetadataProtectionStatus } from '../shared/metadata-protection';

afterEach(() => {
  delete window.a11yNotebook;
});
const eligible: MetadataProtectionStatus = {
  enabled: false,
  eligible: true,
  locked: false,
  cleanupRequired: false,
  protectedStores: [],
};
function setup(status = eligible, failure = false) {
  const enable = failure
    ? vi.fn().mockRejectedValue(new Error('Storage failed'))
    : vi.fn().mockResolvedValue({ ...eligible, enabled: true, protectedStores: ['annotations', 'checkpoints'] });
  const extend = vi
    .fn()
    .mockImplementation(async (input: { store: string }) => ({
      ...eligible,
      enabled: true,
      protectedStores: ['annotations', 'checkpoints', input.store],
    }));
  window.a11yNotebook = {
    vault: {
      getMetadataProtectionStatus: vi.fn().mockResolvedValue(status),
      enableMetadataProtection: enable,
      extendMetadataProtection: extend,
    },
  } as unknown as NotebookBridge;
  render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />);
  return { enable, extend };
}
describe('scoped metadata encryption consent', () => {
  it('requires explicit exclusion acknowledgement and announces successful enablement', async () => {
    const { enable } = setup();
    const button = await screen.findByRole('button', { name: 'Enable scoped metadata encryption' });
    expect(button).toBeDisabled();
    expect(enable).not.toHaveBeenCalled();
    expect(screen.getByText(/saved cognitive asset files \(including saved flashcards\)/)).toHaveTextContent(
      'remain plaintext',
    );
    expect(screen.getByText(/saved cognitive asset files \(including saved flashcards\)/)).toHaveTextContent(
      'Reminder defaults',
    );
    expect(screen.getByText(/saved cognitive asset files \(including saved flashcards\)/)).toHaveTextContent(
      'settings (both library and global copies), global preferences',
    );
    expect(screen.getByText(/saved cognitive asset files \(including saved flashcards\)/)).toHaveTextContent(
      'A stable version 3 library recovery envelope is required',
    );
    fireEvent.click(screen.getByLabelText(/I consent to encrypting only Markdown, HTML and PDF annotations/));
    fireEvent.click(button);
    await waitFor(() => expect(enable).toHaveBeenCalledExactlyOnceWith({ acknowledgeExclusions: true }));
    expect(await screen.findByText('Encrypted at rest: annotations, checkpoints.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable scoped metadata encryption' })).not.toBeInTheDocument();
  });
  it.each([
    { ...eligible, eligible: false },
    { ...eligible, locked: true },
  ])('does not enable for ineligible or locked vaults', async (status) => {
    const { enable } = setup(status);
    expect(await screen.findByRole('button', { name: 'Enable scoped metadata encryption' })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: /I consent to encrypting only Markdown, HTML and PDF annotations/ }),
    ).toBeDisabled();
    expect(enable).not.toHaveBeenCalled();
  });
  it('extends protection to reminder defaults only after per-store consent', async () => {
    const { extend } = setup({
      ...eligible,
      enabled: true,
      protectedStores: ['annotations', 'checkpoints'],
    });
    const button = await screen.findByRole('button', { name: 'Encrypt Reminder defaults' });
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Encrypt Milestones' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/I consent to encrypting Reminder defaults/));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(extend).toHaveBeenCalledExactlyOnceWith({ store: 'reminder-defaults', acknowledgeExclusions: true }),
    );
    expect(await screen.findByText(/Reminder defaults are now encrypted at rest/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encrypt Reminder defaults' })).not.toBeInTheDocument();
  });

  it('keeps controls available for retry and does not report success after persistence fails', async () => {
    const { enable } = setup(eligible, true);
    await screen.findByRole('button', { name: 'Enable scoped metadata encryption' });
    fireEvent.click(screen.getByLabelText(/I consent to encrypting only Markdown, HTML and PDF annotations/));
    fireEvent.click(screen.getByRole('button', { name: 'Enable scoped metadata encryption' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not enable metadata encryption');
    expect(enable).toHaveBeenCalledOnce();
    expect(screen.queryByText('Scoped metadata encryption enabled.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable scoped metadata encryption' })).toBeEnabled();
  });
});
