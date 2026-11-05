/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Quick Task (Ctrl+Q): a small dialog that creates a task in the Tasks list from one line of text.',
      'Find now lists every match with its surrounding text; Arrow keys move through the list and Enter moves to the chosen match.',
      'Reading-view task checkboxes now toggle the task, instead of display-only.',
      'Dictation (Ctrl+Alt+D) inserts transcribed speech at the caret; audio notes record, play back, and transcribe locally with a free Whisper model you choose.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Settings now names itself in the window title; reminder dates and times are plain-text fields with an AM/PM choice; Ctrl+Tab no longer returns to a cancelled appointment; in-text citations have a bibliography context menu; importing a .gdoc file explains itself instead of failing generically; bookmark shortcuts are clarified as set-only.',
    ],
  },
];
