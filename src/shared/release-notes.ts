/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Export is now a single Export note command (Ctrl+Shift+X): from a note or tab menu it exports that note, otherwise the current note.',
      'In Markdown source, Enter on a list item continues the list, and Enter on an empty item ends it, so pressing Enter twice stops the list.',
      'Closing a library now forgets it, so a closed library stays closed on the next launch.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Older notes without a provenance record now open natively instead of prompting with the external-file dialog.',
      'Reminder and task dates and times are plain text fields (YYYY-MM-DD and HH:MM) instead of native pickers.',
      'The search scope controls stay right after the search box even with no library open, where they are shown disabled.',
      'The open tabs now sit outside the main landmark, which contains only the current tab’s content.',
    ],
  },
];
