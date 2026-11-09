/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Every .csv file now opens as a spreadsheet grid, instead of opening the Cognitive Tools view.',
      'Tasks you create in a note are now automatically linked to that note, and the link shows in the Tasks view — you can remove it like any other link.',
      'Create Reminder is now on the context menu for notes and files, and the new reminder comes pre-linked to the item you chose.',
      'Pressing a letter or number key in the Notes & Files grid now jumps to the next item starting with that character.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Bookmark jumps now move the virtual cursor the same way Find does, so the screen reader follows the jump.',
      'When you set a bookmark, you can now name it — the name field is pre-filled with the heading or nearby text.',
      'The Type column now shows the real file type (ePub, PDF, Word document) instead of "Attachment" for every file.',
      'Search results no longer show raw reminder text; reminder times read MM/DD/YYYY, HH:MM AM/PM.',
      'ePub and PDF files should now open in the app: the file reader can finally fetch the file. Please retest and tell me if they still fail.',
      'A spreadsheet whose workbook lists the same worksheet twice now imports instead of failing.',
      'When a Google link file (.gdoc, .gsheet, .gslides) cannot be read, you can still add it as a link from the dialog that opens.',
      'Switching to edit mode with Ctrl+E now moves focus into the note text box automatically.',
    ],
  },
];
