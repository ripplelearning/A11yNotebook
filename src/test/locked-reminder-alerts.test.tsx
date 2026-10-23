import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LockedReminderAlerts from '../renderer/features/reminders/LockedReminderAlerts';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultReminderEvent } from '../shared/reminders';
import { DEFAULT_SETTINGS as BASE_SETTINGS } from '../shared/settings';

const SETTINGS = { ...BASE_SETTINGS, reminderAlerts: true, reminderSound: true };
let listener: (event: VaultReminderEvent) => void;
let focused = true;
let audio: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; volume: number };

beforeEach(() => {
  focused = true;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  audio = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), volume: 0 };
  vi.stubGlobal(
    'Audio',
    vi.fn(function () {
      return audio;
    }),
  );
  window.a11yNotebook = {
    vault: {
      onReminder: (callback: typeof listener) => {
        listener = callback;
        return vi.fn();
      },
      reminderAlertsReady: vi.fn(async () => []),
    },
  } as unknown as NotebookBridge;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.a11yNotebook;
});

describe('locked-library generic reminder alerts', () => {
  it('shows the generic unlock alert and plays the sound without revealing any title', async () => {
    render(<LockedReminderAlerts vaultPath="/vault" settings={SETTINGS} announce={vi.fn()} />);
    act(() => listener({ type: 'locked-due', vaultPath: '/vault' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('A reminder is due.')).toBeTruthy();
    expect(screen.getByText('Unlock the library to view it.')).toBeTruthy();
    expect(audio.play).toHaveBeenCalled();
    // Actions that would act on the hidden reminder stay disabled while locked.
    expect(screen.getByRole('button', { name: 'Mark Complete' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveProperty('disabled', true);
  });

  it('plays the sound while unfocused but waits for focus to show the dialog', async () => {
    focused = false;
    render(<LockedReminderAlerts vaultPath="/vault" settings={SETTINGS} announce={vi.fn()} />);
    act(() => listener({ type: 'locked-due', vaultPath: '/vault' }));
    expect(audio.play).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    focused = true;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('ignores due events for other libraries and stays silent when the sound is off', async () => {
    render(
      <LockedReminderAlerts vaultPath="/vault" settings={{ ...SETTINGS, reminderSound: false }} announce={vi.fn()} />,
    );
    act(() => listener({ type: 'locked-due', vaultPath: '/other' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => listener({ type: 'locked-due', vaultPath: '/vault' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(audio.play).not.toHaveBeenCalled();
  });
});
