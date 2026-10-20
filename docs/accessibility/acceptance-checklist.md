# A11y Notebook accessibility acceptance checklist

- [ ] The application can be operated with a keyboard alone.
- [ ] The interface exposes semantic landmarks, labels, and roles.
- [ ] Visible focus is strong and consistent.
- [ ] F6 and Shift+F6 move between major regions in the expected order.
- [ ] Command palette and menu interactions are keyboard operable.
- [ ] Read-only and edit modes are clearly indicated and announced.
- [ ] The status bar updates with user-facing results and state changes.
- [ ] No custom control replaces a native semantic control without keyboard and state support.
- [ ] Search and filters are operable without a mouse.
- [ ] Windows UIA tree and manual screen-reader checks are part of the validation plan.
- [ ] F6 and Shift+F6 move real keyboard focus (not just highlighting) and skip the hidden right pane.
- [ ] Every modal dialog moves focus inside on open, keeps Tab inside, closes on Escape, and returns focus.
- [ ] Settings exposes level-three section headings under its level-two dialog heading, including editing/autosave,
      appearance/interface, reminders, PDF reading, keyboard shortcuts, library security, and available metadata controls.
- [ ] Show command/action buttons restores application command strips without removing the native menu; the default
      menu-first mode retains essential navigation, content, dialog and form controls. Browser-only development retains command access.
- [ ] Each shortcut has a uniquely named Capture Shortcut button; listening, errors and success are announced.
      Valid capture updates only that draft textbox and focuses it. Manual entry still works.
- [ ] Escape cancels capture without dismissing Settings and returns focus to its button; Tab cancels and navigates
      normally; Cancel capture and replacement work. Reset/save/close stop listening. No app commands execute during capture.
- [ ] Modifier-only/repeated/IME/AltGraph/unsupported input does not corrupt bindings; conflicts and reserved keys
      are rejected. Verify native accelerator suppression on Windows, including role accelerators, without claiming
      interception of operating-system shortcuts.
- [ ] Check both button modes, Settings scrolling and focus trap at large fonts, high contrast, and narrow windows
      with NVDA, JAWS and Narrator. These are manual acceptance steps, not claims of completed validation.
- [ ] The tab list follows the WAI-ARIA tabs pattern (arrow keys, Home and End, roving tabindex, labelled tab panel).
- [ ] The native Windows menu has logical mnemonic groups, separators, keyboard navigation, and correct enabled/checked state; browser-only development has an accessible command fallback.
- [ ] Native menu commands dispatch once, preserve the active note and editor selection, are blocked during dialogs, and restore focus after a dialog closes.
- [ ] Check for Updates opens a labelled modal update dialog that describes the current state in text.
- [ ] Update download progress is exposed as a progress bar with its value and announced politely about every 10 percent, never on every tick and never twice.
- [ ] Update errors are announced as alerts and shown as readable text, never only visually.
- [ ] The update dialog's buttons (Download, Not now, Hide, Restart and install, Install on exit, Try again, Close) have clear, unique accessible names.
- [ ] The library tree exposes tree/treeitem/group roles, expansion and selection state, and a single roving tab stop.
- [ ] The tree supports arrows, Home/End, Enter, F2, Delete, type-ahead, and sibling expansion with `*`.
- [ ] Library file operations remain in the main process and reject traversal and symlink paths.
- [ ] Markdown reading uses semantic headings, lists, tables, and links; edit mode uses a native textarea.
- [ ] Open note tabs expose unsaved state, a labelled close action, and confirmation before discarding edits.
- [ ] Manual JAWS, NVDA, and Narrator validation of the library tree and Markdown reader/editor is completed on Windows.
- [ ] Tasks are exposed in a labelled table with sortable headers and labelled filters; toggles update their Markdown source.
- [ ] HTML tasks expose a unique stable identity and state, labelled checkboxes, due/priority sorting and filtering; toggles update only the selected item's state and stale revisions fail without writing.
- [ ] HTML task status survives source/rich editing, sanitization, save/reload, and supported format conversion; reminder and progress status are announced.
- [ ] Internal and missing-note links have distinguishable accessible text; backlinks and bookmarks are lists under headings.
- [ ] Indexed search filters and tag controls have labels; results expose snippets and announce the displayed count once in the existing status region.
- [ ] External changes reload clean notes without stealing focus; dirty notes retain text, pause autosave, and offer Keep mine / Load disk version / Save copy.
- [ ] Conflict dialogs explain removed notes; Escape never discards edits, and Save copy is operable with keyboard only.
- [ ] Rename/move dialogs and the native affected-note confirmation enumerate changes, have safe cancellation, and restore focus.
- [ ] Shift+F10/Applications-key tree menus support arrows, Home/End, Enter, Escape, and predictable focus return.
- [ ] Formatting toolbar has one roving tab stop, arrow navigation, labelled dialogs, retained selection, and announced results.
- [ ] Annotation selection works with each screen reader; marks expose label/comment descriptions and a non-color cue.
- [ ] Annotation lists expose unavailable anchors, Jump/Edit/Delete names, and focus after deletion/jump.
- [ ] Template selection, title/notebook controls, read-only preview, errors, and cursor placement are understandable.
- [ ] Template output format has an accessible selector and Markdown remains the default; HTML output is sanitized and its extension, placeholders, and cursor position match the selected format.
- [ ] Export format, format-loss warning, protected-content consent, save-dialog cancellation, overwrite confirmation, and completion/error status are keyboard and screen-reader accessible.
- [ ] Web capture format selection, progress/errors, partial-image failure counts, and final saved-note status are accessible; HTML contains no remote resources.
- [ ] HTML note-text annotations expose labels/descriptions and Jump/Edit/Delete; verify implemented PDF range/quote mapping and persisted notes, without implying ePub annotations are implemented.
- [ ] Verify the bounded-scale PDF canvas, selectable text layer, zoom/rotation and separate semantic text without duplicate announcements. ePub paginated content with TOC and extracted text still needs keyboard, reading-order, and screen-reader validation.
- [ ] Reminder table and agenda headings expose local times, notification status, snooze/dismiss actions, and startup missed reminders.
- [ ] Notebook task progress has an accessible label, completion count, and native progress value.
- [ ] Outline and mind-map trees expose level/expansion/selection and support indent/reorder/new-item editing without trapping Tab.
- [ ] Mind-map SVG is hidden from assistive technology; the tree supplies all editing functionality.
- [ ] Editable grids expose headers, coordinates, one roving cell stop, Enter/Escape editing, aria-sort, and row/column controls.
- [ ] Details grids navigate between data cells and headers with one tab stop, support keyboard sorting, and retain row open/select/context actions.
- [ ] Flashcards announce reveal/review progress, focus the current question/answer, and preserve the card after persistence failure.
- [ ] HTML preview frame is labelled and keyboard reachable; image descriptions, text, and CSV headers read correctly.
- [ ] Settings labels, validation errors, shortcut conflicts/reset/disable, active-binding help, and all themes work at enlarged font sizes.
- [ ] All above widgets pass JAWS, NVDA, Narrator, keyboard-only, and Windows forced-colors checks; record results rather than checking boxes based on DOM tests.

These items are acceptance criteria, not completed manual-validation claims. Windows screen-reader, UI Automation, and
forced-colors checks must be recorded when run. Remaining document annotation/sidebar/export/lifecycle work and manual
PDF/ePub accessibility validation are open; see the [document reader and annotation follow-up plan](../roadmap.md#document-reader-and-annotation-follow-up-plan).

- [ ] Audit storage-failure warnings clearly distinguish a completed operation from a missing history entry, are
      announced once, and preserve understandable native-dialog focus with JAWS, NVDA and Narrator.
- [ ] Milestone list/detail/create/edit/association/delete workflows expose dates/status/progress, trap modal focus,
      return it predictably on cancel/save/delete, announce results once and clear content on lock/switch.

## Portable-app workflow regression checks (Windows, manual)

Use a disposable copy of a library, the packaged portable executable, and each of JAWS, NVDA, and Narrator.
Record the Windows build, app commit, screen-reader version, observed speech, and pass/fail for each step.
DOM focus assertions and mocked OS calls do **not** verify speech or real Windows dialogs.

- [ ] With no library, press Ctrl+1 and Ctrl+2 twice each: hear “Libraries” and “Notebooks” on each activation.
      Open a library named Study: Ctrl+1 announces “Study”; Ctrl+2 announces “Notebooks in Study”.
      Select Research and press Ctrl+3 twice: hear “Notes and Files in Research”, once per activation.
      Check Tasks and Cognitive Tools have similarly truthful context, including when no notebook is selected.
- [ ] Navigate grid rows with arrows and Space, open with Enter, return to Notes and Files, then rename/move
      Research and modify its files externally. Notebook context must survive selection and watcher refreshes.
      Delete Research: the view must no longer announce a notebook that does not exist.
- [ ] Open a modal, press navigation/New shortcuts, then Escape: no background navigation or creation occurs,
      Tab remains trapped until closing, and focus returns to the invoker. Repeat with a locked library,
      during IME composition, and while typing in a text field.
- [ ] Use Ctrl+N from Libraries, Notebooks, Notes and Files, Tasks, and Cognitive Tools. Complete each flow,
      restart the app, and verify the library/notebook/note/task/tool persists in the chosen destination.
      Repeat with cancellation, an existing name, an invalid name, and a simulated unwritable destination.
      Unsaved notes and tool edits must remain intact. Test every offered tool type, including both grid formats.
- [ ] In Notes and Files, invoke New note and New note from template using only the keyboard. Verify
      no-library/no-notebook guidance, template selection and destination, creation errors, and focus return.
      Customize/disable contextual New in Settings; verify menus, palette, and effective shortcut agree.
- [ ] Create Markdown and HTML notes, enable editing, then reopen and switch tabs. Default Read mode must
      not inherit the previous note's Edit mode. Save the Edit-mode opening preference, restart, and repeat.
      Test Ctrl+E, encrypted-note unlock, edit locks, and PDF/DOCX previews without implying binary editing.
- [ ] Place externally authored compatible and unsupported files beside app-created notes. Opening unknown
      files must not execute their contents or silently treat them as app-created. Explicitly import a supported
      file and verify a new internal copy opens; the original bytes remain unchanged. Cancel and retry.
      Rename/move the managed copy, externally modify it, and verify conservative provenance behavior.
- [ ] On Windows, open an external file and exercise Open With: cancel the chooser, select an application,
      and inspect the existing file-type association before and after. Use the offered Windows default-app
      settings to change an association only with explicit consent; verify Windows, not renderer code, owns
      the choice. Record any OS-version restrictions, chooser failures, and default-app settings limitations.
- [ ] Inspect the packaged executable's UI Automation tree for contextual headings/panels, creation dialogs,
      disabled states, and Read/Edit controls. Repeat with high contrast and enlarged text. Do not mark this
      complete merely because packaging or automated tests passed.
