/**
 * The cell keyboard focus should land on when a grid view is entered:
 * the grid's active cell (tabIndex 0), else the first cell, else the
 * panel itself. Mirrors the focus-restore logic used after closing a
 * note or a library.
 */
export function findGridFocusTarget(panel: HTMLElement | null): HTMLElement | null {
  if (!panel) return null;
  const cells = Array.from(panel.querySelectorAll<HTMLElement>('[role="grid"] [role="gridcell"]'));
  return cells.find((cell) => cell.tabIndex === 0) ?? cells[0] ?? panel;
}
