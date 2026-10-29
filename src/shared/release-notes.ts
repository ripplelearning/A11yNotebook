/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Original files are hidden once a managed copy is imported: the tree, grid, and search results show the copy, not the original. Settings gains Show original files to bring originals back.',
      'Plain text joins the New note format list: Markdown, HTML, and Plain text (.txt), with Markdown still the default.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'There is now one import command: Import file (Ctrl+Shift+I) opens the file picker for a file from outside the library, and on a selected library file it imports a managed copy of that file.',
    ],
  },
  {
    heading: 'Fixes',
    items: [
      'Note menus keep Open selected item first, with Import file right after it.',
    ],
  },
];
