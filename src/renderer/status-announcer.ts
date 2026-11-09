import type { Dispatch, SetStateAction } from 'react';

/**
 * A status announcer that re-announces identical messages.
 *
 * A polite live region only speaks when its text changes, so setting the
 * same message twice in a row stays silent: every auto-created task line
 * announces the identical word "task", and only the first one was ever
 * heard. Clearing the region first and re-setting the message after a
 * short delay makes every call announce, even when the message matches
 * the previous one.
 *
 * The delayed set also lands after any focus or caret move from the same
 * interaction: a live-region update in the same tick as a focus change is
 * announced only sometimes, because the screen reader is busy announcing
 * the new focus.
 */
export type StatusAnnouncer = ((message: string) => void) & { cancel: () => void };

export function createStatusAnnouncer(setMessage: Dispatch<SetStateAction<string>>): StatusAnnouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const announce = ((message: string) => {
    clearTimeout(timer);
    setMessage('');
    timer = setTimeout(() => {
      // Do not announce over an open dialog or menu: the screen reader is
      // busy with it, and the announcement would be lost anyway.
      if (!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]'))
        setMessage((current) => (current === '' ? message : current));
    }, 50);
  }) as StatusAnnouncer;
  announce.cancel = () => clearTimeout(timer);
  return announce;
}
