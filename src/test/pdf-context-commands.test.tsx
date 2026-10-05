import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

describe('PDF contextual command routing', () => {
  it.each(['F10', 'ContextMenu'])('preserves the selected PDF range through the %s menu', async (key) => {
    const { container } = render(<App />);
    const invoker = document.createElement('div');
    invoker.dataset.context = 'pdf-selection';
    invoker.tabIndex = 0;
    invoker.textContent = 'A selected PDF quote';
    container.append(invoker);
    await screen.findByRole('heading', { name: 'A11y Notebook' });
    invoker.focus();
    const range = document.createRange();
    range.setStart(invoker.firstChild!, 2);
    range.setEnd(invoker.firstChild!, 10);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(invoker).toHaveFocus();
    expect(document.getSelection()?.toString()).toBe('selected');
    const listener = vi.fn();
    window.addEventListener('annotate-pdf-selection', listener);
    try {
      fireEvent.keyDown(invoker, { key, shiftKey: key === 'F10' });
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Add note' }));
      await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
      const detail = (listener.mock.calls[0][0] as CustomEvent<{ range: Range; element: HTMLElement }>).detail;
      expect(detail.range.toString()).toBe('selected');
      expect(detail.element).toBe(invoker);
      expect(invoker).toHaveFocus();
    } finally {
      window.removeEventListener('annotate-pdf-selection', listener);
    }
  });

  it('routes a semantic-element right-click without requiring a browser selection', async () => {
    const { container } = render(<App />);
    const invoker = document.createElement('p');
    invoker.dataset.context = 'pdf-semantic';
    invoker.tabIndex = 0;
    invoker.textContent = 'Semantic paragraph';
    container.append(invoker);
    const listener = vi.fn();
    window.addEventListener('annotate-current-semantic-element', listener);
    try {
      fireEvent.contextMenu(invoker);
      expect(screen.queryByRole('menuitem', { name: 'Add note' })).not.toBeInTheDocument();
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Annotate this paragraph/heading/cell' }));
      await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
      expect((listener.mock.calls[0][0] as CustomEvent).detail.element).toBe(invoker);
    } finally {
      window.removeEventListener('annotate-current-semantic-element', listener);
    }
  });

  it('explains palette PDF commands when no PDF is open', async () => {
    render(<App />);
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Annotate PDF selection' }));
    expect(screen.getByLabelText('Status bar')).toHaveTextContent('Open a PDF before adding a PDF note.');
  });

  it('routes a virtual-cursor PDF selection when DOM focus remains on the body', async () => {
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'A11y Notebook' });
    const reader = document.createElement('div');
    reader.dataset.context = 'pdf-selection';
    reader.tabIndex = -1;
    reader.textContent = 'Virtual cursor quote';
    container.append(reader);
    (document.activeElement as HTMLElement).blur();
    const range = document.createRange();
    range.selectNodeContents(reader);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(document.body).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'F10', shiftKey: true });
    expect(await screen.findByRole('menuitem', { name: 'Add note' })).toBeInTheDocument();
  });
});
