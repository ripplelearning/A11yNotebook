import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DetailsView, type DetailsColumn } from '../renderer/components/DetailsView';

interface TestItem {
  id: string;
  name: string;
  category: string;
  count: number;
}

const columns: DetailsColumn<TestItem>[] = [
  { id: 'name', header: 'Name', accessor: (item) => item.name, sortValue: (item) => item.name },
  { id: 'category', header: 'Category', accessor: (item) => item.category, sortValue: (item) => item.category },
  { id: 'count', header: 'Count', accessor: (item) => String(item.count), sortValue: (item) => item.count },
];

const testItems: TestItem[] = [
  { id: '1', name: 'Alpha', category: 'General', count: 10 },
  { id: '2', name: 'Beta', category: 'Specific', count: 5 },
  { id: '3', name: 'Gamma', category: 'Archive', count: 20 },
];

describe('DetailsView grid component', () => {
  it('renders table with role="grid" and proper accessible columns', () => {
    render(
      <DetailsView
        id="test-grid"
        ariaLabel="Test Objects"
        columns={columns}
        items={testItems}
        itemKey={(item) => item.id}
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Test Objects' });
    expect(grid).toBeInTheDocument();
    expect(grid).toHaveAttribute('aria-rowcount', '4');
    expect(grid).toHaveAttribute('aria-colcount', '3');

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveAttribute('aria-sort', 'ascending');
    expect(headers[1]).toHaveAttribute('aria-sort', 'none');
  });

  it('supports sorting by clicking column headers', () => {
    render(
      <DetailsView
        id="test-grid"
        ariaLabel="Test Objects"
        columns={columns}
        items={testItems}
        itemKey={(item) => item.id}
      />,
    );

    const countHeaderButton = screen.getByRole('button', { name: /Count/ });
    fireEvent.click(countHeaderButton);

    const headers = screen.getAllByRole('columnheader');
    expect(headers[2]).toHaveAttribute('aria-sort', 'ascending');

    // Clicking again inverts sort
    fireEvent.click(countHeaderButton);
    expect(headers[2]).toHaveAttribute('aria-sort', 'descending');
  });

  it('navigates rows and cells via Arrow keys, Home, and End', () => {
    const onSelect = vi.fn();
    render(
      <DetailsView
        id="test-grid"
        ariaLabel="Test Objects"
        columns={columns}
        items={testItems}
        itemKey={(item) => item.id}
        onSelect={onSelect}
      />,
    );

    const firstCell = screen.getByText('Alpha').closest('td')!;
    firstCell.focus();
    expect(firstCell).toHaveFocus();

    // ArrowRight to next cell
    fireEvent.keyDown(firstCell, { key: 'ArrowRight' });
    const secondCell = screen.getByText('General').closest('td')!;
    expect(secondCell).toHaveFocus();

    // ArrowDown to next row
    fireEvent.keyDown(secondCell, { key: 'ArrowDown' });
    const betaSecondCell = screen.getByText('Specific').closest('td')!;
    expect(betaSecondCell).toHaveFocus();
    expect(onSelect).toHaveBeenCalledWith(testItems[1]);

    // Home to start of row
    fireEvent.keyDown(betaSecondCell, { key: 'Home' });
    const betaFirstCell = screen.getByText('Beta').closest('td')!;
    expect(betaFirstCell).toHaveFocus();

    // Ctrl+End to end of table
    fireEvent.keyDown(betaFirstCell, { key: 'End', ctrlKey: true });
    const lastCell = screen.getByText('20').closest('td')!;
    expect(lastCell).toHaveFocus();
    expect(onSelect).toHaveBeenCalledWith(testItems[2]);

    // Ctrl+Home to top of table
    fireEvent.keyDown(lastCell, { key: 'Home', ctrlKey: true });
    expect(firstCell).toHaveFocus();
    expect(onSelect).toHaveBeenCalledWith(testItems[0]);
  });

  it('triggers onActivate on Enter, onRename on F2, and context menu on Shift+F10', () => {
    const onActivate = vi.fn();
    const onRename = vi.fn();
    const onContextMenu = vi.fn();

    render(
      <DetailsView
        id="test-grid"
        ariaLabel="Test Objects"
        columns={columns}
        items={testItems}
        itemKey={(item) => item.id}
        onActivate={onActivate}
        onRename={onRename}
        onContextMenu={onContextMenu}
      />,
    );

    const firstCell = screen.getByText('Alpha').closest('td')!;
    firstCell.focus();

    // Enter
    fireEvent.keyDown(firstCell, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(testItems[0]);

    // F2
    fireEvent.keyDown(firstCell, { key: 'F2' });
    expect(onRename).toHaveBeenCalledWith(testItems[0]);

    // Shift+F10
    fireEvent.keyDown(firstCell, { key: 'F10', shiftKey: true });
    expect(onContextMenu).toHaveBeenCalledWith(testItems[0], expect.anything());
  });

  it('shows emptyState when items array is empty', () => {
    render(
      <DetailsView
        id="test-grid"
        ariaLabel="Empty Test"
        columns={columns}
        items={[]}
        itemKey={(item: TestItem) => item.id}
        emptyState={<p>No items found.</p>}
      />,
    );

    expect(screen.getByText('No items found.')).toBeInTheDocument();
  });
});
