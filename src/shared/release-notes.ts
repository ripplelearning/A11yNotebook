/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Spreadsheets (.xlsx, .ods, .csv, .xls) open in an editable grid and save back with Ctrl+S; slide decks (.pptx, .odp) open as read-only text.',
      'Link notes: add a web link to a notebook as a grid item with Type Link (Ctrl+Alt+L); it opens in the default web browser.',
      'Bibliographies now format correctly for APA, MLA, and Chicago, including a new Chicago (Notes-Bibliography) style with footnotes.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Opening an ePub or PDF no longer fails with "Failed to fetch"; task reminders now fire after saving a note; the note metadata shortcut is now Ctrl+M; task due dates read MM-DD-YYYY with the time when set; deleting a note removes its link from tasks; bookmark jumps hold their landing when switching views; mixed fractions like 1 3/4 are recognized in math; Quick Task prompts when no notebook is open.',
    ],
  },
];
