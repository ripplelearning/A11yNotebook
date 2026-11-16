/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'When you create a notebook, you can now choose where it goes — the Library root, or inside the notebook you have selected — and the app tells you where it was created.',
      'A note now appears under only one notebook: Notes and Files shows a notebook’s own notes and files, and a sub-notebook’s notes only when you open that sub-notebook.',
      'ePub books now open in the app again instead of failing to load.',
      'Automated end-to-end tests now run in CI and on every release, checking the app the way a user drives it.',
      'Appointment start and end times now have accessible AM/PM comboboxes, and the New Task dialog has its date picker buttons back.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'A spreadsheet whose workbook lists the same worksheet twice now imports instead of failing.',
      'Search results show reminder times as MM/DD/YYYY, HH:MM AM/PM, and no longer show raw reminder text.',
      'Bookmark jumps now move the virtual cursor the same way Find does, and Ctrl+Alt+H bookmarks the heading at the reading position.',
      'When you create several tasks in a row in a note, the screen reader now announces “task” after each Enter, not just the first.',
      'Long notebook names no longer shift the grid when you select them.',
    ],
  },
];
