import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { refreshPdfReadingPreferences, usePdfReadingPreferences } from '../renderer/hooks/usePdfReadingPreferences';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { NotebookBridge } from '../shared/bridge';
import type { PdfReadingPreferences } from '../shared/pdf-reading-preferences';

const exposed = { hideHeadersFooters: false, hidePageNumbers: false };
const headersLabel = 'Hide running headers/footers from assistive technology';
const numbersLabel = 'Hide printed page numbers from assistive technology';

function setup(initial = exposed) {
  let stored = { ...initial };
  let changed: ((value: PdfReadingPreferences) => void) | undefined;
  const unsubscribe = vi.fn();
  const get = vi.fn(async () => stored);
  const set = vi.fn(async (value: PdfReadingPreferences) => {
    stored = value;
    return stored;
  });
  window.a11yNotebook = {
    vault: {},
    getPdfReadingPreferences: get,
    setPdfReadingPreferences: set,
    onPdfReadingPreferencesChanged: (callback: (value: PdfReadingPreferences) => void) => {
      changed = callback;
      return unsubscribe;
    },
  } as unknown as NotebookBridge;
  return { get, set, unsubscribe, notify: (value: PdfReadingPreferences) => changed?.(value) };
}

function PreferenceConsumer() {
  const preferences = usePdfReadingPreferences();
  return <output aria-label="Cached preferences">{JSON.stringify(preferences)}</output>;
}

function openSettings() {
  return render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.a11yNotebook;
  vi.restoreAllMocks();
});

describe('PDF reading settings', () => {
  it('loads persisted values on open and saves toggles independently for all consumers', async () => {
    const api = setup({ hideHeadersFooters: true, hidePageNumbers: false });
    render(<PreferenceConsumer />);
    const dialog = openSettings();
    const headers = screen.getByRole('checkbox', { name: headersLabel });
    const numbers = screen.getByRole('checkbox', { name: numbersLabel });
    await waitFor(() => expect(headers).toBeEnabled());
    expect(headers).toBeChecked();
    expect(numbers).not.toBeChecked();
    expect(screen.getByRole('group', { name: 'PDF Reading' })).toHaveAccessibleDescription(
      'Content remains visible, selectable, and searchable in all views. This only affects screen reader announcements.',
    );

    fireEvent.click(numbers);
    await waitFor(() => expect(api.set).toHaveBeenLastCalledWith({ hideHeadersFooters: true, hidePageNumbers: true }));
    await waitFor(() => expect(numbers).toBeEnabled());
    expect(screen.getByLabelText('Cached preferences')).toHaveTextContent('"hidePageNumbers":true');
    expect(screen.getByText('PDF reading preferences saved.')).toHaveAttribute('role', 'status');

    fireEvent.click(headers);
    await waitFor(() => expect(api.set).toHaveBeenLastCalledWith({ hideHeadersFooters: false, hidePageNumbers: true }));
    await waitFor(() => expect(headers).toBeEnabled());
    dialog.unmount();
    openSettings();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('checkbox', { name: numbersLabel })).toBeChecked();
  });

  it('defaults to exposed and keeps the last saved values on a write failure', async () => {
    const api = setup();
    api.set.mockRejectedValueOnce(new Error('disk unavailable'));
    openSettings();
    const headers = screen.getByRole('checkbox', { name: headersLabel });
    await waitFor(() => expect(headers).toBeEnabled());
    expect(headers).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: numbersLabel })).not.toBeChecked();
    fireEvent.click(headers);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save PDF reading preferences.');
    expect(headers).not.toBeChecked();
  });

  it('shares IPC reads, refreshes on focus and broadcasts, and unsubscribes', async () => {
    const api = setup();
    const view = render(
      <>
        <PreferenceConsumer />
        <PreferenceConsumer />
      </>,
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    api.get.mockResolvedValue({ hideHeadersFooters: true, hidePageNumbers: false });
    fireEvent(window, new Event('focus'));
    await waitFor(() =>
      expect(screen.getAllByLabelText('Cached preferences')[0]).toHaveTextContent('"hideHeadersFooters":true'),
    );
    act(() => api.notify({ hideHeadersFooters: false, hidePageNumbers: true }));
    expect(screen.getAllByLabelText('Cached preferences')[1]).toHaveTextContent('"hidePageNumbers":true');
    view.unmount();
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
    fireEvent(window, new Event('focus'));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite a broadcast with an older pending read', async () => {
    const api = setup();
    let resolve: (value: PdfReadingPreferences) => void = () => undefined;
    api.get.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    render(<PreferenceConsumer />);
    act(() => api.notify({ hideHeadersFooters: true, hidePageNumbers: true }));
    await act(async () => resolve(exposed));
    expect(screen.getByLabelText('Cached preferences')).toHaveTextContent('"hideHeadersFooters":true');
    await act(async () => {
      await refreshPdfReadingPreferences();
    });
  });

  it('clears the save confirmation briefly without changing saved preferences', async () => {
    setup();
    openSettings();
    const toggle = screen.getByRole('checkbox', { name: numbersLabel });
    await waitFor(() => expect(toggle).toBeEnabled());
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(screen.getByText('PDF reading preferences saved.')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('PDF reading preferences saved.')).not.toBeInTheDocument();
    expect(toggle).toBeChecked();
  });
});
