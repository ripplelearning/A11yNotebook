import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UserGuideDialog, { renderGuideSectionHtml } from '../renderer/components/UserGuideDialog';
import type { GuideSection } from '../shared/user-guide';

// jsdom does not implement scrollIntoView; the dialog only needs the call to
// happen before moving focus, so a no-op keeps the focus assertion honest.
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

function setup(props: { shortcuts?: Record<string, string> } = {}) {
  const onClose = vi.fn();
  const { container } = render(<UserGuideDialog onClose={onClose} shortcuts={props.shortcuts as never} />);
  const dialog = screen.getByRole('dialog', { name: 'User Guide' });
  return { container, dialog, onClose };
}

describe('UserGuideDialog', () => {
  it('opens with the search box focused, a Table of Contents, and the guide text', () => {
    const { dialog } = setup();
    expect(screen.getByLabelText('Search the User Guide')).toHaveFocus();
    const toc = within(dialog).getByRole('navigation', { name: 'Table of contents' });
    expect(within(toc).getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(within(toc).getByRole('button', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(within(toc).getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
    // The guide itself renders as semantic headings.
    expect(within(dialog).getByRole('heading', { name: 'Search' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('shows a shortcuts section generated from the registry, including F1', () => {
    const { dialog } = setup();
    const shortcutsSection = dialog.querySelector('section[aria-labelledby="keyboard-shortcuts"]');
    expect(shortcutsSection).not.toBeNull();
    expect(shortcutsSection).toHaveTextContent('User Guide');
    expect(shortcutsSection).toHaveTextContent('F1');
    // The shortcuts table uses row headers, like the shortcuts dialog.
    expect(within(shortcutsSection as HTMLElement).getByRole('rowheader', { name: 'User Guide' })).toBeInTheDocument();
    expect(shortcutsSection).toHaveTextContent('Open search');
    expect(shortcutsSection).toHaveTextContent('Alt+Q');
    // The section says how it stays current; the stale hand table is gone.
    expect(shortcutsSection).toHaveTextContent('generated from the command registry');
    expect(shortcutsSection).not.toHaveTextContent('Focus global search');
    expect(shortcutsSection).not.toHaveTextContent('Show keyboard shortcuts');
  });

  it('never shows the shortcuts generation marker as visible text', () => {
    const { dialog } = setup();
    expect(dialog).not.toHaveTextContent('guide-shortcuts');
    expect(dialog).not.toHaveTextContent('do not hand-edit');
  });

  it('opens with the three introductory sections first in the Table of Contents', () => {
    const { dialog } = setup();
    // The three parts are the first three level-2 headings; the feature
    // sections sit under them as level-3 headings.
    const topLevel = within(dialog)
      .getAllByRole('heading', { level: 2 })
      .filter((heading) => heading.textContent !== 'User Guide')
      .slice(0, 3)
      .map((heading) => heading.textContent);
    expect(topLevel).toEqual([
      'Introduction to A11y Notebook',
      'The user interface and how to navigate it using a keyboard',
      'Accessibility features and accessibility settings',
    ]);
  });

  it('shows a remapped shortcut in the shortcuts section without editing the guide', () => {
    const { dialog } = setup({ shortcuts: { 'toggle-bookmark': 'Ctrl+Alt+T' } });
    const shortcutsSection = dialog.querySelector('section[aria-labelledby="keyboard-shortcuts"]');
    expect(shortcutsSection).toHaveTextContent('Toggle note bookmark');
    expect(shortcutsSection).toHaveTextContent('Ctrl+Alt+T');
    expect(shortcutsSection).not.toHaveTextContent('Ctrl+D');
  });

  it('filters sections by search and announces the match count', () => {
    const { dialog } = setup();
    fireEvent.change(screen.getByLabelText('Search the User Guide'), { target: { value: 'reminders' } });
    expect(screen.getByRole('status')).toHaveTextContent(/sections? match/i);
    const toc = within(dialog).getByRole('navigation', { name: 'Table of contents' });
    expect(within(toc).queryByRole('button', { name: 'Tasks' })).toBeNull();
    expect(within(dialog).queryByRole('heading', { name: 'Tasks' })).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Reminders and project progress' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(within(toc).getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search the User Guide')).toHaveFocus();
    expect(screen.getByLabelText('Search the User Guide')).toHaveValue('');
  });

  it('reports no matches for a query nothing contains', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Search the User Guide'), {
      target: { value: 'zzz-no-such-guide-topic' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('No sections match');
    expect(screen.getByRole('navigation', { name: 'Table of contents' })).toHaveTextContent(
      'No sections match this search.',
    );
  });

  it('moves focus to the section heading when a Table of Contents entry is activated', () => {
    const { dialog } = setup();
    const toc = within(dialog).getByRole('navigation', { name: 'Table of contents' });
    fireEvent.click(within(toc).getByRole('button', { name: 'Tasks' }));
    const heading = within(dialog).getByRole('heading', { name: 'Tasks' });
    expect(document.activeElement).toBe(heading);
    expect(heading.id).toBe('tasks');
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('closes on Escape', () => {
    const { dialog, onClose } = setup();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('renderGuideSectionHtml', () => {
  const section: GuideSection = {
    id: 'links',
    level: 2,
    title: 'Links',
    markdown:
      '## Links\n\nSee the [testing strategy](accessibility/testing-strategy.md) and the [releases page](https://example.com/releases).',
    text: 'links see the testing strategy and the releases page',
  };

  it('keeps web links and turns documentation-file links into plain text', () => {
    const html = renderGuideSectionHtml(section);
    expect(html).toContain('id="links"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('testing strategy');
    expect(html).not.toContain('accessibility/testing-strategy.md');
    expect(html).toContain('<a href="https://example.com/releases" target="_blank" rel="noreferrer">releases page</a>');
  });
});
