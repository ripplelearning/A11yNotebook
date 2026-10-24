import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../renderer/features/settings/SettingsDialog';
import { COMMANDS } from '../shared/command-registry';
import { DEFAULT_SETTINGS } from '../shared/settings';

function setup() {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const onShortcutCaptureChange = vi.fn();
  const view = render(
    <SettingsDialog
      settings={DEFAULT_SETTINGS}
      onSave={onSave}
      onClose={onClose}
      onShortcutCaptureChange={onShortcutCaptureChange}
    />,
  );
  return { ...view, onSave, onClose, onShortcutCaptureChange };
}

const saveCommand = COMMANDS.find((command) => command.id === 'save-current-note')!;
const openCommand = COMMANDS.find((command) => command.id === 'open-vault')!;
function arm(label = saveCommand.label) {
  const button = screen.getByRole('button', { name: `Capture Shortcut for ${label}` });
  button.focus();
  fireEvent.click(button);
  return button;
}
function input(label = saveCommand.label) {
  return screen.getByLabelText(label, { selector: 'input' });
}
function press(key: string, options = {}) {
  fireEvent.keyDown(document.activeElement ?? window, { key, ...options });
}

describe('Settings interface and shortcut capture', () => {
  it('exposes semantic headings and a uniquely named capture control for every command', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    for (const name of [
      'General editing and autosave',
      'Appearance and interface',
      'Reminder alerts',
      'PDF Reading',
      'Keyboard Shortcuts',
      'Library security',
    ]) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
    const buttons = screen.getAllByRole('button', { name: /^Capture Shortcut for / });
    expect(buttons).toHaveLength(COMMANDS.length);
    for (const command of COMMANDS) {
      expect(
        buttons.filter((button) => button.getAttribute('aria-label') === `Capture Shortcut for ${command.label}`),
      ).toHaveLength(1);
      expect(input(command.label)).toBeInTheDocument();
    }
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Hide printed page numbers from assistive technology' }),
      ).toBeEnabled(),
    );
  });

  it('normalizes capture into only the selected draft, focuses its textbox, and saves only on request', async () => {
    const { onSave, onShortcutCaptureChange } = setup();
    const other = input(openCommand.label);
    const previous = (other as HTMLInputElement).value;
    arm();
    expect(onShortcutCaptureChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Listening for/)).toHaveTextContent(saveCommand.label);
    press('j', { ctrlKey: true, altKey: true, shiftKey: true });
    expect(input()).toHaveValue('Ctrl+Alt+Shift+J');
    expect(input()).toHaveFocus();
    expect(screen.getByText(/Captured Ctrl\+Alt\+Shift\+J/)).toHaveTextContent(saveCommand.label);
    expect(other).toHaveValue(previous);
    expect(onSave).not.toHaveBeenCalled();
    expect(onShortcutCaptureChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          shortcuts: { 'save-current-note': 'Ctrl+Alt+Shift+J' },
        }),
      ),
    );
  });

  it('supports manual edits and keeps button visibility and shortcuts within save/cancel semantics', async () => {
    const { onSave, onClose } = setup();
    const toggle = screen.getByRole('checkbox', { name: 'Show command/action buttons in the UI' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.change(input(), { target: { value: 'alt+ctrl+shift+j' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          showCommandButtons: true,
          shortcuts: { 'save-current-note': 'Ctrl+Alt+Shift+J' },
        }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('ignores modifier-only, repeat, activation, composition, AltGraph, and unsupported input without changing the draft', () => {
    const { onSave } = setup();
    const shortcutInput = input();
    const previous = (shortcutInput as HTMLInputElement).value;
    arm();
    const cancelButton = screen.getByRole('button', { name: 'Cancel capture' });
    for (const [key, options] of [
      ['Control', { ctrlKey: true }],
      ['Shift', { shiftKey: true }],
      ['Alt', { altKey: true }],
      ['j', { ctrlKey: true, altKey: true, repeat: true }],
      ['j', { ctrlKey: true, isComposing: true }],
      ['Process', { keyCode: 229 }],
      ['Enter', {}],
      ['F13', { altKey: true }],
      ['j', {}],
      ['j', { metaKey: true }],
    ] as const) {
      press(key, options);
      expect(shortcutInput).toHaveValue(previous);
      expect(cancelButton).toBeInTheDocument();
    }
    const altGraph = new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(altGraph, 'getModifierState', { value: (modifier: string) => modifier === 'AltGraph' });
    act(() => {
      window.dispatchEvent(altGraph);
    });
    expect(shortcutInput).toHaveValue(previous);
    expect(onSave).not.toHaveBeenCalled();
    press('F12', { altKey: true });
    expect(shortcutInput).toHaveValue('Alt+F12');
    // Navigation keys are supported shortcuts now (Back/Forward
    // default to Alt+ArrowLeft / Alt+ArrowRight).
    arm();
    press('ArrowLeft', { ctrlKey: true });
    expect(shortcutInput).toHaveValue('Ctrl+ArrowLeft');
  }, 10000);

  it('rejects reserved keys and collisions without changing the old value, and permits retry', () => {
    setup();
    const previous = (input() as HTMLInputElement).value;
    arm();
    press('F6');
    expect(screen.getByText(/Shortcut conflicts:/)).toHaveTextContent('navigation');
    expect(input()).toHaveValue(previous);
    press('o', { ctrlKey: true });
    expect(screen.getByText(/Shortcut conflicts:/)).toHaveTextContent(openCommand.label);
    expect(input()).toHaveValue(previous);
    press('j', { ctrlKey: true, altKey: true, shiftKey: true });
    expect(input()).toHaveValue('Ctrl+Alt+Shift+J');
  });

  it('consumes Escape without closing the modal and returns focus to the capture button', () => {
    const { onClose } = setup();
    const previous = (input() as HTMLInputElement).value;
    const button = arm();
    press('Escape');
    expect(input()).toHaveValue(previous);
    expect(button).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cancel capture' })).not.toBeInTheDocument();
    press('Escape');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('allows Tab to leave capture and supports explicit cancellation and row replacement', () => {
    setup();
    arm();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      document.activeElement!.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(false);
    expect(screen.queryByRole('button', { name: 'Cancel capture' })).not.toBeInTheDocument();
    const previous = (input() as HTMLInputElement).value;
    arm();
    const otherButton = arm(openCommand.label);
    press('j', { ctrlKey: true, altKey: true, shiftKey: true });
    expect(input(openCommand.label)).toHaveValue('Ctrl+Alt+Shift+J');
    expect(input()).toHaveValue(previous);
    arm(openCommand.label);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel capture' }));
    expect(otherButton).toHaveFocus();
  });

  it('stops capture on reset, save, close and unmount without leaking an app key listener', async () => {
    const { onSave, onClose, onShortcutCaptureChange, unmount } = setup();
    const dispatch = vi.fn();
    window.addEventListener('keydown', dispatch);
    try {
      arm();
      press('s', { ctrlKey: true });
      expect(dispatch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Reset shortcuts to defaults' }));
      expect(input()).toHaveValue(saveCommand.shortcut);
      press('j', { ctrlKey: true, altKey: true });
      expect(dispatch).toHaveBeenCalledOnce();
      arm();
      fireEvent.click(screen.getByRole('button', { name: 'Reset all settings' }));
      expect(screen.queryByRole('button', { name: 'Cancel capture' })).not.toBeInTheDocument();
      arm();
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(onShortcutCaptureChange).toHaveBeenLastCalledWith(false);
      arm();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalled();
      arm();
      unmount();
      expect(onShortcutCaptureChange).toHaveBeenLastCalledWith(false);
      dispatch.mockClear();
      fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', dispatch);
    }
  });

  it('does not save draft changes when cancelled', () => {
    const { onSave, onClose } = setup();
    fireEvent.change(input(), { target: { value: 'Ctrl+Alt+Shift+J' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show command/action buttons in the UI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
