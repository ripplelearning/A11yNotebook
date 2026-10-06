# User guide

## Open a vault

Choose **Vault → Open vault** and select a folder. The folder stays on disk as an ordinary folder. Subfolders appear
as notebooks, `.md` and `.html` files as notes, and other files as attachments. The last opened vault is restored next time.

## Navigate files

Use the **Vault files** tree. Up and Down move between visible items; Right expands a notebook or enters its first
child; Left collapses or moves to its parent. Home and End move to the first and last visible item. Enter opens a
note or a supported preview. Unsupported attachments open externally. F2 opens a rename dialog. Delete asks before moving it
to the Recycle Bin. Type a letter to find the next item beginning with that letter; `*` expands sibling notebooks.

Use **New note**, **New notebook**, or **Import file** in the navigation pane. Imported files are copied into the
selected notebook. The tree's filesystem context may be revealed in Explorer or opened in its default external app
using the corresponding vault actions.

Shift+F10, the Applications key, or right-click opens the global context menu. Its registry-backed commands depend
on the focused item: vault files, tabs, selected editor text, links, tasks, search results, annotations, reminders,
and attachment previews have different actions. Use Up/Down, Home/End, type-ahead, Enter/Space, or Escape. Disabled
actions are announced as unavailable, and Escape returns focus to the invoking element. The menu does not replace
modal-dialog keyboard behavior.
**Move** chooses a destination notebook. Save all open edits before a rename/move; the native confirmation
lists notes whose links will change. Cancelling leaves the files untouched. Bookmarks, annotations, image
descriptions, flashcard schedules, and reminders follow app-managed moves. Ambiguous title links are not repaired;
use qualified wiki paths such as `[[Notebook/Title]]`. Reference-style Markdown links are not repaired.

## Read and edit notes

Notes open in tabs. Create either Markdown (`.md`) or HTML (`.html`) notes using the **Note format** selector.
The read view contains semantic content; Markdown renders with unsafe raw HTML removed, and HTML notes are sanitized
on load, edit, paste, save, and render. Scripts, forms, active embedded content, event handlers, remote images, and
unsafe URL schemes are not allowed. HTML images must have alternative text and use local raster files.
Toggle **Read-only/edit mode** with Ctrl+E. **Plain source** edits Markdown or HTML source in a native text area;
**Rich text** exposes an accessible formatting toolbar and multiline textbox. Ctrl+S saves immediately; edits also
save after a short idle period. A tab marks unsaved content and asks before discarding it when closed.

The Format menu and formatting toolbar offer bold, italic, heading levels 1–6, lists, quote, and fenced code.
Ctrl+B/Ctrl+I format the selection; Ctrl+Shift+L opens a link dialog with a note picker. The table dialog chooses
rows and columns. Insert image or attachment chooses an already imported vault file and requires a text description.
Rich-text paste keeps safe semantic formatting. The rich editor supports bold, italic, underline, strikethrough,
headings, lists, block quotes, code, links, tables, and local images with required descriptions. Format conversion
creates a warned sibling copy and preserves the original. In an HTML note, **Insert checklist task** adds a semantic
task item. Edit its title in rich text; edit its stable ID, completion, due date, priority, or reminder attributes in
HTML source. Plain-source formatting commands continue to target the Markdown editor. The editor attempts to preserve
native undo; fallback programmatic insertion may not retain an undo entry.

External edits reload clean notes silently. If you have unsaved text, autosave pauses and a conflict dialog offers
**Keep mine** (explicitly save your version), **Load disk version**, or **Save copy** (a new timestamped note).
Removed notes offer Save copy. Escape leaves the conflict unresolved and tells you to choose a resolution; it does
not discard your edits. Switching vaults is blocked until unsaved work is saved or resolved.

## Search

Type in **Global search**; queries wait 250 ms after typing. A main-process index is stored under
`.a11ynotebook/search-index.json` and refreshed incrementally when files change. Results show match context and
announce the displayed count through the status bar. Search filters select notebook, note/attachment kind, tag,
and modified-date range. `#tag` terms also filter by tag. Inline hashtags and supported front-matter tag fields
are indexed; this is not a general YAML editor. Text/CSV/HTML attachment and note contents, plus bounded PDF/ePub
extracted text, are searchable. Unsupported or invalid attachments are searchable by filename. Results are capped at
100 in the UI.

## Tasks

Choose **Open Tasks** in the navigation pane or command palette. Markdown checkboxes and semantic HTML tasks appear
in a sortable table; status, due-date, priority, and notebook filters narrow the list. Checking/unchecking a Markdown
task updates its source checkbox. HTML tasks update only the completion attribute on the matching stable task ID;
stale note revisions or duplicate/missing IDs fail safely. Markdown optional dates use `due:YYYY-MM-DD` or
`📅 YYYY-MM-DD`; priorities use `priority:low|normal|high|urgent`.

HTML checklist items are `<li>` elements with a unique stable ID and completion state, for example:

```html
<ul>
  <li
    data-a11y-task-id="task-1234"
    data-a11y-task-complete="false"
    data-a11y-task-due="2026-10-05"
    data-a11y-task-priority="high"
  >
    Read chapter
  </li>
</ul>
```

Optional `data-a11y-task-remind="YYYY-MM-DD HH:mm"` schedules the same local-time reminder workflow as Markdown
tasks. HTML tasks contribute to due/priority indexing, sorting and notebook progress summaries. Encrypted note
envelopes are not parsed or exposed as tasks.

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
Annotations persist in `.a11ynotebook/annotations.json`. The same text annotation UI works on sanitized `.html` note
content. PDF notes use a separate page/quote anchor contract:

- Select PDF text, then choose **Annotate PDF selection** in the palette or the
  Shift+F10 / Applications / right-click context menu.
- Without a browser selection, use **Annotate a quote**, search for the quote,
  and explicitly choose a match using its page/context preview.
- Focus a paragraph, heading, or cell in accessible page text and choose
  **Annotate this paragraph/heading/cell**.
- Supply a label or comment (or both), choose a labelled color or None, and
  Save. Tab/Shift+Tab stay in the dialog; Escape cancels. Comments support
  multiple lines.

PDF highlights follow zoom and rotation. Notes show resolution confidence;
missing quotes are retained as orphans, and changed files require manual
verification rather than silently moving highlights. The reader displays one
page at a time; cross-page pointer dragging is not available. PDF sidebar,
clipboard export, and broader lifecycle workflows are PHASE 5–7 follow-up.
ePub annotation UI remains unavailable.

## Reminders and project progress

Put `remind:2026-10-04 09:30` or `⏰ 2026-10-04 09:30` on an open checkbox task (local time).
Completed tasks do not notify. **Open Reminders** (Ctrl+Shift+R) also creates standalone note reminders.
Switch between the labelled table and Overdue/Today/This week lists. Snooze for 5/15/60 minutes or until the
same local clock time tomorrow; Dismiss removes an item from active views. Clicking a native notification opens
its note when the vault is still open. Windows notification settings may suppress delivery.
The scheduler runs only while the application is running; missed pending reminders fire on next launch, and
already-fired reminders remain visible until dismissed. Reminder state persists in `.a11ynotebook/reminders.json`.
The creation dialog can save time, snooze, title privacy, and notification choices as future defaults in
`.a11ynotebook/reminder-defaults.json`; existing standalone reminders retain their choices. Task notifications
use the current privacy/notification preferences. Due flashcard notifications are opt-in and share the same
scheduler and persisted delivery tracking. Closing the last window exits the app on Windows; no notifications
are delivered after process exit.
Tasks also show per-notebook completion counts and native progress elements. Named milestone CRUD and live
task-progress summaries are available through the typed vault bridge, persisted in `.a11ynotebook/milestones.json`.
Milestone and task identities survive notebook moves; missing tasks remain associated and are counted as missing.
A milestone planning UI is not yet available.

## Templates and cognitive tools

**New note from template** (Ctrl+Shift+N) offers Daily, Meeting, Project, Reading, and Lecture templates with a
read-only preview and Markdown/HTML output selector (Markdown is the default). Place safe editable Markdown or HTML
templates in `Templates/` to add your own; HTML templates are sanitized after expansion. Supported placeholders are
`{{title}}`, `{{date}}`, `{{time}}`, `{{weekday}}`, `{{notebook}}`, and `{{cursor}}`; the first cursor marker sets
the editing position. Built-ins convert to the selected format.

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

## Export and web capture

Use **Export note…** on an open note, **Export current note…** in the command palette/menu, or **Export note…** in
the note context menu. Choose standalone HTML or Markdown and then a location in the native save dialog. The source is
never changed; overwrites require native confirmation and the original source cannot be selected as the destination.
HTML output is sanitized in the main process, contains no scripts/forms/remote resources, and embeds bounded local
raster images. Relative links and other attachments are not copied or rebased. Annotation metadata is stored separately
and is not exported; Markdown conversion preserves checklist state/due date/priority where possible but not HTML task
IDs/reminder scheduling. Review format-loss and asset-portability warnings before sharing. Exporting an individually
encrypted or otherwise protected note requires checking the explicit consent box; locked content is never silently
decrypted for export.

Choose **Capture web page** and select Markdown or HTML output. The app accepts public HTTPS pages only, pins public
DNS addresses per request, revalidates redirects, and applies existing byte/image/deadline limits. HTML output keeps
semantic headings, lists, tables, safe links, and successfully downloaded raster images with their alt descriptions;
scripts, handlers, forms, and remote resources are removed. Source attribution uses the validated final URL. When
some images are unavailable or lack descriptions, the app announces the count and includes a notice in the saved note;
the captured note is opened and indexed.

## Attachment previews

Text and CSV have a text view/table. Raster images use a vault-validated custom protocol and have an editable
description saved in metadata. Image references require local raster files. PDF uses a bundled local pdf.js worker
for a bounded canvas page, selectable text, zoom/rotation, separate semantic page text,
page navigation, in-document search, and persisted PDF notes. ePub uses epub.js to navigate and search flattened spine-section text; it does not
provide styled reflow or a TOC. Both are limited to 40 MB.
**Open in external app** remains available. Text previews are limited to 5 MB and images to 20 MB.

## Settings

**Settings** (Ctrl+Alt+S) changes autosave delay (0 disables it), dark/light/high-contrast theme, font size,
and command shortcuts. Conflicts with command defaults and reserved navigation/editing keys are rejected.
Blank shortcuts disable a command binding; reset restores defaults. Settings are saved in the vault's
`.a11ynotebook/settings.json` and app userData defaults. Keyboard Shortcuts and the palette display active bindings;
the generated documentation lists defaults. Vault idle locking is available in Security settings; reminder-default
settings are not implemented.

## Security

Security settings can enable the vault password gate and configure idle locking. Selected notes can use distinct
passwords through **Encrypt note**; the dialog can generate a password and clear it from the clipboard after 30
seconds if it has not been replaced. To opt in to vault recovery, open Settings → Vault security while the vault is
unlocked, confirm the current vault password, then save the displayed one-time recovery key separately and check the
acknowledgment before committing it. The app never copies the recovery key automatically. Recovery can reset the vault
password and preserves migrated credentials and vault-key-encrypted notes; it cannot recover notes with independent
passwords. You can rotate the recovery key after saving its replacement or revoke recovery after confirming the current
password. Losing a note password is unrecoverable. Vault protection gates app access but does not encrypt unmarked
files, filenames, search indexes, or most metadata. Encrypted indexes, whole-vault encryption, and sensitive-action
audit history are not implemented; see [Security](security.md) before storing sensitive information.

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
| Shift+F10 / Applications key / right-click                   | Open the context-aware command menu            |
| In the tree: Up/Down, Left/Right, Home/End                   | Navigate and expand/collapse                   |
| In the tree: Enter, F2, Delete, `*`, first-letter type-ahead | Open, rename, delete, expand siblings, or find |

## Accessibility notes

Use Tab for normal controls, and F6 or Shift+F6 to move between the application panes. Plain-source mode uses a
native textarea; rich-text mode uses a labelled multiline editor and a one-tab-stop toolbar. Manual JAWS, NVDA, and
Narrator testing is still needed; see the [testing strategy](accessibility/testing-strategy.md).

## Not available yet

Recovery keys, whole-vault encryption, encrypted indexes, and sensitive-action audit logging are not available yet.
Format conversion creates a warned sibling copy and keeps the original; complete loss analysis and in-place conversion
remain open. PDF sidebar/export/lifecycle workflows, ePub styled reflow/TOC, and ePub annotations are open implementation
work, not externally blocked. See the [reader and annotation follow-up plan](roadmap.md#document-reader-and-annotation-follow-up-plan).
Recent-vault selection, heading and position bookmarks, milestone planning UI, general YAML
metadata editing, and calendar organization remain open.
Manual Windows screen-reader and UI Automation smoke tests have not been run.
