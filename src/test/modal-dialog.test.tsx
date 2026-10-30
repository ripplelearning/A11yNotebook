import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Modal from '../renderer/components/Modal';

function renderModal(onDefault: () => void) {
  return render(
    <Modal titleId="test-dialog-title" title="Software update" onClose={vi.fn()}>
      <button type="button" data-default onClick={onDefault}>
        Download
      </button>
      <button type="button">Not now</button>
      <label>
        Name
        <input aria-label="Name" />
      </label>
    </Modal>,
  );
}

describe('Modal dialog title and default button', () => {
  it('names the dialog in the window title while open and restores it on close', () => {
    document.title = 'Files | My Library | A11y Notebook';
    const { unmount } = renderModal(vi.fn());
    expect(document.title).toBe('Software update | A11y Notebook');
    unmount();
    expect(document.title).toBe('Files | My Library | A11y Notebook');
  });

  it('activates the default button on Enter from a neutral element', () => {
    const onDefault = vi.fn();
    renderModal(onDefault);
    const dialog = screen.getByRole('dialog', { name: 'Software update' });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onDefault).toHaveBeenCalledTimes(1);
  });

  it('does not activate the default button on Enter inside a text field', () => {
    const onDefault = vi.fn();
    renderModal(onDefault);
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });
    expect(onDefault).not.toHaveBeenCalled();
  });
});
