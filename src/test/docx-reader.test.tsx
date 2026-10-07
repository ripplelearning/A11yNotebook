import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocxReader from '../renderer/features/previews/DocxReader';
import type { NotebookBridge } from '../shared/bridge';
import type { DocxStructure } from '../shared/docx';

const structure: DocxStructure = {
  title: 'Accessible guide',
  author: 'A11y Notebook',
  blocks: [
    { kind: 'paragraph', text: 'Introduction', headingLevel: 1, runs: [{ text: 'Introduction' }] },
    { kind: 'paragraph', text: 'Find this paragraph', runs: [{ text: 'Find this paragraph' }] },
    {
      kind: 'paragraph',
      text: 'A safe link',
      runs: [{ text: 'A safe link', link: 'https://example.org/guide' }],
    },
    {
      kind: 'table',
      rows: [{ cells: [{ paragraphs: [{ kind: 'paragraph', text: 'Cell one', runs: [{ text: 'Cell one' }] }] }, { paragraphs: [{ kind: 'paragraph', text: 'Cell two', runs: [{ text: 'Cell two' }] }] }] }],
    },
  ],
  headings: [{ level: 1, text: 'Introduction', blockIndex: 0 }],
  links: [{ text: 'A safe link', target: 'https://example.org/guide', blockIndex: 2 }],
  sectionCount: 1,
  unsupportedFeatures: [],
  truncated: false,
};

afterEach(() => {
  delete window.a11yNotebook;
});

describe('DOCX semantic reader', () => {
  it('supports outline, search, bookmarks, safe link activation, and keyboard table-cell navigation', async () => {
    let onLock: (() => void) | undefined;
    const openUrl = vi.fn(async () => undefined);
    const toggleBookmark = vi.fn(async () => [
      { id: 'Guide.docx', path: 'Guide.docx', title: 'Accessible guide', created: '2026-01-01T00:00:00.000Z' },
    ]);
    window.a11yNotebook = {
      vault: {
        readDocxStructure: vi.fn(async () => structure),
        getBookmarks: vi.fn(async () => []),
        toggleBookmark,
        openUrl,
        onSecurityLocked: (callback: () => void) => {
          onLock = callback;
          return () => {
            onLock = undefined;
          };
        },
        onChanged: vi.fn(() => () => undefined),
      },
    } as unknown as NotebookBridge;

    render(<DocxReader path="Guide.docx" />);
    expect(await screen.findByRole('heading', { name: 'Accessible guide' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Introduction' }));
    expect(screen.getByLabelText('DOCX reading position')).toHaveTextContent('1 of 4');
    fireEvent.click(screen.getByRole('button', { name: 'Next section' }));
    expect(screen.getByLabelText('DOCX reading position')).toHaveTextContent('2 of 4');

    fireEvent.change(screen.getByRole('textbox', { name: 'Find in DOCX' }), { target: { value: 'find this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go to match in section 2' }));
    expect(screen.getByLabelText('DOCX reading position')).toHaveTextContent('2 of 4');

    fireEvent.click(within(screen.getByRole('navigation', { name: 'DOCX links' })).getByRole('button', { name: 'A safe link' }));
    expect(openUrl).toHaveBeenCalledWith('https://example.org/guide');
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark DOCX' }));
    await waitFor(() => expect(toggleBookmark).toHaveBeenCalledWith('Guide.docx'));
    expect(screen.getByRole('button', { name: 'Remove DOCX bookmark' })).toBeInTheDocument();

    const cells = within(screen.getByRole('table')).getAllByRole('cell');
    cells[0].focus();
    fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[1]);

    act(() => onLock?.());
    expect(await screen.findByRole('alert')).toHaveTextContent('vault was locked');
    expect(screen.queryByText('Find this paragraph')).not.toBeInTheDocument();
  });
});
