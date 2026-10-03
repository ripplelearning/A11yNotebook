# User guide

## Open a vault

Choose **Vault → Open vault** and select a folder. The folder stays on disk as an ordinary folder. Subfolders appear
as notebooks, `.md` files as notes, and other files as attachments. The last opened vault is restored next time.

## Navigate files

Use the **Vault files** tree. Up and Down move between visible items; Right expands a notebook or enters its first
child; Left collapses or moves to its parent. Home and End move to the first and last visible item. Enter opens a
note or a supported preview. Unsupported attachments open externally. F2 opens a rename dialog. Delete asks before moving it
to the Recycle Bin. Type a letter to find the next item beginning with that letter; `*` expands sibling notebooks.

Use **New note**, **New notebook**, or **Import file** in the navigation pane. Imported files are copied into the
selected notebook. The tree's filesystem context may be revealed in Explorer or opened in its default external app
using the corresponding vault actions.

Shift+F10 or the Applications key opens the tree action menu. Use Up/Down, Home/End, Enter, and Escape.
**Move** chooses a destination notebook. Save all open edits before a rename/move; the native confirmation
lists notes whose links will change. Cancelling leaves the files untouched. Bookmarks, annotations, image
descriptions, flashcard schedules, and reminders follow app-managed moves. Ambiguous title links are not repaired;
use qualified wiki paths such as `[[Notebook/Title]]`. Reference-style Markdown links are not repaired.

## Read and edit notes

Notes open in tabs. The read view contains semantic headings, paragraphs, lists, links, and code rendered from
Markdown; unsafe embedded HTML is removed. Toggle **Read-only/edit mode** with Ctrl+E to edit the Markdown source
in a native text area. Ctrl+S saves immediately; edits also save after a short idle period. A tab marks unsaved
content and asks before discarding it when closed.

The Format menu and formatting toolbar offer bold, italic, heading levels 1–3, lists, quote, and fenced code.
Ctrl+B/Ctrl+I format the selection; Ctrl+Shift+L opens a link dialog with a note picker. The table dialog chooses
rows and columns. Insert image or attachment chooses an already imported vault file and requires a text description.
The editor attempts to preserve native undo; fallback programmatic insertion may not retain an undo entry.

External edits reload clean notes silently. If you have unsaved text, autosave pauses and a conflict dialog offers
**Keep mine** (explicitly save your version), **Load disk version**, or **Save copy** (a new timestamped note).
Removed notes offer Save copy. Escape leaves the conflict unresolved and tells you to choose a resolution; it does
not discard your edits. Switching vaults is blocked until unsaved work is saved or resolved.

## Search

Type in **Global search**; queries wait 250 ms after typing. A main-process index is stored under
`.a11ynotebook/search-index.json` and refreshed incrementally when files change. Results show match context and
announce the displayed count through the status bar. Search filters select notebook, note/attachment kind, tag,
and modified-date range. `#tag` terms also filter by tag. Inline hashtags and supported front-matter tag fields
are indexed; this is not a general YAML editor. Text/CSV/HTML attachment contents are searchable; PDF/ePub bodies
are not. Unsupported attachments are searchable by filename. Results are capped at 100 in the UI.

## Tasks

Choose **Open Tasks** in the navigation pane or command palette. Markdown checkboxes appear in a sortable table;
the status, due-date, and notebook filters narrow the list. Checking or unchecking a task updates its checkbox in
the source note. Optional dates use `due:YYYY-MM-DD` or `📅 YYYY-MM-DD`; priorities use `priority:low`,
`priority:normal`, `priority:high`, or `priority:urgent`.

## Links and bookmarks

Use `[[Note title]]` to link to a note by title, or a relative Markdown link such as `[Related](./Related.md)`.
In read mode, activate a resolved link to open its note in a tab. Missing wiki links are marked and announced as
missing. The right pane lists outgoing links and backlinks for the current note. Choose **Bookmark note** to
bookmark or unbookmark it; saved bookmarks appear in the right pane and open the note when selected. Bookmarks and
the refreshed link graph are stored as readable JSON in `.a11ynotebook/`.

## Annotations

In read mode, select text with keyboard selection or the screen reader's supported selection command, then press
Ctrl+Shift+A or choose Annotate selection. Give the highlight a **text label**, color, and optional comment.
Annotations appear under the right-pane heading with Jump, Edit, and Delete controls. Highlights expose descriptions
and are underlined, so color is never the only cue. Quote/context/offset anchors try to find shifted text; ambiguous,
changed, or overlapping anchors are reported in the list rather than attached to unrelated text.
Annotations persist in `.a11ynotebook/annotations.json`. PDF/ePub annotations are not available.

## Reminders and project progress

Put `remind:2026-10-04 09:30` or `⏰ 2026-10-04 09:30` on an open checkbox task (local time).
Completed tasks do not notify. **Open Reminders** (Ctrl+Shift+R) also creates standalone note reminders.
Switch between the labelled table and Overdue/Today/This week lists. Snooze for 5/15/60 minutes or until the
same local clock time tomorrow; Dismiss removes an item from active views. Clicking a native notification opens
its note when the vault is still open. Windows notification settings may suppress delivery.
The scheduler runs only while the application is running; missed pending reminders fire on next launch, and
already-fired reminders remain visible until dismissed. Reminder state persists in `.a11ynotebook/reminders.json`.
Tasks also show per-notebook completion counts and native progress elements; named milestones are not implemented.

## Templates and cognitive tools

**New note from template** (Ctrl+Shift+N) offers Daily, Meeting, Project, Reading, and Lecture templates with a
read-only preview. Place ordinary editable Markdown templates in `Templates/` to add your own. Supported
placeholders are `{{title}}`, `{{date}}`, `{{time}}`, `{{notebook}}`, and `{{cursor}}`; the first cursor marker
sets the editing position. Use normal note editing to modify user templates.

Choose **Cognitive tools** to create/open `.outline.md`, `.mindmap.json`, `.cards.md`, `.csv`, or `.grid.md` assets.
Outline and mind-map trees use arrows for navigation, Enter for a new sibling, Tab/Shift+Tab for indentation,
and Alt+Up/Down to reorder. Mind-map SVG is decorative; the accessible tree is authoritative. Mind maps export
to a new Markdown outline without overwriting an existing export.
Grids use arrows, Enter/F2 to edit, Enter to commit, and Escape to cancel; labelled controls sort and change
rows/columns. Select the save format matching the file's extension.
Decks use `question :: answer` or `Q:`/`A:` blocks. Reveal the answer, then rate Again/Hard/Good/Easy.
SM-2-style schedules persist in `.a11ynotebook/flashcards.json` and changes to a question/answer start new history.
Save before closing cognitive tools or switching files; unsaved data is kept while switching to another tab.
External asset changes are rejected at save time; preserve your work separately before closing/reopening to reload.

## Attachment previews

Text and CSV have a text view/table. HTML is sanitized in a sandboxed frame; scripts, forms, links, styling,
and external resources are disabled. Raster images use a vault-validated custom protocol and have an editable
description saved in metadata. Image references in Markdown require local raster files. SVG/PDF/ePub are not
rendered internally. **Open in external app** remains available. Text previews are limited to 5 MB and images to 20 MB.

## Settings

**Settings** (Ctrl+Alt+S) changes autosave delay (0 disables it), dark/light/high-contrast theme, font size,
and command shortcuts. Conflicts with command defaults and reserved navigation/editing keys are rejected.
Blank shortcuts disable a command binding; reset restores defaults. Settings are saved in the vault's
`.a11ynotebook/settings.json` and app userData defaults. Keyboard Shortcuts and the palette display active bindings;
the generated documentation lists defaults. Idle locking and reminder-default settings are not implemented.

## Keyboard shortcuts

| Shortcut                                                     | Action                                         |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Ctrl+O                                                       | Open vault                                     |
| Ctrl+N                                                       | Create notebook                                |
| Ctrl+W                                                       | Close current note tab                         |
| Ctrl+E                                                       | Toggle read/edit mode                          |
| Ctrl+L                                                       | Focus global search                            |
| Ctrl+K                                                       | Open command palette                           |
| Ctrl+Tab / Ctrl+Shift+Tab                                    | Switch to next / previous open tab             |
| Ctrl+S                                                       | Save the current note                          |
| Ctrl+D                                                       | Bookmark or unbookmark the current note        |
| F1                                                           | Show keyboard shortcuts                        |
| F5                                                           | Refresh the vault tree                         |
| F6 / Shift+F6                                                | Move focus to next / previous pane             |
| Alt+1 / Alt+2 / Alt+3                                        | Focus navigation / main / right pane           |
| F9                                                           | Show or hide the right pane                    |
| In the tree: Up/Down, Left/Right, Home/End                   | Navigate and expand/collapse                   |
| In the tree: Enter, F2, Delete, `*`, first-letter type-ahead | Open, rename, delete, expand siblings, or find |

## Accessibility notes

Use Tab for normal controls, and F6 or Shift+F6 to move between the application panes. The editor is a plain
textarea to preserve standard keyboard and screen-reader editing behavior. Manual JAWS, NVDA, and Narrator testing
is still needed; see the [testing strategy](accessibility/testing-strategy.md).

## Not available yet

Vault passwords, editing and idle locks, encrypted notes and credentials, and audit logging; PDF/ePub previews,
text extraction, and annotations; web capture; general YAML metadata editing; heading 4–6 formatting; reminder
defaults; and named milestones are not available yet. Manual Windows screen-reader and installer smoke tests
remain release gates.
