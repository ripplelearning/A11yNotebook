import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../renderer/App';
import type { NotebookBridge } from '../shared/bridge';
import type { MenuCommand } from '../shared/ipc';
import type { VaultInfo } from '../shared/types';
import type { SpreadsheetWorkbook } from '../shared/spreadsheet';
import type { SlideDeck } from '../shared/slides';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { vaultExtensions } from './vault-extensions';
import { openOrganizeDialog } from './library-navigation';

const workbook: SpreadsheetWorkbook = {
  sourceFormat: 'xlsx',
  sheets: [
    {
      name: 'Budget',
      rows: [
        [{ text: 'Rent' }, { text: '1200', value: 1200 }],
        [{ text: 'Note' }, { text: '' }],
      ],
      mergedCells: [],
      columnWidths: [],
    },
  ],
  unsupportedFeatures: [],
  truncated: false,
};

const deck: SlideDeck = {
  sourceFormat: 'pptx',
  slides: [
    {
      index: 0,
      title: 'Budget Review',
      blocks: [
        { kind: 'title', text: 'Budget Review' },
        { kind: 'body', text: 'First point\nSecond point' },
      ],
      notes: 'Remember the Q3 numbers.',
    },
  ],
  unsupportedFeatures: [],
  truncated: false,
};

afterEach(() => {
  cleanup();
  delete window.a11yNotebook;
});

function setup() {
  const vault: VaultInfo = {
    name: 'Study',
    path: '/study',
    entries: [
      {
        name: 'Sheets',
        path: 'Sheets',
        kind: 'notebook',
        children: [{ name: 'Budget.xlsx', path: 'Sheets/Budget.xlsx', kind: 'attachment', provenance: 'imported' }],
      },
      {
        name: 'Decks',
        path: 'Decks',
        kind: 'notebook',
        children: [{ name: 'Review.pptx', path: 'Decks/Review.pptx', kind: 'attachment', provenance: 'imported' }],
      },
    ],
  };
  let menuListener: (command: MenuCommand) => void = () => undefined;
  const bridge = {
    vault: {
      ...vaultExtensions(),
      open: vi.fn(async () => vault),
      get: vi.fn(async () => vault),
      readNote: vi.fn(async () => '# Note'),
      saveNote: vi.fn(async () => undefined),
      getTasks: vi.fn(async () => []),
      getTaskLinks: vi.fn(async () => []),
      getLinkIndex: vi.fn(async () => ({ links: [] })),
      getBookmarks: vi.fn(async () => []),
      getReadingPosition: vi.fn(async () => null),
      setReadingPosition: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autosaveDelay: 0 })),
      readAttachment: vi.fn(async (path: string) => ({
        path,
        kind: path.slice(path.lastIndexOf('.')).toLowerCase(),
        text: '',
      })),
      readSpreadsheet: vi.fn(async () => structuredClone(workbook)),
      readSlideDeck: vi.fn(async () => structuredClone(deck)),
      openExternal: vi.fn(async () => undefined),
    },
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
      installOnExit: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
    },
    setShortcutCaptureActive: vi.fn(),
    onMenuCommand: (callback: (command: MenuCommand) => void) => {
      menuListener = callback;
      return () => {
        menuListener = () => undefined;
      };
    },
  };
  window.a11yNotebook = bridge as unknown as NotebookBridge;
  render(<App />);
  return { bridge, menu: (command: MenuCommand) => menuListener(command) };
}

async function openTreeAttachment(folder: RegExp, file: RegExp) {
  await screen.findByRole('heading', { name: 'Study' });
  await openOrganizeDialog();
  fireEvent.click(await screen.findByRole('treeitem', { name: folder }));
  fireEvent.click(await screen.findByRole('treeitem', { name: file }));
}

describe('spreadsheet and slide deck opening', () => {
  it('opens an imported .xlsx in the editable grid instead of the external app', async () => {
    const { bridge } = setup();
    await openTreeAttachment(/Sheets/, /Budget\.xlsx/);
    expect(await screen.findByLabelText('Row 1, column A, Rent')).toBeInTheDocument();
    expect(screen.getByText('Budget — 2 rows')).toBeInTheDocument();
    expect(bridge.vault.openExternal).not.toHaveBeenCalled();
    expect(bridge.vault.readAttachment).toHaveBeenCalledWith('Sheets/Budget.xlsx');
  });

  it('opens an imported .pptx in the read-only slide view instead of the external app', async () => {
    const { bridge } = setup();
    await openTreeAttachment(/Decks/, /Review\.pptx/);
    expect(await screen.findByText('1 slide. Slides are read-only in this release.')).toBeInTheDocument();
    expect(screen.getByText('First point')).toBeInTheDocument();
    expect(bridge.vault.openExternal).not.toHaveBeenCalled();
    expect(bridge.vault.readAttachment).toHaveBeenCalledWith('Decks/Review.pptx');
  });
});
