import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttachmentView from '../renderer/features/previews/AttachmentView';
import type { SpreadsheetWorkbook } from '../shared/spreadsheet';
import type { SlideDeck } from '../shared/slides';

const workbook: SpreadsheetWorkbook = {
  sourceFormat: 'xlsx',
  sheets: [
    {
      name: 'Budget',
      rows: [
        [
          { text: 'Rent' },
          { text: '1200', value: 1200 },
        ],
        [{ text: 'Note' }, { text: '' }],
      ],
      mergedCells: [],
      columnWidths: [],
    },
    {
      name: 'Second',
      rows: [[{ text: 'Only' }]],
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
    { index: 1, title: '', blocks: [{ kind: 'body', text: 'Only body' }], notes: '' },
  ],
  unsupportedFeatures: [],
  truncated: false,
};

function stubVault(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('a11yNotebook', {
    vault: {
      readSpreadsheet: vi.fn(async () => structuredClone(workbook)),
      saveSpreadsheet: vi.fn(async () => undefined),
      saveSpreadsheetAsXlsx: vi.fn(async () => 'Budget.xlsx'),
      readSlideDeck: vi.fn(async () => structuredClone(deck)),
      ...overrides,
    },
  });
}

function renderAttachment(path: string, kind: string, extra: Record<string, unknown> = {}) {
  const saveRef = { current: null as (() => Promise<void>) | null };
  render(
    <AttachmentView
      preview={{ path, kind, text: '' }}
      alt=""
      onSaveAlt={vi.fn()}
      onExternal={vi.fn()}
      announce={vi.fn()}
      spreadsheetSaveRef={saveRef}
      onSpreadsheetFileCreated={vi.fn()}
      {...extra}
    />,
  );
  return saveRef;
}

describe('spreadsheet preview', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders an editable grid with row and column headers', async () => {
    stubVault();
    renderAttachment('Sheets/Budget.xlsx', '.xlsx');
    expect(await screen.findByLabelText('Row 1, column A, Rent')).toBeInTheDocument();
    expect(screen.getByLabelText('Row 1, column B, 1200')).toBeInTheDocument();
    expect(screen.getByText('Budget — 2 rows')).toBeInTheDocument();
  });

  it('edits a cell and saves the updated workbook', async () => {
    stubVault();
    const saveRef = renderAttachment('Sheets/Budget.xlsx', '.xlsx');
    const input = await screen.findByLabelText('Row 1, column B, 1200');
    fireEvent.change(input, { target: { value: '1300' } });
    fireEvent.blur(input);
    const saveButton = screen.getByRole('button', { name: 'Save spreadsheet (Ctrl+S)' });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(window.a11yNotebook!.vault.saveSpreadsheet).toHaveBeenCalledWith(
        'Sheets/Budget.xlsx',
        expect.objectContaining({ sourceFormat: 'xlsx' }),
      ),
    );
    const saved = (
      window.a11yNotebook!.vault.saveSpreadsheet as ReturnType<typeof vi.fn>
    ).mock.calls[0][1] as SpreadsheetWorkbook;
    expect(saved.sheets[0].rows[0][1]).toMatchObject({ text: '1300', value: 1300 });
    // Ctrl+S through the registered save function does the same.
    expect(saveRef.current).not.toBeNull();
  });

  it('adds and deletes rows', async () => {
    stubVault();
    renderAttachment('Sheets/Budget.xlsx', '.xlsx');
    await screen.findByLabelText('Row 1, column A, Rent');
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(screen.getByLabelText('Row 3, column A, empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete row 1' }));
    expect(screen.queryByLabelText('Row 1, column A, Rent')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Row 1, column A, Note')).toBeInTheDocument();
  });

  it('offers a sheet picker for multi-sheet workbooks', async () => {
    stubVault();
    renderAttachment('Sheets/Budget.xlsx', '.xlsx');
    await screen.findByLabelText('Row 1, column A, Rent');
    fireEvent.change(screen.getByLabelText('Sheet'), { target: { value: '1' } });
    expect(screen.getByLabelText('Row 1, column A, Only')).toBeInTheDocument();
  });

  it('routes CSV files to the editable grid', async () => {
    stubVault();
    renderAttachment('Sheets/Budget.csv', '.csv');
    expect(await screen.findByLabelText('Row 1, column A, Rent')).toBeInTheDocument();
  });
});

describe('slide deck preview', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists slides and shows the selected slide with its notes', async () => {
    stubVault();
    renderAttachment('Decks/Review.pptx', '.pptx');
    expect(await screen.findByText('2 slides. Slides are read-only in this release.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Slide 1: Budget Review' })).toBeInTheDocument();
    expect(screen.getByText('First point')).toBeInTheDocument();
    expect(screen.getByText('Remember the Q3 numbers.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Slide 2' }));
    expect(screen.getByText('Only body')).toBeInTheDocument();
    expect(screen.queryByText('First point')).not.toBeInTheDocument();
  });
});
