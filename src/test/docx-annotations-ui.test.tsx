import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocxReader from '../renderer/features/previews/DocxReader';
import type { NotebookBridge } from '../shared/bridge';
import type { DocxStructure } from '../shared/docx';
import type { DocxAnnotation } from '../shared/docx-annotations';

const structure: DocxStructure = {
  title: 'Guide',
  blocks: [
    { kind: 'paragraph', text: 'Remember to pack the tent', runs: [{ text: 'Remember to pack the tent' }] },
    {
      kind: 'table',
      rows: [
        {
          cells: [
            { paragraphs: [{ kind: 'paragraph', text: 'Cell one', runs: [{ text: 'Cell one' }] }] },
            { paragraphs: [{ kind: 'paragraph', text: 'Cell two', runs: [{ text: 'Cell two' }] }] },
          ],
        },
      ],
    },
  ],
  headings: [],
  links: [],
  sectionCount: 1,
  unsupportedFeatures: [],
  truncated: false,
};

const existing: DocxAnnotation = {
  id: 'd1eebc2a-4444-4333-8222-111111111111',
  path: 'Guide.docx',
  anchor: { blockIndex: 0, quote: 'pack the tent', prefix: 'Remember to ', suffix: '', start: 12, end: 25 },
  color: 'green',
  label: 'Supplies',
  comment: '',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  schemaVersion: 1,
};

function installBridge(overrides: Record<string, unknown> = {}) {
  const vault = {
    readDocxStructure: vi.fn(async () => structure),
    getBookmarks: vi.fn(async () => []),
    toggleBookmark: vi.fn(async () => []),
    openUrl: vi.fn(async () => undefined),
    onSecurityLocked: vi.fn(() => () => undefined),
    onChanged: vi.fn(() => () => undefined),
    listDocxAnnotations: vi.fn(async () => [existing]),
    addDocxAnnotation: vi.fn(async (input: unknown) => ({ ...(input as object), id: 'new-id' })),
    updateDocxAnnotation: vi.fn(async () => existing),
    deleteDocxAnnotation: vi.fn(async () => undefined),
    ...overrides,
  };
  window.a11yNotebook = { vault } as unknown as NotebookBridge;
  return vault;
}

afterEach(() => {
  delete window.a11yNotebook;
});

describe('DOCX annotations in the reader', () => {
  it('renders marks, lists annotations, and deletes through the bridge', async () => {
    const vault = installBridge();
    const { container } = render(<DocxReader path="Guide.docx" />);
    const pane = await screen.findByRole('region', { name: 'DOCX annotations' }).catch(() => null);
    const section = container.querySelector('section[aria-label="DOCX annotations"]')!;
    expect(await within(section as HTMLElement).findByText('Supplies')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('mark')?.textContent).toBe('pack the tent'));
    fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Delete annotation: Supplies' }));
    await waitFor(() => expect(vault.deleteDocxAnnotation).toHaveBeenCalledWith('Guide.docx', existing.id));
    void pane;
  });

  it('creates an annotation from a selection in a paragraph', async () => {
    const vault = installBridge({ listDocxAnnotations: vi.fn(async () => []) });
    const { container } = render(<DocxReader path="Guide.docx" />);
    await screen.findByText('Remember to pack the tent');
    const paragraph = container.querySelector('[data-docx-block="0"] p')!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 12);
    range.setEnd(paragraph.firstChild!, 25);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(screen.getByRole('button', { name: 'Annotate selection' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Highlight label'), { target: { value: 'Supplies' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save annotation' }));
    await waitFor(() =>
      expect(vault.addDocxAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'Guide.docx',
          anchor: expect.objectContaining({ blockIndex: 0, quote: 'pack the tent' }),
        }),
      ),
    );
  });

  it('reports an orphaned annotation whose quote no longer appears', async () => {
    installBridge({
      listDocxAnnotations: vi.fn(async () => [
        { ...existing, anchor: { ...existing.anchor, quote: 'missing words', start: 0, end: 13 } },
      ]),
    });
    const { container } = render(<DocxReader path="Guide.docx" />);
    await screen.findByText('Remember to pack the tent');
    const section = container.querySelector('section[aria-label="DOCX annotations"]')!;
    expect(await within(section as HTMLElement).findByText(/Highlight unavailable/)).toBeTruthy();
    expect(container.querySelector('mark')).toBeNull();
  });
});
