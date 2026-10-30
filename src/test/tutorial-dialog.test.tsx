import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TutorialDialog from '../renderer/components/TutorialDialog';

describe('Tutorial dialog', () => {
  it('moves focus to the new page heading and announces the page change after Next', () => {
    const { container } = render(<TutorialDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Libraries and notebooks' }));
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Page 2 of 6: Libraries and notebooks',
    );
  });

  it('orders the bottom controls Next, Previous, checkbox, Close', () => {
    render(<TutorialDialog onClose={vi.fn()} />);
    const next = screen.getByRole('button', { name: 'Next' });
    const previous = screen.getByRole('button', { name: 'Previous' });
    const checkbox = screen.getByRole('checkbox', { name: "Don't show this again" });
    const close = screen.getByRole('button', { name: 'Close' });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(next, previous)).toBe(true);
    expect(follows(previous, checkbox)).toBe(true);
    expect(follows(checkbox, close)).toBe(true);
  });

  it('names the dialog in the window title while open and restores it on close', () => {
    document.title = 'Files | My Library | A11y Notebook';
    const { unmount } = render(<TutorialDialog onClose={vi.fn()} />);
    expect(document.title).toBe('Welcome Tutorial | A11y Notebook');
    unmount();
    expect(document.title).toBe('Files | My Library | A11y Notebook');
  });

  it('ends with a release-notes page for the current version', () => {
    render(<TutorialDialog onClose={vi.fn()} />);
    for (let step = 0; step < 5; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(screen.getByRole('heading', { name: /What's new in version/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What changed' })).toBeInTheDocument();
    expect(screen.getByText(/Dialogs now carry their own window titles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  });
});
