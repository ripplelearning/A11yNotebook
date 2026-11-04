/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'The library tree now lives in an Organize Library dialog (View menu, Ctrl+Shift+V), with staged edits: OK applies everything, Cancel discards it all.',
      'Reopening a library now restores the last notebook that was open, instead of landing on the Notebooks view.',
      'A reminder that comes due while the app is closed now shows its notification and opens the app window focused on the due reminder.',
      'Two new Interaction settings, both off by default: Immersive Focus mode, which also hides search while Focus mode is on, and auto-focus on grids when switching views.',
      'Reminder dates are now picked from an in-dialog calendar, and reminder times use an AM/PM choice.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Reading view now renders task checkboxes as real checkboxes (display only; toggling stays in edit mode and Tasks view).',
      'Thesaurus synonyms are now buttons, with online definitions on request; nothing is sent unless Lookup is pressed.',
      'Ctrl+Tab now cycles open tabs only, and each open note keeps its mode and caret when switching tabs.',
      'Closing Find now lands focus at the match in both reading and edit mode.',
      'The Import picker lists Google Docs link (.gdoc) files with guidance, and the appointment link picker offers every non-asset note.',
      'Bibliography entries in HTML notes now use a hanging indent; Markdown cannot express one.',
      'Task files created from Tasks view are now named after their task, and task files stay in Notes and Files.',
    ],
  },
];
