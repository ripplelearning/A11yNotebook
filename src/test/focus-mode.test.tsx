import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { VaultInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';

afterEach(() => {
  delete window.a11yNotebook;
  document.head.querySelectorAll('style[data-focus-mode-test]').forEach((element) => element.remove());
});

async function injectStylesheet() {
  const css = await readFile(path.join(process.cwd(), 'src', 'renderer', 'styles.css'), 'utf8');
  const style = document.createElement('style');
  style.dataset.focusModeTest = '';
  style.textContent = css;
  document.head.appendChild(style);
}

function setup() {
  const content = '# Note\n\ntext';
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [{ name: 'Note.md', path: 'Note.md', kind: 'note', provenance: 'created' }],
  };
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => content),
      saveNote: vi.fn(async () => undefined),
      createNote: vi.fn(async () => vault),
      createNotebook: vi.fn(async () => vault),
      rename: vi.fn(async () => vault),
      delete: vi.fn(async () => vault),
      reveal: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      importFile: vi.fn(async () => null),
      getTasks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getCalendar: vi.fn(async () => []),
      saveCalendar: vi.fn(async (appointments: unknown) => appointments),
      getSecurityStatus: vi.fn(async () => ({ enabled: false, locked: false, recoveryAvailable: false })),
      unlockVault: vi.fn(async () => vault),
      onSecurityLocked: () => () => undefined,
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, showCommandButtons: true, autosaveDelay: 0 })),
      search: vi.fn(async () => []),
    },
    updater: {
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      installNow: vi.fn(async () => undefined),
      installOnExit: vi.fn(async () => undefined),
      onStatus: () => () => undefined,
    },
    onMenuCommand: () => () => undefined,
  } as unknown as NotebookBridge;
  window.a11yNotebook = bridge;
  render(<App />);
  return { bridge, vault };
}

async function openNote() {
  fireEvent.click(await screen.findByRole('treeitem', { name: /Note.md/ }));
  await screen.findByRole('heading', { name: 'Note', level: 2 });
}

function pressF11() {
  fireEvent.keyDown(document.body, { key: 'F11' });
}

function shell() {
  return document.querySelector('.app-shell') as HTMLElement;
}

function focusAnnouncement() {
  const region = document.querySelector('p.sr-only[role="status"]');
  return region?.textContent ?? '';
}

describe('Focus Mode (F11)', () => {
  it('toggles on and off with F11 in reading mode and announces the change', async () => {
    setup();
    await injectStylesheet();
    await openNote();
    pressF11();
    expect(shell().classList.contains('focus-mode')).toBe(true);
    await waitFor(() => expect(focusAnnouncement()).toMatch(/Focus mode on/));
    expect(getComputedStyle(document.querySelector('.panel') as HTMLElement).display).toBe('none');
    expect(getComputedStyle(document.querySelector('.tab-bar') as HTMLElement).display).toBe('none');
    expect(getComputedStyle(document.querySelector('.status-bar') as HTMLElement).display).toBe('none');
    expect(getComputedStyle(document.querySelector('.side-panel') as HTMLElement).display).toBe('none');
    expect(getComputedStyle(document.querySelector('.app-header') as HTMLElement).display).not.toBe('none');
    expect(getComputedStyle(document.querySelector('.menu-bar') as HTMLElement).display).not.toBe('none');
    expect(getComputedStyle(document.querySelector('.document') as HTMLElement).display).not.toBe('none');
    pressF11();
    expect(shell().classList.contains('focus-mode')).toBe(false);
    await waitFor(() => expect(focusAnnouncement()).toMatch(/Focus mode off/));
    expect(getComputedStyle(document.querySelector('.panel') as HTMLElement).display).not.toBe('none');
  });

  it('works in editing mode', async () => {
    setup();
    await openNote();
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    await screen.findByRole('textbox', { name: 'Markdown source' });
    pressF11();
    expect(shell().classList.contains('focus-mode')).toBe(true);
  });

  it('does nothing when no note is open', async () => {
    setup();
    await screen.findByRole('treeitem', { name: /Note.md/ });
    pressF11();
    expect(shell().classList.contains('focus-mode')).toBe(false);
  });

  it('ends when switching to another view', async () => {
    setup();
    await openNote();
    pressF11();
    expect(shell().classList.contains('focus-mode')).toBe(true);
    fireEvent.keyDown(document.body, { key: '6', ctrlKey: true });
    await screen.findByRole('tabpanel', { name: /Calendar/ });
    expect(shell().classList.contains('focus-mode')).toBe(false);
  });

  it('ends when the focused note is closed', async () => {
    setup();
    await openNote();
    pressF11();
    expect(shell().classList.contains('focus-mode')).toBe(true);
    fireEvent.keyDown(document.body, { key: 'w', ctrlKey: true });
    await screen.findByRole('heading', { name: /Notes and Files/ });
    expect(shell().classList.contains('focus-mode')).toBe(false);
  });

  it('keeps focus in the search box and moves focus out of hidden chrome', async () => {
    setup();
    await openNote();
    const search = document.querySelector('.global-search input') as HTMLElement;
    search.focus();
    pressF11();
    expect(document.activeElement).toBe(search);
    pressF11();
    const tab = screen.getByRole('tab', { name: 'Note' });
    tab.focus();
    expect(document.activeElement).toBe(tab);
    pressF11();
    expect(document.querySelector('.document')?.contains(document.activeElement)).toBe(true);
  });

  it('hides note-action buttons and the editing-mode toggle in Focus Mode', async () => {
    setup();
    await openNote();
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    await screen.findByRole('textbox', { name: 'Markdown source' });
    expect(screen.getByRole('button', { name: /Convert to HTML copy/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Editing mode' })).toBeInTheDocument();
    pressF11();
    expect(shell().classList.contains('focus-mode')).toBe(true);
    expect(screen.queryByRole('button', { name: /Convert to HTML copy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Editing mode' })).not.toBeInTheDocument();
    pressF11();
    expect(shell().classList.contains('focus-mode')).toBe(false);
    expect(screen.getByRole('button', { name: /Convert to HTML copy/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Editing mode' })).toBeInTheDocument();
  });

  it('keeps the Focus announcement region empty while Focus Mode is not active', async () => {
    // The announcement region stays mounted even when empty: a region
    // that mounts already carrying text is announced only sometimes,
    // while a text change on a persistent region announces every time.
    // Empty, it announces nothing, so the footer status message stays
    // the only spoken status in the normal layout.
    setup();
    await openNote();
    expect(focusAnnouncement()).toBe('');
  });
});
