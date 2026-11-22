/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Insert link now works in the rich-text editor: an accessible dialog asks for the address and the link text, instead of a prompt that silently did nothing.',
      'Pictures can now be pasted or inserted into Markdown notes, keeping their description; the Insert image toolbar works there too.',
      'Nothing opens automatically after an import or a paste any more — pasted folders join Libraries without switching to them, and imported or pasted notes wait until you open them.',
      'Help now has Tutorial and What’s New entries, and the startup tutorial’s checkbox reads “Show the tutorial after each update”.',
      'A new “OCR this file” button recognizes text on-device only, for open ePubs and PDFs, and only for pages or sections with no extractable text.',
      'PDFs can now be bookmarked at the page and the spot on it, under the same Bookmarks heading as notes, and a PDF toggle switches between Paginated view and Continuous view.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Alius Word documents open in the app again; downloading a filled PDF no longer fails on rich-text fields; ePub books open again; bookmark jumps work in Markdown notes.',
      'The “Install on Exit” update option is removed: it silently did nothing, so the downloaded state now offers Restart and install or Close.',
      'The paste dialog starts on the New note versus File attachment choice, and pasted pictures keep their alt text and captions.',
      'Moving to the next section of an ePub book no longer shows the new chapter under the old section heading: stale reader reports about the section being left are now ignored.',
      'Protected PDFs can now be imported as read-only managed documents, and pasting a picture into an open HTML note now inserts it inline with its description.',
      'Pasted or captured items no longer open on their own, and pasting works from the navigation-pane grid too.',
      'Saving a note by hand no longer triggers a spurious “Note changed on disk” message from the pending autosave.',
      'ePub sections now show their real chapter titles instead of a long code, and a book opens on its first section with text instead of its cover.',
      'The title bar now names the open notebook in Notes and Files, Tasks, Cognitive Tools, Calendar, and Reminders views.',
      'Shift+F10 and the Applications key now open the same context menu in the Notes and Files grid, and “Saved PDF notes…” is a semantic heading with Note buttons in the PDF text that jump to each note.',
      'Search results now show reminder times in local time, and bookmark jumps move focus to the bookmarked location in Markdown notes.',
      'Ctrl+Alt+B sets a position bookmark, Ctrl+Alt+H sets a heading bookmark, and Ctrl+Alt+J jumps to the next bookmark, wrapping to the first — in notes and in PDFs.',
    ],
  },
];
