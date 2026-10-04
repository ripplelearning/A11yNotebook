import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashcardReview, GridEditor, MindMapEditor, OutlineEditor } from '../renderer/features/assets';
import { parseOutline, type GridData, type OutlineNode } from '../shared/assets';

function OutlineHarness({ onSave = vi.fn() }: { onSave?: (source: string) => void }) {
  const [value, setValue] = useState(parseOutline('- Parent\n    - Child\n- Other'));
  return <OutlineEditor value={value} onChange={setValue} onSave={onSave} />;
}
function GridHarness({ onSave = vi.fn() }: { onSave?: (source: string, format: 'csv' | 'markdown') => void }) {
  const [value, setValue] = useState<GridData>({
    columns: ['Name', 'Count'],
    rows: [
      ['Beta', '2'],
      ['Alpha', '1'],
    ],
  });
  return <GridEditor value={value} onChange={setValue} onSave={onSave} />;
}

describe('OutlineEditor', () => {
  it('navigates, expands, collapses and edits with native controls', () => {
    render(<OutlineHarness />);
    const parent = screen.getByRole('treeitem', { name: 'Parent' });
    parent.focus();
    fireEvent.keyDown(parent, { key: 'ArrowLeft' });
    expect(parent).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Child' })).not.toBeInTheDocument();
    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    const child = screen.getByRole('treeitem', { name: 'Child' });
    expect(child).toHaveFocus();
    expect(child).toHaveAttribute('aria-level', '2');
    fireEvent.keyDown(child, { key: 'Enter' });
    const editor = screen.getByRole('textbox', { name: 'Item text' });
    expect(editor).toHaveFocus();
    fireEvent.change(editor, { target: { value: 'Updated' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.getByRole('treeitem', { name: 'Updated' })).toHaveFocus();
  });
  it('adds, deletes, reorders, indents, outdents, and saves a nested Markdown list', () => {
    const save = vi.fn();
    render(<OutlineHarness onSave={save} />);
    fireEvent.click(screen.getByRole('treeitem', { name: 'Other' }));
    fireEvent.click(screen.getByRole('button', { name: 'Indent item' }));
    expect(screen.getByRole('treeitem', { name: 'Other' })).toHaveAttribute('aria-level', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Outdent item' }));
    expect(screen.getByRole('treeitem', { name: 'Other' })).toHaveAttribute('aria-level', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }));
    expect(screen.getAllByRole('treeitem')[0]).toHaveAccessibleName('Other');
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }));
    expect(screen.getByRole('treeitem', { name: 'New item' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
    expect(screen.queryByRole('treeitem', { name: 'New item' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save outline' }));
    expect(save).toHaveBeenLastCalledWith('- Parent\n    - Child\n- Other\n- New item\n');
  });
  it('supports an empty outline and read-only mode', () => {
    const { rerender } = render(<OutlineEditor value={[]} onChange={vi.fn()} readOnly />);
    expect(screen.getByText('No items.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const onChange = vi.fn();
    rerender(<OutlineEditor value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(onChange.mock.calls[0][0][0].text).toBe('New item');
  });
});

describe('MindMapEditor', () => {
  it('uses a primary tree, a hidden SVG, protects the root, edits and exports', () => {
    const save = vi.fn();
    const exportOutline = vi.fn();
    function Harness() {
      const [value, setValue] = useState<OutlineNode>({
        id: 'root',
        text: 'Main',
        children: [{ id: 'branch', text: 'Branch', children: [] }],
      });
      return <MindMapEditor value={value} onChange={setValue} onSave={save} onExportOutline={exportOutline} />;
    }
    const { container } = render(<Harness />);
    expect(screen.getByRole('tree', { name: 'Mind map' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('focusable', 'false');
    expect(screen.getByRole('button', { name: 'Delete item' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeDisabled();
    fireEvent.click(screen.getByRole('treeitem', { name: 'Branch' }));
    expect(screen.getByRole('button', { name: 'Outdent item' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Item text' }), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save mind map' }));
    expect(JSON.parse(save.mock.calls[0][0]).children[0].text).toBe('Renamed');
    fireEvent.click(screen.getByRole('button', { name: 'Export outline' }));
    expect(exportOutline).toHaveBeenCalledWith('- Main\n    - Renamed\n');
  });
});

describe('GridEditor', () => {
  it('preserves multiline cell edits and commits when leaving the textarea', () => {
    render(<GridHarness />);
    const cell = screen.getByRole('gridcell', { name: 'Beta' });
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'Enter' });
    const editor = screen.getByRole('textbox', { name: 'Edit row 1, column 1' });
    expect(editor.tagName).toBe('TEXTAREA');
    fireEvent.change(editor, { target: { value: 'Two\nlines' } });
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(editor).toBeInTheDocument();
    fireEvent.blur(editor);
    expect(screen.getByRole('gridcell', { name: /Two\s+lines/ })).toBeInTheDocument();
  });
  it('navigates headers and cells, enters edit, commits, cancels and restores focus', () => {
    render(<GridHarness />);
    const header = screen.getByRole('columnheader', { name: 'Column 1: Name' });
    header.focus();
    fireEvent.keyDown(header, { key: 'ArrowDown' });
    const beta = screen.getByRole('gridcell', { name: 'Beta' });
    expect(beta).toHaveFocus();
    fireEvent.keyDown(beta, { key: 'Enter' });
    let input = screen.getByRole('textbox', { name: 'Edit row 1, column 1' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Gamma' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const gamma = screen.getByRole('gridcell', { name: 'Gamma' });
    expect(gamma).toHaveFocus();
    fireEvent.keyDown(gamma, { key: 'Enter' });
    input = screen.getByRole('textbox', { name: 'Edit row 1, column 1' });
    fireEvent.change(input, { target: { value: 'Discard' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(gamma).toHaveFocus();
    expect(screen.queryByText('Discard')).not.toBeInTheDocument();
    fireEvent.keyDown(gamma, { key: 'ArrowRight' });
    expect(screen.getByRole('gridcell', { name: '2' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('gridcell', { name: '2' }), { key: 'Home', ctrlKey: true });
    expect(header).toHaveFocus();
    fireEvent.keyDown(header, { key: 'Enter' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Label' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.getByRole('columnheader', { name: 'Column 1: Label' })).toBeInTheDocument();
  });
  it('sorts with aria-sort, changes dimensions, and saves both formats', () => {
    const save = vi.fn();
    render(<GridHarness onSave={save} />);
    const header = screen.getByRole('columnheader', { name: 'Column 1: Name' });
    fireEvent.keyDown(header, { key: ' ' });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(within(screen.getAllByRole('row')[1]).getByRole('gridcell', { name: 'Alpha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sort column 1: Name' }));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '4');
    expect(header).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(screen.getByRole('gridcell', { name: 'Beta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected row' }));
    expect(screen.queryByRole('gridcell', { name: 'Beta' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    expect(screen.getByRole('grid')).toHaveAttribute('aria-colcount', '3');
    fireEvent.click(screen.getByRole('columnheader', { name: 'Column 3: Column 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected column' }));
    expect(screen.getByRole('grid')).toHaveAttribute('aria-colcount', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Save grid' }));
    expect(save).toHaveBeenLastCalledWith('Name,Count\r\nAlpha,1\r\n,\r\n', 'csv');
    fireEvent.change(screen.getByRole('combobox', { name: 'Grid save format' }), { target: { value: 'markdown' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save grid' }));
    expect(save).toHaveBeenLastCalledWith('| Name | Count |\n| --- | --- |\n| Alpha | 1 |\n|  |  |\n', 'markdown');
  });
  it('allows readonly navigation but no mutation and protects the last column', () => {
    const change = vi.fn();
    const { rerender } = render(<GridEditor value={{ columns: ['Only'], rows: [] }} onChange={change} readOnly />);
    const header = screen.getByRole('columnheader');
    fireEvent.keyDown(header, { key: 'Enter' });
    fireEvent.keyDown(header, { key: ' ' });
    expect(change).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    rerender(<GridEditor value={{ columns: ['Only'], rows: [] }} onChange={change} />);
    expect(screen.getByRole('button', { name: 'Delete selected column' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete selected row' })).toBeDisabled();
  });
});

describe('FlashcardReview', () => {
  it.each([
    ['Again', 0, 1.96],
    ['Hard', 1, 2.36],
    ['Good', 1, 2.5],
    ['Easy', 1, 2.6],
  ])('maps %s to the requested SM-2 rating', (label, repetitions, ease) => {
    const persist = vi.fn();
    render(
      <FlashcardReview
        today="2026-01-01"
        onSchedule={persist}
        cards={[{ id: 'a', question: 'Question?', answer: 'Answer' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getAllByRole('button')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: String(label) }));
    expect(persist.mock.calls[0][1].repetitions).toBe(repetitions);
    expect(persist.mock.calls[0][1].ease).toBeCloseTo(Number(ease));
    expect(persist.mock.calls[0][1].due).toBe('2026-01-02');
  });
  it('retains a due card when asynchronous persistence fails and reports the failure', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('Disk unavailable'));
    const announce = vi.fn();
    render(
      <FlashcardReview
        today="2026-01-01"
        onSchedule={persist}
        announce={announce}
        cards={[{ id: 'a', question: 'Question?', answer: 'Answer' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    expect(screen.getByRole('button', { name: 'Good' })).toBeDisabled();
    await waitFor(() => expect(screen.getByText('Disk unavailable')).toBeInTheDocument());
    expect(screen.getByText('Question?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Good' })).not.toBeDisabled();
    expect(announce).toHaveBeenCalledWith('Disk unavailable');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('reveals the answer, schedules locally, calls persistence, and advances to the next due card', () => {
    const persist = vi.fn();
    render(
      <FlashcardReview
        today="2026-01-01"
        onSchedule={persist}
        cards={[
          { id: 'a', question: 'First?', answer: 'First answer' },
          { id: 'b', question: 'Second?', answer: 'Second answer' },
        ]}
      />,
    );
    expect(screen.queryByText('First answer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getByRole('heading', { name: 'Answer' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    expect(persist).toHaveBeenCalledWith('a', { repetitions: 1, interval: 1, ease: 2.5, due: '2026-01-02' });
    expect(screen.getByText('Second?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Question' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    expect(screen.getByRole('status')).toHaveTextContent('No cards due');
    expect(screen.getByRole('status')).toHaveFocus();
  });
  it('skips future cards and handles an empty deck', () => {
    const { rerender } = render(
      <FlashcardReview
        today="2026-01-01"
        cards={[{ id: 'a', question: 'Future?', answer: 'Later' }]}
        schedules={{ a: { repetitions: 1, interval: 1, ease: 2.5, due: '2026-01-02' } }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No cards due');
    rerender(<FlashcardReview cards={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('No cards due');
  });
});
