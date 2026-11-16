/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Import now asks first: make a copy, or create an Alius — a shortcut to the original file, which stays where it is. An Alius shows as Type "Alius" in the grid, and a broken one offers Locate the file and Remove the Alius.',
      'Pasting into a notebook now asks whether to store the content as a new note or a file attachment, what format (Markdown, rich text, or plain text), and what file name. A whole file keeps its format and only asks copy vs Alius and file name.',
      'Fillable PDFs now show their fields inline in the reading view: text, checkbox, radio, and dropdown fields, filled in place as you read. Filled values are stored in the app, with a "Download filled PDF" export for a real filled file.',
      'A password-protected PDF asks for its password once per session; filling works and the values stay saved in the app.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'The end-to-end tests now resolve the macOS temp directory through its real path, so the Mac tests pass and the Mac builds ship. This is a test-only change.',
      'XFA forms show an honest notice rather than fillable fields: pdf.js exposes no XFA fields through its field APIs.',
      'Filling an Alius never touches the original file: saving a filled copy always creates a new file in the library.',
    ],
  },
];
