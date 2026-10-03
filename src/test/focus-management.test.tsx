import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';

const twoNoteVault: VaultInfo = {
  name: 'Study',
  path: 'C:/Study',
  entries: [
    {
      name: 'Class notes',
      path: 'Class notes',
      kind: 'notebook',
      children: [
        { name: 'Week 1.md', path: 'Class notes/Week 1.md', kind: 'note' },
        { name: 'Week 2.md', path: 'Class notes/Week 2.md', kind: 'note' },
      ],
    },
  ],
};

afterEach(() => {
  delete window.a11yNotebook;
});

function createNotebookBridge(): NotebookBridge {
  return {
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
    },
    vault: {
      open: vi.fn(async () => twoNoteVault),
      get: vi.fn(async () => twoNoteVault),
      readNote: vi.fn(async (path) => `# ${path}`),
      saveNote: vi.fn(async () => undefined),
      createNotebook: vi.fn(async () => twoNoteVault),
      createNote: vi.fn(async () => twoNoteVault),
      rename: vi.fn(async () => twoNoteVault),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => twoNoteVault),
      delete: vi.fn(async () => twoNoteVault),
      getTasks: vi.fn(async () => []),
      toggleTask: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      toggleBookmark: vi.fn(async () => []),
    },
    onMenuCommand: vi.fn(() => () => undefined),
  };
}

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
  it('starts with one real welcome tab and a labelled tab panel', () => {
    render(<App />);
    const tablist = screen.getByRole('tablist', { name: 'Open tabs' });
    const tabs = within(tablist).getAllByRole('tab');
    const [welcome] = tabs;

    expect(tabs).toHaveLength(1);
    expect(welcome).toHaveAttribute('aria-selected', 'true');
    expect(welcome).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', welcome.id);
  });

  it('keeps roving keyboard navigation and panel labels across multiple note tabs', async () => {
    window.a11yNotebook = createNotebookBridge();
    render(<App />);
    await screen.findByRole('heading', { name: 'Study' });
    const navigation = screen.getByRole('complementary', { name: 'Navigation pane' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Open Tasks' }));
    fireEvent.click(screen.getByRole('treeitem', { name: /Class notes/ }));
    fireEvent.click(screen.getByRole('treeitem', { name: /Week 1.md/ }));
    await screen.findByRole('tab', { name: 'Week 1' });
    fireEvent.click(screen.getByRole('treeitem', { name: /Week 2.md/ }));
    await screen.findByRole('tab', { name: 'Week 2' });

    const tablist = screen.getByRole('tablist', { name: 'Open tabs' });
    const week1 = within(tablist).getByRole('tab', { name: 'Week 1' });
    const week2 = within(tablist).getByRole('tab', { name: 'Week 2' });
    const tasks = within(tablist).getByRole('tab', { name: 'Tasks' });
    const welcome = within(tablist).getByRole('tab', { name: 'Welcome' });
    week2.focus();
    expect(week2).toHaveFocus();

    fireEvent.keyDown(week2, { key: 'ArrowLeft' });
    expect(week1).toHaveFocus();
    expect(week1).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', week1.id);

    fireEvent.keyDown(week1, { key: 'Home' });
    expect(welcome).toHaveFocus();
    expect(welcome).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(welcome, { key: 'End' });
    expect(week2).toHaveFocus();
    expect(week2).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', week2.id);
    expect(week2.id).not.toMatch(/\s/);

    fireEvent.keyDown(week2, { key: 'ArrowLeft' });
    expect(week1).toHaveFocus();
    fireEvent.keyDown(week1, { key: 'ArrowLeft' });
    expect(tasks).toHaveFocus();
    expect(tasks).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tasks.id);
  });
});
