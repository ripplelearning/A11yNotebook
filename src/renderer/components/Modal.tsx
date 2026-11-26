import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Focus the element marked with data-autofocus, or else the first focusable element.
 * A marked element that is disabled cannot take focus (calling focus() on it is a
 * no-op, so focus would silently stay outside the dialog and a screen reader
 * would never announce the dialog) — skip it and fall through to the first
 * focusable element instead. The OCR dialog's Start button is marked this way
 * while no language is picked yet, which is exactly how its opening message
 * used to appear without ever being announced.
 */
export function focusInitialElement(container: HTMLElement) {
  const preferred = Array.from(container.querySelectorAll<HTMLElement>('[data-autofocus]')).find(
    (element) => !element.hasAttribute('disabled') && (element as { disabled?: boolean }).disabled !== true,
  );
  const target = preferred ?? getFocusableElements(container)[0] ?? container;
  target.focus();
}

type ModalProps = {
  titleId: string;
  title: string;
  describedBy?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
  restoreFocusTo?: HTMLElement | null;
};

// Modals can stack — the command palette opens over the search dialog,
// for example, since App keeps their open state independent. Only the
// topmost modal owns focus: every Modal used to enforce its own trap
// with a document-level focusin listener, so the moment the top modal
// took focus the modal beneath yanked it back, and the two ping-ponged
// (via focusInitialElement) until the stack overflowed. The stack below
// is in mount order; a modal's trap and key handling suspend while
// another modal is open above it, and closing the top modal hands focus
// back to the modal beneath.
type StackedModal = {
  id: number;
  dialog: HTMLDivElement | null;
};

const modalStack: StackedModal[] = [];
let nextModalId = 1;

function isTopModal(id: number): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1].id === id;
}

/**
 * Accessible modal dialog: labelled by its heading, moves focus inside on open,
 * keeps Tab and Shift+Tab within the dialog, closes on Escape, and restores focus
 * to the element that was focused before it opened. When another modal opens
 * above it, this modal's trap suspends until it is the top modal again.
 */
export default function Modal({
  titleId,
  title,
  describedBy,
  className,
  onClose,
  children,
  role = 'dialog',
  restoreFocusTo,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Stable identity for this modal's place in the stack.
  const modalIdRef = useRef<number | null>(null);
  if (modalIdRef.current === null) {
    modalIdRef.current = nextModalId++;
  }
  const modalId = modalIdRef.current;

  // While any dialog is open, the window title names the dialog, so a
  // screen reader's title-bar shortcut (JAWS Insert+T) reads the dialog
  // title, not the view behind it. The previous title is restored when
  // the dialog closes; a nested dialog restores its parent's title.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | A11y Notebook`;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  useEffect(() => {
    const previouslyFocused =
      restoreFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = dialogRef.current;
    const entry: StackedModal = { id: modalId, dialog };
    modalStack.push(entry);
    if (dialog) {
      focusInitialElement(dialog);
    }

    // If focus escapes the dialog (for example, via a mouse click on the backdrop),
    // bring it back inside. Suspended while another modal is open above this
    // one: only the top modal owns focus, or the two traps fight.
    const handleFocusIn = (event: FocusEvent) => {
      if (!isTopModal(modalId)) {
        return;
      }
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        focusInitialElement(dialog);
      }
    };
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      const index = modalStack.indexOf(entry);
      const wasTop = index === modalStack.length - 1;
      if (index >= 0) {
        modalStack.splice(index, 1);
      }
      // A modal closing from beneath the top one leaves focus where the
      // top modal already has it; restoring its opener would land focus
      // outside the top modal, which would only yank it straight back.
      if (
        wasTop &&
        (role !== 'alertdialog' || document.hasFocus()) &&
        previouslyFocused &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
      // If focus did not land inside the modal now on top — its opener
      // was removed while this modal was open, for example — move it
      // there: a modal must never leave focus stranded outside itself.
      const next = modalStack[modalStack.length - 1];
      if (next?.dialog && !next.dialog.contains(document.activeElement)) {
        focusInitialElement(next.dialog);
      }
    };
  }, [role, restoreFocusTo, modalId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only the top modal answers keys: Escape pressed while focus is
    // somehow in a modal beneath must close the top modal, not this one,
    // and a lower modal must not trap Tab while the top modal owns focus.
    if (!isTopModal(modalId)) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    // Enter on a neutral element (the dialog itself, a heading, or message
    // text) activates the dialog's default action, marked with data-default.
    // Native controls keep their own Enter behavior: buttons click, text
    // fields and selects edit, links follow.
    if (event.key === 'Enter') {
      const target = event.target as HTMLElement | null;
      const isNativeControl =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        target instanceof HTMLAnchorElement ||
        target?.isContentEditable === true;
      if (!isNativeControl && dialogRef.current) {
        const defaultButton = dialogRef.current.querySelector<HTMLButtonElement>('[data-default]:not([disabled])');
        if (defaultButton) {
          event.preventDefault();
          defaultButton.click();
          return;
        }
      }
    }
    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }
    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className={className ? `modal ${className}` : 'modal'}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
