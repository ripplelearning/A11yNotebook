/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Ctrl+W now closes whatever is current: a tab, a selected notebook, or the open library. Closing a library closes everything inside it and returns to the Libraries view with focus on the libraries grid.',
      'Libraries can finally be deleted: focus a library in the Libraries grid and press Delete, or choose Delete library from its context menu. Confirming moves the whole folder to the Recycle Bin.',
      'Opening a library now lands on the Notebooks view instead of Notes and Files.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'The search box is now the first element in the header, and the search scope controls sit right after it, so scope can be chosen without navigating away from the box.',
    ],
  },
];
