import { describe, expect, it } from 'vitest';
import { computeWindowTitle, notebookNameForFilePath } from '../shared/window-title';
import type { VaultEntry } from '../shared/types';

const entries: VaultEntry[] = [
  {
    name: 'Work',
    path: 'Work',
    kind: 'notebook',
    children: [
      { name: 'Meeting Notes.md', path: 'Work/Meeting Notes.md', kind: 'note' },
      {
        name: 'Projects',
        path: 'Work/Projects',
        kind: 'notebook',
        children: [{ name: 'Plan.md', path: 'Work/Projects/Plan.md', kind: 'note' }],
      },
    ],
  },
  { name: 'Report.pdf', path: 'Report.pdf', kind: 'attachment' },
];

describe('computeWindowTitle', () => {
  it('names the open file, its notebook, and its library', () => {
    expect(
      computeWindowTitle({
        openFileName: 'Meeting Notes',
        openFileNotebookName: 'Work',
        libraryName: 'Main',
        viewTitle: 'Notes & Files',
        selectedNotebookName: 'Work',
        isNotebookTitleView: true,
      }),
    ).toBe('Meeting Notes | Work | Main | A11y Notebook');
  });

  it('names an open attachment with its file name, notebook, and library', () => {
    expect(
      computeWindowTitle({
        openFileName: 'Report.pdf',
        openFileNotebookName: 'Work',
        libraryName: 'Main',
        viewTitle: 'Notes & Files',
        selectedNotebookName: 'Work',
        isNotebookTitleView: true,
      }),
    ).toBe('Report.pdf | Work | Main | A11y Notebook');
  });

  it('omits the notebook segment for an open file at the library root', () => {
    expect(
      computeWindowTitle({
        openFileName: 'Note',
        openFileNotebookName: null,
        libraryName: 'Study',
        viewTitle: 'Notes & Files',
        selectedNotebookName: null,
        isNotebookTitleView: true,
      }),
    ).toBe('Note | Study | A11y Notebook');
  });

  it('recomputes from a renamed file name', () => {
    expect(
      computeWindowTitle({
        openFileName: 'Renamed Notes',
        openFileNotebookName: 'Work',
        libraryName: 'Main',
        viewTitle: 'Notes & Files',
        selectedNotebookName: 'Work',
        isNotebookTitleView: true,
      }),
    ).toBe('Renamed Notes | Work | Main | A11y Notebook');
  });

  it('keeps the view title with the open notebook when no file is open', () => {
    expect(
      computeWindowTitle({
        openFileName: null,
        openFileNotebookName: null,
        libraryName: 'Study',
        viewTitle: 'Notes & Files',
        selectedNotebookName: 'Research',
        isNotebookTitleView: true,
      }),
    ).toBe('Notes & Files | Research | A11y Notebook');
  });

  it('omits the middle segment in a notebook view with no notebook open', () => {
    expect(
      computeWindowTitle({
        openFileName: null,
        openFileNotebookName: null,
        libraryName: 'Study',
        viewTitle: 'Tasks',
        selectedNotebookName: null,
        isNotebookTitleView: true,
      }),
    ).toBe('Tasks | A11y Notebook');
  });

  it('names the library in the non-notebook views when no file is open', () => {
    expect(
      computeWindowTitle({
        openFileName: null,
        openFileNotebookName: null,
        libraryName: 'Study',
        viewTitle: 'Notebooks',
        selectedNotebookName: 'Research',
        isNotebookTitleView: false,
      }),
    ).toBe('Notebooks | Study | A11y Notebook');
  });

  it('names only the view when no library is open', () => {
    expect(
      computeWindowTitle({
        openFileName: null,
        openFileNotebookName: null,
        libraryName: null,
        viewTitle: 'Notes & Files',
        selectedNotebookName: null,
        isNotebookTitleView: true,
      }),
    ).toBe('Notes & Files | A11y Notebook');
  });
});

describe('notebookNameForFilePath', () => {
  it('returns the containing notebook for a note directly inside it', () => {
    expect(notebookNameForFilePath(entries, 'Work/Meeting Notes.md')).toBe('Work');
  });

  it('returns the innermost notebook for a note in a nested notebook', () => {
    expect(notebookNameForFilePath(entries, 'Work/Projects/Plan.md')).toBe('Projects');
  });

  it('returns null for a file at the library root', () => {
    expect(notebookNameForFilePath(entries, 'Report.pdf')).toBeNull();
  });

  it('returns null for a file whose parent is not a notebook', () => {
    expect(notebookNameForFilePath(entries, 'Unknown/Note.md')).toBeNull();
  });
});
