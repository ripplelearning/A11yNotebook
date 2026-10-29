/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Provide Feedback in the Help menu: send feedback about the app. Only the message you type is sent; no notes, files, or library content are included.',
      'The tutorial ends with this release-notes page, so every update tells you what changed.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Task reminder fields now use separate date and time fields instead of a combined date-time picker, so dates and times can be typed without opening a picker.',
    ],
  },
  {
    heading: 'Fixes',
    items: [
      'Notes created in the app now keep their managed status when closed and reopened, instead of asking to open in another app or be imported.',
      'A new note now opens in Editing mode with the editor focused, even when the default open mode is Reading.',
      'Notes created from a template open the same way, with the cursor placed by the template.',
    ],
  },
];
