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
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Alius Word documents open in the app again; downloading a filled PDF no longer fails on rich-text fields; ePub books open again; bookmark jumps work in Markdown notes.',
      'The “Install on Exit” update option is removed: it silently did nothing, so the downloaded state now offers Restart and install or Close.',
      'The paste dialog starts on the New note versus File attachment choice, and pasted pictures keep their alt text and captions.',
    ],
  },
];
