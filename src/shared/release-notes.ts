/**
 * Notes for the tutorial's final page. Update with every release,
 * alongside docs/releases/vX.md, so the tutorial always describes the
 * version the user just opened.
 */
export const RELEASE_NOTES_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "What's new",
    items: [
      'Dialogs now carry their own window titles, and Enter on a dialog’s text or heading activates its default button.',
      'Reminder sounds can now be any audio file on the computer (WAV, MP3, OGG, M4A), chosen in Settings.',
      'With no library to reopen, the app now lands on the Libraries picker instead of an empty Notebooks view.',
      'Switching libraries now restores the previous library’s open notes, selected tab, and open Tasks, Reminders, and Calendar tabs.',
    ],
  },
  {
    heading: 'What changed',
    items: [
      'Reminder, appointment, and task dialogs accept 12-hour times (2:30 PM) as well as 24-hour times, and the reminder and appointment dialogs have Show Date Picker buttons again.',
      'Shift+Delete now deletes permanently everywhere, with permanent wording; plain Delete still sends items to the Recycle Bin.',
      'Pressing Alt+Left after retargeting the tree no longer needs a double press.',
      'The Notes and Files grid stays visible beside an open note, except in Focus Mode, and Ctrl+Tab announces the tab it lands on.',
      'Find repeat (F3 / Shift+F3) in reading mode now moves keyboard focus into the document at the match.',
      'Ctrl+Shift+J now opens the bibliography, and Alt+= inserts an empty math template with the caret inside it.',
      'Focus Mode hides the note-action buttons and the editing-mode toggle, and its on/off announcement is now heard every time.',
    ],
  },
];
