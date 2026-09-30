import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import App from '../renderer/App';

const pressF6 = (shiftKey = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F6', shiftKey });

describe('F6 pane navigation', () => {
  it('moves forward through navigation, tabs, main, right pane, and status, then wraps', () => {
    render(<App />);
    const navigation = screen.getByRole('complementary', { name: 'Navigation pane' });
    const selectedTab = screen.getByRole('tab', { name: 'Welcome' });
    const panel = screen.getByRole('tabpanel');
    const rightPane = screen.getByRole('complementary', { name: 'Right information pane' });
    const status = screen.getByLabelText('Status bar');

    pressF6();
    expect(navigation).toHaveFocus();
    pressF6();
    expect(selectedTab).toHaveFocus();
    pressF6();
    expect(panel).toHaveFocus();
    pressF6();
    expect(rightPane).toHaveFocus();
    pressF6();
    expect(status).toHaveFocus();
    pressF6();
    expect(navigation).toHaveFocus();
  });

  it('moves backward exactly one pane with Shift+F6', () => {
    render(<App />);
    const panel = screen.getByRole('tabpanel');
    panel.focus();

    pressF6(true);
    expect(screen.getByRole('tab', { name: 'Welcome' })).toHaveFocus();
    pressF6(true);
    expect(screen.getByRole('complementary', { name: 'Navigation pane' })).toHaveFocus();
    pressF6(true);
    expect(screen.getByLabelText('Status bar')).toHaveFocus();
  });

  it('skips the right pane when it is hidden', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle right pane' }));
    expect(screen.queryByRole('complementary', { name: 'Right information pane' })).not.toBeInTheDocument();

    screen.getByRole('tabpanel').focus();
    pressF6();
    expect(screen.getByLabelText('Status bar')).toHaveFocus();
    pressF6(true);
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('makes region containers programmatically focusable without adding them to the Tab order', () => {
    render(<App />);
    expect(screen.getByRole('complementary', { name: 'Navigation pane' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('complementary', { name: 'Right information pane' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByLabelText('Status bar')).toHaveAttribute('tabindex', '-1');
  });
});

describe('focus commands', () => {
  it('moves focus with the Window menu commands', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Focus main content' }));
    expect(screen.getByRole('tabpanel')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Focus navigation' }));
    expect(screen.getByRole('complementary', { name: 'Navigation pane' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Focus search' }));
    expect(screen.getByRole('searchbox', { name: 'Global search' })).toHaveFocus();
  });

  it('opens and focuses the right pane when it is hidden', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle right pane' }));
    fireEvent.click(screen.getByRole('button', { name: 'Focus right pane' }));
    expect(screen.getByRole('complementary', { name: 'Right information pane' })).toHaveFocus();
  });

  it('runs keyboard shortcuts from the command registry', () => {
    render(<App />);
    fireEvent.keyDown(document.body, { key: '2', altKey: true });
    expect(screen.getByRole('tabpanel')).toHaveFocus();

    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Mode switched to edit.');
  });
});

describe('command palette', () => {
  it('focuses the search input, traps Tab, and restores focus on Escape', () => {
    render(<App />);
    const opener = screen.getByRole('button', { name: 'Open command search' });
    opener.focus();
    fireEvent.keyDown(opener, { key: 'k', ctrlKey: true });

    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const input = within(dialog).getByRole('searchbox', { name: 'Search commands' });
    expect(input).toHaveFocus();

    const buttons = within(dialog).getAllByRole('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('filters commands and runs the chosen command', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open command search' }));
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'main content' } });
    expect(within(dialog).getByText('1 command')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Focus main content' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });
});

describe('tabs', () => {
  it('follows the WAI-ARIA tabs pattern with roving tabindex', () => {
    render(<App />);
    const tablist = screen.getByRole('tablist', { name: 'Open tabs' });
    const [welcome, notes, tasks] = within(tablist).getAllByRole('tab');

    expect(welcome).toHaveAttribute('aria-selected', 'true');
    expect(welcome).toHaveAttribute('tabindex', '0');
    expect(notes).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', welcome.id);

    welcome.focus();
    fireEvent.keyDown(welcome, { key: 'ArrowRight' });
    expect(notes).toHaveFocus();
    expect(notes).toHaveAttribute('aria-selected', 'true');
    expect(notes).toHaveAttribute('tabindex', '0');
    expect(welcome).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'Notes' })).toBeInTheDocument();

    fireEvent.keyDown(notes, { key: 'End' });
    expect(tasks).toHaveFocus();
    fireEvent.keyDown(tasks, { key: 'ArrowRight' });
    expect(welcome).toHaveFocus();
    fireEvent.keyDown(welcome, { key: 'ArrowLeft' });
    expect(tasks).toHaveFocus();
    fireEvent.keyDown(tasks, { key: 'Home' });
    expect(welcome).toHaveFocus();
  });
});
