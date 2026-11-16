/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'This version is the same app as v1.9.15 — nothing in the app itself changed.',
      'Mac builds are back: v1.9.15 shipped Windows-only because the end-to-end tests failed on macOS; the tests now use Command instead of Control for shortcuts on a Mac, so both platforms ship.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'The end-to-end tests now send Command (Meta) instead of Control for shortcuts on macOS, so the release checks pass there too.',
    ],
  },
];
