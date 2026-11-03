import { fireEvent, screen } from '@testing-library/react';

/**
 * Navigation helpers for App tests after the library tree moved into the
 * Organize Library dialog. Callers must wait for the library to load
 * first (for example, by awaiting the library-name heading); opening the
 * dialog before the library loads is refused.
 */

/** Opens the Organize Library dialog with Ctrl+Shift+V. */
export async function openOrganizeDialog() {
  fireEvent.keyDown(document.body, { key: 'V', ctrlKey: true, shiftKey: true });
  await screen.findByRole('dialog', { name: 'Organize Library' });
}

/**
 * Opens a leaf item from the Organize Library dialog's tree. A click on a
 * leaf opens it in the main view and closes the dialog. Items inside a
 * collapsed notebook need their folder clicked first to expand it.
 */
export async function openTreeLeaf(name: RegExp) {
  await openOrganizeDialog();
  fireEvent.click(await screen.findByRole('treeitem', { name }));
}

/**
 * The name cell of a DetailsView grid row, located by the item's path and
 * first column. The name column is unambiguous even when another column
 * shows the same text.
 */
export function gridNameCell(path: string, root: ParentNode = document): HTMLElement {
  const cells = Array.from(root.querySelectorAll('[role="gridcell"]'));
  const cell = cells.find(
    (element) =>
      (element as HTMLElement).dataset.path === path && element.getAttribute('aria-colindex') === '1',
  );
  if (!cell) throw new Error(`No grid name cell for ${path}`);
  return cell as HTMLElement;
}

/** Clicks a grid row's name cell, which selects the item. */
export function selectGridItem(path: string, root?: ParentNode) {
  const cell = gridNameCell(path, root);
  fireEvent.click(cell);
  return cell;
}

/** Double-clicks a grid row's name cell, which opens the item. */
export function openGridItem(path: string, root?: ParentNode) {
  const cell = gridNameCell(path, root);
  fireEvent.doubleClick(cell);
  return cell;
}
