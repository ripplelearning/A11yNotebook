import { describe, expect, it } from 'vitest';
import { findGridFocusTarget } from '../renderer/grid-focus';

function buildPanel(cells: Array<{ text: string; tabIndex: number }>): HTMLElement {
  const panel = document.createElement('section');
  const grid = document.createElement('div');
  grid.setAttribute('role', 'grid');
  for (const cell of cells) {
    const element = document.createElement('div');
    element.setAttribute('role', 'gridcell');
    element.tabIndex = cell.tabIndex;
    element.textContent = cell.text;
    grid.appendChild(element);
  }
  panel.appendChild(grid);
  return panel;
}

describe('findGridFocusTarget', () => {
  it('prefers the grid active cell over the first cell', () => {
    const panel = buildPanel([
      { text: 'First', tabIndex: -1 },
      { text: 'Active', tabIndex: 0 },
    ]);
    expect(findGridFocusTarget(panel)?.textContent).toBe('Active');
  });

  it('falls back to the first cell when no cell is active', () => {
    const panel = buildPanel([
      { text: 'First', tabIndex: -1 },
      { text: 'Second', tabIndex: -1 },
    ]);
    expect(findGridFocusTarget(panel)?.textContent).toBe('First');
  });

  it('falls back to the panel when there is no grid', () => {
    const panel = document.createElement('section');
    expect(findGridFocusTarget(panel)).toBe(panel);
  });

  it('returns null without a panel', () => {
    expect(findGridFocusTarget(null)).toBeNull();
  });
});
