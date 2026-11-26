import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Modal from '../renderer/components/Modal';

/**
 * Stacked modals (1.9.23 retest, remaining issue 3): two Modals can be
 * open at once — for example the command palette opened over the search
 * dialog via the native menu, since App keeps their open state
 * independent. Each Modal used to enforce its own focus trap with a
 * document-level focusin listener, so the lower modal yanked focus back
 * into itself the moment the top modal tried to take it, and the two
 * fought over every focus move. Only the top modal may own focus; when
 * it closes, focus returns to the modal beneath, to the element that
 * had focus there.
 */

function LowerModal({ onClose = vi.fn() }: { onClose?: () => void }) {
  return (
    <Modal titleId="lower-title" title="Search" onClose={onClose}>
      <button type="button">Lower close</button>
      <input aria-label="Lower search" />
      <button type="button">Lower result</button>
    </Modal>
  );
}

function UpperModal({ onClose = vi.fn() }: { onClose?: () => void }) {
  return (
    <Modal titleId="upper-title" title="Command palette" onClose={onClose}>
      <button type="button">Upper close</button>
      <input aria-label="Upper search" data-autofocus />
      <button type="button">Upper command</button>
    </Modal>
  );
}

/** Open the lower modal, put focus on its result button, then stack the upper modal over it. */
function renderStacked(lowerOnClose = vi.fn(), upperOnClose = vi.fn()) {
  const rendered = render(<LowerModal onClose={lowerOnClose} />);
  const lowerResult = screen.getByRole('button', { name: 'Lower result' });
  lowerResult.focus();
  expect(document.activeElement).toBe(lowerResult);
  rendered.rerender(
    <>
      <LowerModal onClose={lowerOnClose} />
      <UpperModal onClose={upperOnClose} />
    </>,
  );
  return { ...rendered, lowerOnClose, upperOnClose, lowerResult };
}

describe('stacked modals', () => {
  it('the top modal owns focus when it opens over another modal', () => {
    renderStacked();
    expect(document.activeElement).toBe(screen.getByLabelText('Upper search'));
    expect(screen.getByRole('dialog', { name: 'Command palette' }).contains(document.activeElement)).toBe(true);
  });

  it('closing the top modal returns focus to the element that had focus in the modal beneath', () => {
    const { rerender, lowerResult } = renderStacked();
    rerender(<LowerModal />);
    expect(document.activeElement).toBe(lowerResult);
  });

  it('Escape while stacked closes the top modal, not the one beneath', () => {
    const { lowerOnClose, upperOnClose } = renderStacked();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(upperOnClose).toHaveBeenCalledTimes(1);
    expect(lowerOnClose).not.toHaveBeenCalled();
  });

  it('Tab wraps inside the top modal, not the modal beneath', () => {
    renderStacked();
    const upperCommand = screen.getByRole('button', { name: 'Upper command' });
    upperCommand.focus();
    fireEvent.keyDown(upperCommand, { key: 'Tab' });
    // Wraps to the first focusable element of the top modal (its Close
    // button), not to any element of the modal beneath.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Upper close' }));
  });

  it('the modal beneath resumes its trap once the top modal closes', () => {
    const { rerender } = renderStacked();
    rerender(<LowerModal />);
    const lowerResult = screen.getByRole('button', { name: 'Lower result' });
    expect(document.activeElement).toBe(lowerResult);
    // Tab from the last element wraps to the first element of the lower modal.
    fireEvent.keyDown(lowerResult, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Lower close' }));
    // Focus escaping the (now lone) lower modal is pulled back inside it.
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);
    try {
      outside.focus();
      expect(screen.getByRole('dialog', { name: 'Search' }).contains(document.activeElement)).toBe(true);
    } finally {
      outside.remove();
    }
  });

  it('closing the top modal still returns focus to the modal beneath when its opener is gone', () => {
    const { rerender } = renderStacked();
    // The element that had focus in the lower modal is removed while the
    // top modal is open: focus must land inside the lower modal, not
    // strand on the body.
    screen.getByRole('button', { name: 'Lower result' }).remove();
    rerender(<LowerModal />);
    expect(screen.getByRole('dialog', { name: 'Search' }).contains(document.activeElement)).toBe(true);
  });
});
