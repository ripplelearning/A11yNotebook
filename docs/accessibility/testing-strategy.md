# Accessibility testing strategy

## Goals

A11y Notebook needs to pass both automated checks and human verification. The goal is to verify the shell, keyboard flow, and common interactions in a way that is honest about what automated tools can and cannot prove.

## Automated DOM accessibility checks

- Use React Testing Library and Vitest for rendering and interaction checks.
- Validate the shell elements and options that matter most: menu bar, search input, nav pane, tabs, content pane, info pane, status bar, and command palette.
- Verify accessible names and labels on each major control.
- Confirm focus-target states and active region toggles are present.

## Keyboard interaction tests

- F6 and Shift+F6 move real keyboard focus through navigation → tabs → main → right pane → status bar and wrap. Shift+F6 moves back exactly one pane, and the hidden right pane is skipped (`src/test/focus-management.test.tsx`).
- Ctrl+K opens the command palette and focuses its search box. Tab and Shift+Tab stay inside it, and Escape closes it and returns focus to where it was.
- Tabs follow the WAI-ARIA tabs pattern: arrow keys, Home, and End move focus and selection, and tabindex is roving.
- The Help menu's Check for Updates, Keyboard Shortcuts, and About dialogs are modal, keep focus inside, close on Escape, and return focus (`src/test/help-menu.test.tsx`).
- The update dialog walks through check → available → consented download → progress → install. Progress is announced every 10 percent and errors are announced as alerts.
- Read-only/edit mode toggles produce visible status and mode updates.
- Search and command actions retain keyboard operability.
- The global context menu opens with Shift+F10, the Applications key, and right-click; its available commands follow
  the focused context, keyboard navigation works, and focus returns to the invoking element.
- Rich-text mode exposes a labelled multiline textbox and a one-tab-stop toolbar; HTML paste is sanitized.
- PDF note dialogs validate label-or-comment content, retain multiline comments,
  expose named color choices, trap Tab/Shift+Tab, and cancel with Escape.
  PDF-specific menu tests preserve the selected range through Shift+F10 and
  Applications-key focus changes.

## Electron integration tests

- Smoke-test the Electron shell startup path.
- Confirm the browser window loads the renderer and displays the expected app shell.
- Confirm the preload bridge is enabled without exposing Node to the renderer. `window.a11yNotebook` exposes only typed updater, vault, and menu-command operations; `require` and `process` are undefined.
- Confirm the packaged build loads `dist/index.html` from the asar archive with the Content Security Policy in place.
- Updater state machine unit tests (`src/test/updater-controller.test.ts`): development and portable builds never contact GitHub, nothing downloads without consent, and errors are reported once.

## Windows UI Automation smoke-test plan

- After `npm run package:win`, run `npm run test:ui-smoke` from Windows PowerShell. The script verifies the app window
  and key accessible names; it has not been run in this non-Windows environment.
- Run the app on Windows with UI Automation tools to inspect the accessibility tree.
- Check that key regions, containers, and controls are discoverable.
- Confirm name, role, and state metadata match the intended semantics.
- Run smoke tests for keyboard-only flows and pane navigation.

## Manual screen-reader validation matrix

Recommended manual checks:

- JAWS on Windows 11
- NVDA on Windows 11
- Narrator on Windows 11
- Keyboard-only navigation of menu bar, panes, tabs, search, and command palette
- Vault tree arrow navigation, expansion, selection, rename, and delete confirmation
- Opening notes in tabs, unsaved state, saving, and Markdown browse-mode navigation
- Global Markdown search and opening a result
- Task filters, sortable table metadata, and task toggles reflected in the source note
- Internal wiki-link activation, missing-link announcement, backlink navigation, and bookmark persistence
- Read-only and edit mode transitions
- Status bar reading and command feedback

### Help menu and updater dialog

Run each check with JAWS, NVDA, and Narrator on Windows 11, using the installed (NSIS) build.

| Check                                                      | Expected result                                                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab to the in-app Help group                               | The screen reader announces the "Help" group. The buttons read as "Check for Updates", "Keyboard Shortcuts", "About A11y Notebook", and "Open command search". |
| Native menu: press Alt, then H                             | The Windows Help menu opens with Check for Updates…, Keyboard Shortcuts, and About A11y Notebook. Each opens the matching in-app dialog.                       |
| Activate Check for Updates                                 | The "Software update" dialog is announced with its description. Focus is on the dialog's main button.                                                          |
| No update available                                        | "You are using the latest version (X.Y.Z)" is announced once.                                                                                                  |
| Update available                                           | The new version is announced. Focus lands on **Download**. The release-note summary can be read in browse or virtual mode.                                     |
| Download                                                   | Progress is announced politely about every 10 percent, not on every tick. The progress bar reports its value when focus or the virtual cursor reaches it.      |
| Hide the dialog during a download                          | Focus returns to the control that opened it. Progress is then announced from the status bar, and never twice.                                                  |
| Downloaded                                                 | Focus lands on **Restart and install**. **Install on exit** is reachable with Tab.                                                                             |
| Error (for example, disconnect the network)                | The error text is announced as an alert. Focus lands on **Try again**.                                                                                         |
| Escape in any updater, About, or Keyboard Shortcuts dialog | The dialog closes and focus returns to the control that opened it.                                                                                             |
| Tab and Shift+Tab in any dialog                            | Focus stays inside the dialog.                                                                                                                                 |
| Development build (`npm run dev`)                          | "Updates are only available in the installed build." is announced.                                                                                             |

## Important limitation

UI Automation and DOM tests do not prove that a screen reader speaks the right thing. They confirm that the app exposes accessible names, roles, and states. Speech output still needs manual screen-reader validation because the automation tree cannot reliably capture actual spoken output or speech timing.

### PDF notes (PHASE 3–4; manual checks not yet executed)

With each Windows screen reader, open tagged, untagged, and rotated PDF
fixtures. Create a note from a keyboard selection through Shift+F10 or
Applications, then repeat through the palette. Without browser selection,
search an exact quotation and explicitly choose among repeated matches using
the page/context previews. Focus a semantic paragraph, heading, and table
cell and annotate each through its context menu.

Check label/comment validation, named Red/Yellow/Green/Blue/None options,
multiline comments, Enter submission outside the textarea, Tab/Shift+Tab
trapping, Escape cancellation, focus restoration on cancel, and focus on the
saved note after Save. Confirm that the canvas/text/highlight layers do not
repeat the semantic page's spoken content.

Zoom and rotate through all quarter turns; borders must remain visible in
Windows forced colors and highlights must not intercept selection. Reopen
the PDF, modify its bytes, and remove the quotation: confidence/reason and
unverified/orphan warnings must be readable, original quotes must survive,
and uncertain matches must not silently acquire a highlight. Verify an
intended location explicitly, then test deletion. Single-page display does
not offer native cross-page dragging.

## Extended feature regression coverage

Vitest covers persisted index build/update/filters/tags/snippets (including HTML notes), mocked watcher debounce/exclusion/disposal,
sender/path/protocol validation, repaired links and migrated metadata, annotation re-anchoring and selection,
formatting transforms/dialog keyboard flow, template expansion/cursor placement, scheduler startup/snooze/move
races, SM-2 scheduling, outline/mind-map serialization, grid keyboard editing, and shortcut conflict detection.
Encryption and wrong-password regression tests exist for the current vault/selected-note implementation. They do
not prove whole-vault encryption, encrypted indexes, recovery, or secure erasure; those features remain unimplemented.

## New-widget manual matrix (not yet executed)

Run every row with JAWS, NVDA, and Narrator on Windows 11, installed and portable builds, dark/light/high-contrast,
Windows forced colors, and enlarged font settings. Record screen-reader version and actual spoken output.

| Widget/workflow                   | Keyboard/manual scenario                                                                                             | Expected behavior                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Indexed search and filters/tags   | Search Markdown/HTML/PDF/ePub; type rapidly; set notebook/kind/tag/date                                              | Labels and snippets read correctly; displayed count announced once after debounce; focus stays in search until moved                             |
| External-change conflict          | Edit disk while a clean/dirty note is open; remove a dirty note                                                      | Clean reload does not steal focus; dirty text survives; autosave pauses; all resolution buttons and removed-note instructions are read           |
| Global context menu               | Shift+F10/Applications/right-click across tree, tabs, editor, links, tasks, search, annotations, reminders, previews | Only relevant commands appear; keyboard pattern/disabled state work; focus returns to the invoking element                                       |
| HTML/rich-text notes              | Create `.html`; read, source-edit, rich-edit, paste active content, use toolbar with arrows/Home/End                 | Names/roles/states are exposed; active content and remote images are removed; image alt is required; toolbar has one tab stop                    |
| PDF/ePub reader                   | Keyboard page/section navigation and search; inspect PDF accessible text                                             | Page/section changes remain keyboard-accessible; reader text/search results are labelled and announced once                                      |
| Move/rename and tree context menu | Shift+F10/Applications/right-click, arrows/Home/End/Escape; cancel/confirm repair                                    | Menu is named; dialog focuses controls; affected-note list is readable; cancel changes nothing; focus returns predictably                        |
| Formatting toolbar/dialogs        | Arrow between tools, format a keyboard selection, insert wiki link/table/image                                       | One toolbar tab stop; selection preserved; fields and validation named; result announced once; test Undo in packaged Electron                    |
| Annotations                       | Select in browse mode, Ctrl+Shift+A, label/comment, Jump/Edit/Delete                                                 | Reader-supported selection captured; color plus label exposed; changed/overlapping text reported; mark jump and edit/delete focus understandable |
| Templates                         | Choose each built-in and user template, read preview, create                                                         | Select/preview/title/notebook labels readable; errors announced; cursor reaches expanded marker                                                  |
| Reminder table/agenda             | Create/snooze/dismiss, restart after due time, click notification                                                    | Group headings/table headers/status read correctly; completed tasks do not notify; missed reminders visible; click opens correct vault note      |
| Task project progress             | Inspect empty/partial/completed notebook summaries                                                                   | Counts and native progress values match tasks; no division-by-zero or color-only state                                                           |
| Outline/mind-map trees            | Enter, indent/outdent, Alt+Up/Down, rename/delete/export                                                             | Levels/expansion/focus remain consistent; root protection understood; SVG absent from accessibility tree; export result announced                |
| Grids                             | Arrow/Home/End, Enter/F2 edit, Escape cancel, sort, add/remove                                                       | Coordinates and headers readable; single cell tab stop; sort state announced; focus survives deletion and commit                                 |
| Flashcard review                  | Reveal answer, rate every option, simulate failed persistence                                                        | Question/answer focus and progress sensible; rating only schedules after save; failures keep the card available                                  |
| HTML/image/text/CSV preview       | Browse HTML note and text/CSV/image previews; edit image description                                                 | Scripts/forms/remote images do not run; image alt is announced; CSV headers are readable; external-open works                                    |
| Settings and active shortcut help | Assign conflicting/disabled/custom binding, reset, change theme/font                                                 | Conflicts read as errors; typing/navigation keys preserved; palette/help match active bindings; focus and content contrast maintained            |

Also exercise vault switching while saves/watch callbacks/notifications are pending, ignored metadata writes,
real external file edits in newly created notebooks, long reminder timers, and packaged protocol URLs under asar.
Windows native notification delivery, speech timing, installer behavior, and real filesystem watchers cannot be
certified by jsdom/unit tests.
