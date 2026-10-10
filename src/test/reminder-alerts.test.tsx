import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReminderAlerts from '../renderer/features/reminders/ReminderAlerts';
import ReminderAlertDialog from '../renderer/features/reminders/ReminderAlertDialog';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { DEFAULT_SETTINGS as BASE_SETTINGS } from '../shared/settings';
const DEFAULT_SETTINGS = { ...BASE_SETTINGS, reminderAlerts: true };
import type { NotebookBridge } from '../shared/bridge';
import type { Reminder, VaultReminderEvent } from '../shared/reminders';

const item: Reminder = {
  id: 'standalone:one',
  source: 'standalone',
  title: 'Private meeting',
  path: 'Study.md',
  scheduledAt: '2026-10-03T09:00:00.000Z',
  originalScheduledAt: '2026-10-03T09:00:00.000Z',
  status: 'fired',
};
let listener: (event: VaultReminderEvent) => void;
let focused = true;
let audio: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; volume: number };
let getReminders: ReturnType<typeof vi.fn>;
let dismiss: ReturnType<typeof vi.fn>;
let snooze: ReturnType<typeof vi.fn>;
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
  getReminders = vi.fn().mockResolvedValue([]);
  dismiss = vi.fn().mockResolvedValue([]);
  snooze = vi.fn().mockResolvedValue([]);
  window.a11yNotebook = {
    vault: {
      getReminders,
      dismissReminder: dismiss,
      snoozeReminder: snooze,
      onReminder: (callback: typeof listener) => {
        listener = callback;
        return vi.fn();
      },
    },
  } as unknown as NotebookBridge;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.a11yNotebook;
});
function emit(reminder = item, vaultPath = '/vault') {
  act(() => listener({ type: 'fired', vaultPath, reminder }));
}
const announce = vi.fn();
function alerts(settings = DEFAULT_SETTINGS, blocked = false) {
  return (
    <ReminderAlerts vaultPath="/vault" settings={settings} blocked={blocked} onComplete={vi.fn()} announce={announce} />
  );
}
describe('in-app reminder alerts', () => {
  it.each([false, true])('refreshes queued task revisions while preserving hidden titles (%s)', async (hidden) => {
    const complete = vi.fn().mockResolvedValue(undefined);
    render(
      <ReminderAlerts
        vaultPath="/vault"
        settings={DEFAULT_SETTINGS}
        blocked={false}
        onComplete={complete}
        announce={vi.fn()}
      />,
    );
    await act(async () => {});
    const original: Reminder = {
      ...item,
      source: 'task',
      revision: 'a'.repeat(64),
      ...(hidden ? { privacy: 'hide-title' as const, title: 'Reminder' } : {}),
    };
    emit(original);
    const updated: Reminder = {
      ...item,
      source: 'task',
      revision: 'b'.repeat(64),
      title: 'Updated private task',
    };
    act(() => listener({ type: 'changed', vaultPath: '/vault', reminders: [updated] }));
    if (hidden) {
      expect(screen.queryByText(updated.title)).not.toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).toHaveTextContent('A reminder is due.');
    } else {
      expect(screen.getByRole('alertdialog')).toHaveTextContent(updated.title);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Mark Complete' }));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith(
        hidden ? { ...updated, privacy: 'hide-title', title: 'Reminder' } : updated,
      ),
    );
  });
  it('replays buffered startup deliveries through the same sound/dialog flow and deduplicates the snapshot', async () => {
    getReminders.mockResolvedValue([item]);
    window.a11yNotebook!.vault.reminderAlertsReady = vi
      .fn()
      .mockResolvedValue([{ type: 'fired', vaultPath: '/vault', reminder: item }]);
    render(alerts({ ...DEFAULT_SETTINGS, reminderSound: true }));
    await screen.findByRole('alertdialog');
    expect(audio.play).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('1 reminder waiting.');
    emit();
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it('recovers a due alert fired before renderer subscription without replaying native delivery or sound', async () => {
    getReminders.mockResolvedValue([item]);
    focused = false;
    render(alerts({ ...DEFAULT_SETTINGS, reminderSound: true }));
    await act(async () => {});
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(audio.play).not.toHaveBeenCalled();
    focused = true;
    fireEvent(window, new Event('focus'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(item.title);
    expect(screen.getByRole('status')).toHaveTextContent('1 reminder waiting.');
  });
  it('completes a reminder and announces success only after persistence resolves', async () => {
    let finish!: () => void;
    const complete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const notify = vi.fn();
    render(
      <ReminderAlerts
        vaultPath="/vault"
        settings={DEFAULT_SETTINGS}
        blocked={false}
        onComplete={complete}
        announce={notify}
      />,
    );
    emit();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Complete' }));
    expect(complete).toHaveBeenCalledWith(item);
    expect(screen.getByRole('button', { name: 'Mark Complete' })).toBeDisabled();
    expect(notify).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith('Reminder completed.');
  });
  it('cancels an in-flight startup load without exposing an old vault title', async () => {
    let finish!: (items: Reminder[]) => void;
    getReminders.mockImplementation(
      () =>
        new Promise<Reminder[]>((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = render(alerts());
    await act(async () => {});
    unmount();
    await act(async () => finish([item]));
    expect(screen.queryByText(item.title)).not.toBeInTheDocument();
  });
  it('focuses immediately, traps keyboard, counts the queue and restores focus after Later/Escape', async () => {
    render(
      <>
        <button>Editor</button>
        {alerts()}
      </>,
    );
    screen.getByText('Editor').focus();
    emit();
    expect(screen.getByRole('alertdialog', { name: 'Reminder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Complete' })).toHaveFocus();
    emit({ ...item, id: 'standalone:two' });
    expect(screen.getByRole('status')).toHaveTextContent('2 reminders waiting.');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mark Complete' }), { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Later' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.getByRole('status')).toHaveTextContent('1 reminder waiting.');
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Editor')).toHaveFocus();
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () => {});
  });
  it('plays configured audio when unfocused without stealing focus and presents on focus, independently of native consent', async () => {
    focused = false;
    render(
      <>
        <button>Editor</button>
        {alerts({ ...DEFAULT_SETTINGS, reminderSound: true, reminderVolume: 25 })}
      </>,
    );
    screen.getByText('Editor').focus();
    emit({ ...item, notification: false });
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.volume).toBe(0.25);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Editor')).toHaveFocus();
    focused = true;
    fireEvent(window, new Event('focus'));
    expect(screen.getByRole('button', { name: 'Mark Complete' })).toHaveFocus();
    await act(async () => {});
  });
  it('deduplicates event/startup catch-up and never repeats sound on startup', async () => {
    getReminders.mockResolvedValue([item]);
    render(alerts({ ...DEFAULT_SETTINGS, reminderSound: true }));
    await screen.findByRole('alertdialog');
    emit();
    expect(screen.getByRole('status')).toHaveTextContent('1 reminder waiting.');
    expect(audio.play).not.toHaveBeenCalled();
  });
  it('ignores other vaults, cancels on switch/unmount and hides private titles', async () => {
    const { rerender, unmount } = render(alerts({ ...DEFAULT_SETTINGS, reminderSound: true }));
    emit(item, '/other');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    emit({ ...item, privacy: 'hide-title' });
    expect(screen.queryByText('Private meeting')).not.toBeInTheDocument();
    rerender(
      <ReminderAlerts
        key="/other"
        vaultPath="/other"
        settings={DEFAULT_SETTINGS}
        blocked={false}
        onComplete={vi.fn()}
        announce={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(audio.pause).toHaveBeenCalled();
    unmount();
    await act(async () => {});
  });
  it('queues behind other dialogs and permits disabling visual alerts while retaining sound', async () => {
    const { rerender } = render(alerts(DEFAULT_SETTINGS, true));
    emit();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    rerender(alerts());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    rerender(alerts({ ...DEFAULT_SETTINGS, reminderAlerts: false, reminderSound: true }));
    emit({ ...item, id: 'standalone:two' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(audio.play).toHaveBeenCalledOnce();
    await act(async () => {});
  });
  it('dismisses and prunes reminders changed externally', async () => {
    render(alerts());
    emit();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(item.id));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    emit({ ...item, id: 'standalone:two' });
    act(() => listener({ type: 'changed', vaultPath: '/vault', reminders: [] }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
  it.each([5, 15, 30, 60, 1440, 'tomorrow'] as const)('uses existing snooze semantics for %s', async (duration) => {
    render(alerts());
    emit();
    fireEvent.change(screen.getByLabelText('Snooze duration'), { target: { value: String(duration) } });
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    await waitFor(() => expect(snooze).toHaveBeenCalledWith(item.id, duration));
  });
  it('keeps failed completion open with an accessible error, and makes locked content generic', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('Conflict'));
    const { rerender } = render(
      <ReminderAlertDialog
        reminder={item}
        count={1}
        onComplete={complete}
        onDismiss={vi.fn()}
        onSnooze={vi.fn()}
        onLater={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark Complete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save or resolve note changes');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    rerender(
      <ReminderAlertDialog
        reminder={item}
        count={1}
        locked
        onComplete={complete}
        onDismiss={vi.fn()}
        onSnooze={vi.fn()}
        onLater={vi.fn()}
      />,
    );
    expect(screen.queryByText(item.title)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Complete' })).toBeDisabled();
  });
});
describe('reminder sound settings', () => {
  it('announces test playback failures and stops audio when settings closes', async () => {
    audio.play.mockRejectedValue(new Error('No device'));
    const { unmount } = render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test sound' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not play test sound.');
    unmount();
    expect(audio.pause).toHaveBeenCalled();
  });
  it('tests draft sound independently of toggles and saves validated preferences in the existing settings dialog', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={save} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Reminder volume (percent)'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test sound' }));
    await waitFor(() => expect(audio.play).toHaveBeenCalledOnce());
    expect(audio.volume).toBe(0.7);
    expect(screen.getByLabelText('Enable reminder sound')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Enable reminder sound'));
    fireEvent.click(screen.getByLabelText('Enable in-app reminder alerts'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          reminderAlerts: false,
          reminderSound: true,
          reminderSoundChoice: 'gentle-chime',
          reminderVolume: 70,
        }),
      ),
    );
  });
});
