import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMANDS, type CommandId } from '../../../shared/command-registry';
import { normalizeShortcut, shortcutConflicts, type NotebookSettings } from '../../../shared/settings';

export function useShortcutCapture(
  shortcuts: NotebookSettings['shortcuts'],
  onCapture: (id: CommandId, shortcut: string) => void,
  onCaptureChange?: (active: boolean) => void,
  isMac = false,
) {
  const [capturing, setCapturing] = useState<CommandId | null>(null);
  const active = useRef<CommandId | null>(null);
  const [notice, setNotice] = useState('');
  const changeRef = useRef(onCaptureChange);
  changeRef.current = onCaptureChange;

  const stop = useCallback((restoreFocus = false) => {
    const id = active.current;
    active.current = null;
    setCapturing(null);
    if (id) setNotice('');
    changeRef.current?.(false);
    if (id && restoreFocus) document.getElementById(`capture-${id}`)?.focus();
  }, []);

  function start(id: CommandId) {
    active.current = id;
    setCapturing(id);
    changeRef.current?.(true);
    setNotice(
      `Listening for ${COMMANDS.find((command) => command.id === id)!.label}. Press a shortcut, Escape to cancel, or Tab to leave.`,
    );
  }

  useEffect(() => {
    if (!capturing) return;
    const handleKey = (event: KeyboardEvent) => {
      const id = active.current;
      if (!id) return;
      if (event.key === 'Tab') {
        stop();
        setNotice('Shortcut capture cancelled.');
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === 'Escape') {
        stop(true);
        setNotice('Shortcut capture cancelled.');
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      // On macOS, Command is the Ctrl slot and a physical Ctrl press is
      // not capturable, matching the command matcher (VoiceOver safety).
      if (isMac ? event.ctrlKey : event.metaKey) {
        setNotice(
          isMac
            ? 'That input cannot be captured. Use Command/Option plus a letter, number, or navigation key, or F1–F12. Escape cancels.'
            : 'That input cannot be captured. Use Ctrl/Alt plus a letter, number, or navigation key, or F1–F12. Escape cancels.',
        );
        return;
      }
      if (event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) {
        setNotice('That input cannot be captured. Use Ctrl/Alt plus a letter, number, or navigation key, or F1–F12. Escape cancels.');
        return;
      }
      try {
        const shortcut = normalizeShortcut(
          [
            ...((isMac ? event.metaKey : event.ctrlKey) ? ['Ctrl'] : []),
            ...(event.altKey ? ['Alt'] : []),
            ...(event.shiftKey ? ['Shift'] : []),
            event.key,
          ].join('+'),
        );
        if (!shortcut) throw new Error('Choose a supported key combination.');
        const conflicts = shortcutConflicts({ ...shortcuts, [id]: shortcut });
        if (conflicts.length) throw new Error(`Shortcut conflicts: ${conflicts.join('; ')}`);
        onCapture(id, shortcut);
        stop();
        setNotice(
          `Captured ${shortcut} for ${COMMANDS.find((command) => command.id === id)!.label}. Save settings to apply.`,
        );
        document.getElementById(`shortcut-${id}`)?.focus();
      } catch (error) {
        setNotice(`${(error as Error).message} Try again, or press Escape to cancel.`);
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [capturing, shortcuts, onCapture, stop, isMac]);

  useEffect(
    () => () => {
      active.current = null;
      changeRef.current?.(false);
    },
    [],
  );

  return {
    capturing,
    notice,
    start,
    stop,
    cancel: () => {
      stop(true);
      setNotice('Shortcut capture cancelled.');
    },
  };
}
