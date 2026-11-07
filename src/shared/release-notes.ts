/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Quick Task now keeps the notebook chooser inside the same dialog, after the text box — type first, pick second — and always confirms "Task created in [Notebook Name]".',
      'Global search now covers tasks, reminders, and appointments, with filters for each type; opening a result takes you to the task, reminder, or appointment.',
      'Spreadsheets and slide decks now open in the app: .xlsx, .ods, .xls, .pptx, and .odp files open in the in-app preview instead of an external app.',
      'Deleting a note or notebook that contains tasks now warns you first, with the task count.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Bookmark jumps now land focus on the heading, keep it there, and announce the landing; formatted headings match again, and jumps work in rich-text editing too.',
      'Deleting an appointment now asks in a separate dialog; single appointments say "Delete this appointment?" instead of talking about a series.',
      'The Bibliography toggle is gone from the Citations dialog; switch views with Ctrl+J (Bibliography) and Ctrl+Shift+C (Citation generator).',
      'Import failures now name the real reason instead of "Could not import the selected file."; Google link files (.gdoc, .gsheet, .gslides) that cannot be read now say why.',
    ],
  },
];
