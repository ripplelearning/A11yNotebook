import type { VaultEntry } from './types';

export const APP_TITLE_SUFFIX = 'A11y Notebook';

export interface WindowTitleInput {
  /** Display name of the open file: a note's title, or an attachment's file name. */
  openFileName: string | null;
  /** Name of the notebook containing the open file, or null for a file at the library root. */
  openFileNotebookName: string | null;
  /** Name of the open library, or null when no library is open. */
  libraryName: string | null;
  /** Display name of the current view, for example 'Notes & Files'. */
  viewTitle: string;
  /** Name of the currently open notebook, for the notebook views. */
  selectedNotebookName: string | null;
  /** True for the views whose title names the open notebook instead of the library. */
  isNotebookTitleView: boolean;
}

/**
 * The window title. When a file or note is open it reads
 * "[FileName] | [NotebookName] | [LibraryName] | A11y Notebook"; a file at
 * the library root has no notebook, so its title omits that segment
 * ("[FileName] | [LibraryName] | A11y Notebook"). When no file is open
 * the view title takes over: the notebook views name the open notebook
 * ("[View] | [NotebookName] | A11y Notebook", segment omitted with no
 * notebook open) and the other views name the library
 * ("[View] | [LibraryName] | A11y Notebook").
 */
export function computeWindowTitle(input: WindowTitleInput): string {
  const { openFileName, openFileNotebookName, libraryName, viewTitle, selectedNotebookName, isNotebookTitleView } =
    input;
  if (openFileName) {
    if (libraryName) {
      return openFileNotebookName
        ? `${openFileName} | ${openFileNotebookName} | ${libraryName} | ${APP_TITLE_SUFFIX}`
        : `${openFileName} | ${libraryName} | ${APP_TITLE_SUFFIX}`;
    }
    return `${openFileName} | ${APP_TITLE_SUFFIX}`;
  }
  if (libraryName && isNotebookTitleView && selectedNotebookName) {
    return `${viewTitle} | ${selectedNotebookName} | ${APP_TITLE_SUFFIX}`;
  }
  if (libraryName && isNotebookTitleView) {
    return `${viewTitle} | ${APP_TITLE_SUFFIX}`;
  }
  if (libraryName) {
    return `${viewTitle} | ${libraryName} | ${APP_TITLE_SUFFIX}`;
  }
  return `${viewTitle} | ${APP_TITLE_SUFFIX}`;
}

function findEntry(entries: VaultEntry[], targetPath: string | null): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    const nested = entry.children && findEntry(entry.children, targetPath);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Name of the notebook containing a library-relative file path, or null
 * when the file sits at the library root or its parent is not a notebook.
 * The innermost containing notebook wins for nested notebooks; a file in
 * a plain folder inside a notebook walks up to that notebook.
 */
export function notebookNameForFilePath(entries: VaultEntry[], filePath: string): string | null {
  let parentPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  while (parentPath) {
    const parent = findEntry(entries, parentPath);
    if (parent?.kind === 'notebook') return parent.name;
    parentPath = parentPath.includes('/') ? parentPath.slice(0, parentPath.lastIndexOf('/')) : '';
  }
  return null;
}
