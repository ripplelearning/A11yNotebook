# User guide

## Open a library

Choose **File → Open library** and select a folder. The folder stays on disk as an ordinary folder. Subfolders appear
as notebooks, managed `.md` and `.html` files as notes, and other files as attachments. The last opened library is restored next time.

Choose **File → Back up library** to copy the whole open library to a new timestamped folder inside a folder you
choose. The copy includes the library's private metadata, so the backup folder opens as a library in its own right.
Encrypted files stay encrypted in the copy: nothing is decrypted for the backup. The app counts the copied files and
verifies the copy matches the library before reporting success; a failed copy is removed rather than left behind as
a partial backup. The backup never overwrites an existing folder, and it refuses a destination inside the library
or one that contains it.

## Create in the current view

**New** (Ctrl+N by default) creates the kind of item appropriate to the active view:

| Active view                                                       | New workflow                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Libraries                                                         | Create a **new local library**, choosing a parent folder and a new name in the native dialog; an existing folder is never overwritten |
| Notebooks                                                         | Create a notebook in the open library                                                                                                 |
| Notes and Files                                                   | Create a note in the selected notebook                                                                                                |
| Tasks                                                             | Choose an associated note and add a persisted checkbox task, with optional due date and priority                                      |
| Cognitive Tools                                                   | Choose Outline, Mind map, Flashcards, CSV Grid, or Markdown grid, then name and create the tool at the library root                   |
| Note tabs, Contents, Reminders, previews, and Welcome | Create a note using the current notebook context, or the library root when no notebook is selected                                    |

The explicit **New notebook** command still creates a notebook; it has not been redefined to mean contextual New.
Settings can change or disable New's shortcut, with conflict validation. The native File menu and command palette expose
the same commands. Cancel leaves existing files and unsaved edits intact; save or resolve pending edits when requested.
New notes use Markdown by default; the creation dialog also offers HTML. Views that need an open library explain
that prerequisite rather than silently creating a different kind of item.

## Navigate files

Use the **Library files** tree. Up and Down move between visible items; Right expands a notebook or enters its first
child; Left collapses or moves to its parent. Home and End move to the first and last visible item. Enter opens a
managed note or a supported managed preview. External or unknown-origin documents use Open With rather than being
silently treated as app-created notes. F2 opens a rename dialog. Delete asks before moving it
to the Recycle Bin. Type a letter to find the next item beginning with that letter; `*` expands sibling notebooks.

Use **File → New note**, **File → New notebook**, or **Tools → Import file**. Imported files are copied into the
selected notebook. Select a tree item before using **Tools → Reveal selected item in Explorer** or **Open selected item
in external app**. These commands use the current selection, not a previously selected item.

The Windows/Electron build has a native menu bar with **File**, **Edit**, **View**, **Insert**, **Format**, **Tools**, and
**Help**. Use Alt and the underlined mnemonic, then the arrow keys, Enter, or Escape. Menu commands have no hard-coded
accelerators; the app's configurable shortcuts (including Ctrl+K and F6/Shift+F6) remain the single shortcut path.
The application menu replaces the duplicate in-page command groups. In a browser without the Electron bridge, a compact,
accessible HTML command fallback remains available. Context-specific controls such as the formatting toolbar, reader
page/zoom controls, tab close buttons, and dialog actions stay beside the content they operate on.

The installed and portable builds use the same navigation and creation workflows. Ctrl+1 announces **Libraries**
or the open library's name; Ctrl+2 announces **Notebooks** or **Notebooks in [library name]**; Ctrl+3 announces
**Notes and Files in [notebook name]** when a notebook is selected. Repeating a shortcut announces the view again.
Notebook context remains selected when you select a file row.

Notes & Files also has **New note from template**. Open and unlock a library before creating its contents.

Shift+F10, the Applications key, or right-click opens the global context menu. Its registry-backed commands depend
on the focused item: library files, tabs, selected editor text, links, tasks, search results, annotations, reminders,
and attachment previews have different actions. Use Up/Down, Home/End, type-ahead, Enter/Space, or Escape. Disabled
actions are announced as unavailable, and Escape returns focus to the invoking element. The menu does not replace
modal-dialog keyboard behavior.

### Paste files and folders

Copy files or folders in File Explorer, then paste them while focus is in the main panel (not inside an
editor). Where they land depends on the view. In **Libraries**, a pasted folder asks whether to make an
app-specific copy of the library (you then choose where to save it) or use the original folder as the
library; files sitting directly in the pasted folder ask how to organize them, one notebook for all files or
one notebook per file, because a library cannot hold files outside a notebook. In **Notebooks**, a pasted
folder becomes a notebook in the current library, and pasted files go into the selected notebook. In
**Notes and Files**, only files paste, into the selected notebook. Pasted copies are verified file by file;
a failed copy is removed and reported. The clipboard path step has not yet been confirmed with a real
Windows copy/paste run.

### Managed documents and older libraries

App creation and explicit import record provenance separately in `.a11ynotebook/provenance.json`; the original
document does not acquire an embedded app marker. File extensions and notebook membership alone do not establish
origin. Existing libraries without these records remain readable on disk and are not automatically relabelled as
app-created: legacy/unknown files require explicit import before opening internally.
An exception preserves access to older encrypted libraries: a recognized encrypted-note envelope offers explicit
confirmation to use the existing unlock workflow. Content is shown only after authenticated decryption succeeds;
this does not silently classify other legacy files as app-created. Cancel leaves the encrypted file unchanged.

For a compatible external file, use **Import into A11y Notebook** from its context menu to create a managed copy.
The original is preserved. Markdown and HTML notes support reading and editing; supported text, image, PDF, ePub
and DOCX previews are read-only unless a dedicated tool editor is provided (for example, a CSV grid).
Unsupported or invalid formats are not offered as editable imports; oversized, unsafe, or malformed input is
rejected. Cancelling an import does not modify the original. Keep the metadata folder when copying a whole library;
missing records are handled conservatively, not reconstructed from timestamps or filenames.

On Windows, **Open With** asks Windows to choose an application for a document; **Open externally** uses the
existing default association. Choosing an application once does not silently change defaults. To change the default,
use the **Choose default application…** context action and confirm the Windows Default Apps settings option. In Windows 11, search Settings → Apps →
Default apps for the extension (for example `.txt`) and choose the default there; Windows 10 offers
**Choose default apps by file type**. Windows owns and confirms that choice: A11y Notebook does not edit registry
associations or claim a default changed merely because Settings opened. The chooser is Windows-only; on other
platforms use the existing default application or the operating system's own file-type settings.
Microsoft documents that [SHOpenWithDialog cannot change defaults on Windows 10 and later](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shopenwithdialog).
Executable programs, scripts, and shortcuts are not document imports or supported external document actions.

**Move** chooses a destination notebook. Save all open edits before a rename/move; the native confirmation
lists notes whose links will change. Cancelling leaves the files untouched. Bookmarks, annotations, image
descriptions, flashcard schedules, and reminders follow app-managed moves. Ambiguous title links are not repaired;
use qualified wiki paths such as `[[Notebook/Title]]`. Reference-style Markdown links are not repaired.

## Read and edit notes

Notes open in tabs. Create either Markdown (`.md`) or HTML (`.html`) notes using the **Note format** selector.
Opening the same note again reuses its tab; opening another note keeps existing notes and their unsaved edits.
Navigation views do not close note tabs. Ctrl+Tab cycles open tabs, and arrow keys navigate the tab strip.
Closing an active tab returns to Welcome and focuses the tab strip; cancelling an unsaved-change confirmation
keeps the note open. Reopening a closed note reloads its saved content and reapplies the default mode.
In **Settings → Default note open mode**, choose **Read mode** (the default, including older settings)
or **Edit mode**. This preference applies to managed notes when opened or activated; it does not make read-only
document previews editable or bypass an encrypted-note or editing lock. Ctrl+E remains the explicit editing toggle.
The read view contains semantic content; Markdown renders with unsafe raw HTML removed, and HTML notes are sanitized
on load, edit, paste, save, and render. Scripts, forms, active embedded content, event handlers, remote images, and
unsafe URL schemes are not allowed. HTML images must have alternative text and use local raster files.
Toggle **Read-only/edit mode** with Ctrl+E. **Plain source** edits Markdown or HTML source in a native text area;
**Rich text** exposes an accessible formatting toolbar and multiline textbox. Ctrl+S saves immediately; edits also
save after a short idle period. A tab marks unsaved content and asks before discarding it when closed.

App-managed renames, moves, and saves retain provenance. Ordinary external in-place edits retain it too;
externally replaced files or files renamed outside the app may become unknown and require explicit import again.

### Mathematics

Write math as plain ASCII shorthand and the app turns it into MathML, which browsers render and screen
readers can read. Supported shorthand includes sqrt(x), frac(a,b), pow(a,b), abs(x), log(x), x^2, x_1,
pi, greek letters, div for the division sign, rad as a radians unit, and scientific notation such as
1.5e3 or 3x10^8. The original ASCII is kept in the MathML `alttext` attribute.

Open **Insert → Insert math** or press Alt+= to show the Mathematics toolbar in the rich-text editor.
Type ASCII math there, use the template buttons for fractions, roots, powers, and more, check the live
preview, and choose Insert math. While typing directly in a note, a completed function call, power, or
scientific-notation value at the caret converts to MathML automatically; ordinary words never convert.

Markdown notes store math as a `` `math:` `` code span (for example `` `math:sqrt(16)` ``), which renders
as MathML when reading and converts back when editing, so math survives the Markdown round trip. HTML
notes store the MathML element directly. Plain-text notes keep the ASCII as typed.

### Windows accessibility and application-chooser checks

Automated tests do not verify spoken output or the real Windows application chooser. With a backed-up test
library, check both the installed and portable builds:

- With NVDA, JAWS, or Narrator, repeat Ctrl+1 through Ctrl+5, with and without an open library/notebook.
  Confirm one contextual destination announcement, without competing focus/status speech.
- Use Ctrl+N in each view; cancel and complete creation. Verify unsaved work and locked libraries remain protected.
  Create/save/reopen all five cognitive tool types and confirm a new task survives library reopening.
- Select a different file row and repeat Ctrl+3/Ctrl+N; confirm the selected notebook remains the creation context.
  Check both visible note/template buttons.
- Save each default note-open mode and open, switch, close, and reopen notes. Confirm Ctrl+E still works and an
  editing lock cannot be bypassed.
- On an unknown file, test Open With with spaces and non-ASCII filenames. Cancel the Windows chooser and verify
  the existing association is unchanged. If Windows offers a default-app choice, test it only on a disposable
  file type, verify subsequent OS opening, and restore the original association afterward.
- Import compatible external files, including HTML with active content. Confirm the copy opens internally,
  unsafe HTML is removed, the original is unchanged, and rename/move/reopen retain the copy's provenance.

The native Format menu and contextual formatting toolbar offer bold, italic, heading levels 1–6, lists, quote, and fenced code.
Ctrl+B/Ctrl+I format the selection; Ctrl+K (or Ctrl+Shift+L) opens a link dialog with a note picker. The table dialog chooses
rows and columns. Insert image or attachment chooses an already imported library file and requires a text description.
Rich-text paste keeps safe semantic formatting. The rich editor supports bold, italic, underline, strikethrough,
headings, lists, block quotes, code, links, tables, and local images with required descriptions. Format conversion
creates a warned sibling copy and preserves the original. In an HTML note, **Insert checklist task** adds a semantic
task item. Edit its title in rich text; edit its stable ID, completion, due date, priority, or reminder attributes in
HTML source. Plain-source formatting commands continue to target the Markdown editor. The editor attempts to preserve
native undo; fallback programmatic insertion may not retain an undo entry.

External edits reload clean notes silently. If you have unsaved text, autosave pauses and a conflict dialog offers
**Keep mine** (explicitly save your version), **Load disk version**, or **Save copy** (a new timestamped note).
Removed notes offer Save copy. Escape leaves the conflict unresolved and tells you to choose a resolution; it does
not discard your edits. Switching libraries is blocked until unsaved work is saved or resolved.

### Spelling, grammar, and thesaurus

**Tools → Spelling and Grammar Check** (F7) opens a dialog like the one in Word. It walks through each
issue in the current note, in order, showing the word, the sentence around it, and an explanation for grammar
issues. For each issue you can Ignore Once, Ignore All (or Ignore Rule for grammar), Add to Dictionary, Change,
or Change All. A free-text Replace with box lets you type your own replacement, and Undo steps back one change.
Changes are collected and applied to the note only when you close the dialog. Code blocks and inline code are
not checked, and all-caps acronyms are skipped. The grammar check covers repeated words, a/an choice,
could/should/would/must of (for have), a lowercase pronoun i, its/it's confusion, alot, and common missing
apostrophes. It is pattern-based, not a full grammar engine, so it will not catch every error.

**Tools → Thesaurus** (Shift+F7) looks up synonyms for the selected word, grouped by part of speech. Each
synonym offers Look up (to look that word up instead) and, in edit mode with a selection, Replace with this
word. If nothing is found, it suggests similarly spelled words. The bundled word list has synonyms only, no
antonyms. Words added from the spelling check live in the custom dictionary, editable in
**Settings → Custom dictionary, one word per line**. All spelling, grammar, and thesaurus work runs on your
device; nothing is sent anywhere.

## Search

Type in **Global search**; queries wait 250 ms after typing. A main-process index is stored under
`.a11ynotebook/search-index.json` and refreshed incrementally when files change. Results show match context and
announce the displayed count through the status bar. **Search scope** is a visible control above the filters:
**Current notebook** searches only the selected notebook (including its sub-notebooks) and, with no notebook
selected, shows guidance instead of searching the whole library; **Whole library** searches every notebook.
The scope is remembered on this device. In Whole library scope, the notebook filter in Search filters can still
narrow results to one notebook. Search filters also select note/attachment kind, tag,
and modified-date range. `#tag` terms also filter by tag. Inline hashtags and supported front-matter tag fields
are indexed; this is not a general YAML editor. Text/CSV/HTML attachment and note contents, plus bounded PDF/ePub
extracted text, are searchable. Unsupported or invalid attachments are searchable by filename. Results are capped at
100 in the UI.

## Tasks

Choose **View → Tasks** or use the command palette. Markdown checkboxes and semantic HTML tasks appear
in a sortable table; status, due-date, priority, and notebook filters narrow the list. Checking/unchecking a Markdown
task updates its source checkbox. HTML tasks update only the completion attribute on the matching stable task ID;
stale note revisions or duplicate/missing IDs fail safely. Markdown optional dates use `due:YYYY-MM-DD` or
`📅 YYYY-MM-DD`; priorities use `priority:<option>`, where the options are the library's configured priority
list (displayed as Critical, High, Medium, Low, and Optional by default). Legacy `low`, `normal`, `high`, and
`urgent` values still parse.

Open the context menu on a task row (Shift+F10, the Applications key, or right-click) for **Set due date**,
which opens a dialog with due date, due time, and an optional reminder, and **Set priority**, which opens a
dialog with the library's priority options and lets you add, rename, or delete options. At least one priority
option is always kept, and option names are single words so they survive in task lines.

The same context menu offers **Link to note**, **Link to file**, and **Link to Notebook**. Each opens a
dialog listing the library's notes, files, or notebooks; choosing one links it to the focused task. Linked
items appear in the Links column of the Tasks table, where each link can be opened or removed. Links are
stored in `.a11ynotebook/task-links.json`.

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

## Citations and bibliographies

Each notebook keeps its own bibliography. From the Insert menu, choose **Citation generator…**
(Ctrl+Shift+C) to create an entry: pick the source type (book, journal article, website, book chapter,
conference paper, report, or thesis), then fill in the fields by hand or paste a DOI, ISBN, or web address
and choose **Fill in from source** to fetch the public record (Crossref for DOIs, Open Library for ISBNs,
the page's own metadata for URLs). Choose APA, MLA, or Chicago to preview the bibliography entry and the
in-text citation, then save it to the notebook's bibliography. Choose **Bibliography…** (Ctrl+Shift+J) to
view, edit, or delete saved entries, insert an in-text citation for one of them (with an optional cited
page), or insert the full bibliography into the current note. Entries are stored in the library's
bibliography file, move with the notebook when it is renamed or moved, and stay encrypted when the
library is encrypted.

## Annotations

In read mode, select text with keyboard selection or the screen reader's supported selection command, then press
Ctrl+Shift+A or choose Annotate selection. Give the highlight a **text label**, color, and optional comment.
Annotations appear under the right-pane heading with Jump, Edit, and Delete controls. Highlights expose descriptions
and are underlined, so color is never the only cue. Quote/context/offset anchors try to find shifted text; ambiguous,
changed, or overlapping anchors are reported in the list rather than attached to unrelated text.
Annotations persist in `.a11ynotebook/annotations.json` unless scoped annotation/checkpoint protection is explicitly
enabled, in which case the authenticated encrypted container is authoritative. The same text annotation UI works on sanitized `.html` note
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
Switch between the labelled table and Overdue/Today/This week lists. Snooze for 5/15/30/60 minutes, 1 day, or until the
same local clock time tomorrow; Dismiss removes an item from active views. Clicking a native notification opens
its note when the library is still open. Windows notification settings may suppress delivery.
The scheduler runs only while the application is running; missed pending reminders fire on next launch, and
already-fired reminders remain visible until dismissed. Reminder state persists in `.a11ynotebook/reminders.json`.
The creation dialog can save time, snooze, title privacy, and notification choices as future defaults in
`.a11ynotebook/reminder-defaults.json`; existing standalone reminders retain their choices. Task notifications
use the current privacy/notification preferences. Due flashcard notifications are opt-in and share the same
scheduler and persisted delivery tracking. Closing the last window exits the app on Windows; no notifications
are delivered after process exit.

### In-app reminder alerts

In **Settings**, enable **in-app reminder alerts** independently of native Electron/Windows notifications.
Configure **Play reminder sound**, the bundled sound choice and volume; **Test sound** previews the selected sound.
System mute is respected. While the app is running, sound can play when its window is unfocused or minimized.
The alert waits until you focus A11y Notebook; it never brings the app in front of another application.

The bundled `src/assets/reminder-gentle-chime.wav` is an original generated asset distributed under this project's
MIT license, not a third-party recording. It is 0.6 seconds of mono 16-bit PCM at 22,050 Hz: sequential 660/880 Hz
sine tones with squared-sine fades and a peak amplitude of 9,000. No downloaded sound or additional runtime
dependency is used.

The accessible alert takes keyboard focus and presents queued reminders one at a time with a waiting count.
Use **Mark Complete** to complete the linked source task (conflicting note edits must be resolved first), or complete
a standalone reminder. **Dismiss** and **Snooze** use the existing reminder service; the alert offers 5 minutes,
15 minutes, 30 minutes, 1 hour and 1 day (24 hours). The legacy Tomorrow choice keeps the same local time on the
next calendar day, which can differ across daylight-saving changes. Tab/Shift+Tab stay within the dialog and focus returns after it closes.
Outcomes are announced in the status region. **Escape/Later closes the alert without dismissing the reminder**;
the item remains in Reminders. Hidden-title alerts use generic text.
Switching libraries cancels the old library's alert queue. Startup missed reminders use the same queue.
The startup sound replay buffer retains the latest 100 deliveries; older overflow reminders remain available in
the visual queue and Reminders but load silently. Previously fired reminders also reload silently to avoid repeating sound.

**Locked-library delivery is partial:** locking stops the existing scheduler and cancels queued alerts/sound.
No titles are exposed, but reminders due while locked do not sound or produce the requested generic unlock alert.
Unlocking restarts scheduling and catches up missed reminders. A generic privacy-safe locked-delivery snapshot
on the same scheduler remains open; do not rely on reminder delivery until the library is unlocked.

This is not exited-process delivery: **nothing fires after A11y Notebook exits**. Actual Windows background/minimized
sound and focus, and JAWS/NVDA/Narrator announcements, still need manual verification.
Tasks also show per-notebook completion counts and native progress elements.

The **Calendar** is one calendar for the whole library, opened with **Ctrl+6**, **Tools → Calendar** in the
app menu, **View → Calendar** in the native menu, or the command palette's **Calendar** command. Appointments
are stored in the library's `.a11ynotebook/calendar.json` and may stand alone or link to a note, file, or task.
The **Agenda** view lists upcoming occurrences grouped under date headings, with previous/next 30-day and
Today controls. The **Month grid** is a table with a button per day labelled with its appointment count;
choosing a day lists that day's appointments below the grid. **New appointment** offers title, all-day or
timed start and end, location, description, recurrence (daily, weekly, monthly, yearly, with interval, count,
end date, and weekly weekdays), and an optional link. Editing or deleting a recurring appointment changes or
removes the whole series, not just one occurrence; deletion asks for explicit confirmation. The calendar is
local to the library for now: live sync with Google, Outlook, and Apple Calendar is planned next and is not
yet available. Windows screen-reader verification has not been run.

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
Grids use arrows, Home/End, and Ctrl+Home/End to navigate; Enter/F2 edits, Enter commits, Escape cancels, and
Shift+Enter inserts a line break. Space sorts a focused header; labelled controls sort and change rows/columns. The save
format defaults to the current file type; select the matching format before saving.
Decks use `question :: answer` or `Q:`/`A:` blocks. Reveal the answer, then rate Again/Hard/Good/Easy.
SM-2-style schedules persist in `.a11ynotebook/flashcards.json` and changes to a question/answer start new history.
Save before closing cognitive tools or switching files; unsaved data is kept while switching to another tab.
External asset changes are rejected at save time; preserve your work separately before closing/reopening to reload.

### Encrypted cognitive checkpoints

After explicitly enabling scoped annotation/checkpoint protection in an unlocked version-3 library, edits to outlines,
mind maps, flashcards and CSV/Markdown grids are checkpointed after a 750 ms debounce. Persistent recovery is disabled
without that consent; there is no plaintext-draft fallback. Source asset files themselves remain ordinary files.
Records retain the saved baseline and its hash, have a seven-day expiry, and are bounded to 20 records, 2 MiB per
content/baseline and 8 MiB total. Checkpoint status/errors are visible; a crash during debounce can lose the latest edits.

Reopen an asset to receive **Restore / Discard / Compare** choices. Compare shows the draft and source without writing.
Restore places the draft in the editor as **unsaved** content. If the source changed since the baseline, a conflict
warning is shown; nothing silently overwrites the file. Discard removes the checkpoint, not the source.
Malformed outline, mind-map or grid drafts can be compared/copied but cannot be restored into their structured
editors until the content is valid; they are not silently discarded.
Successful saves retire the matching checkpoint; app-managed moves/renames and deletes update draft paths/lifecycle.
Locking/switching clears the editor and rejects stale checkpoint requests. Save important work explicitly.

## Export and web capture

Use **File → Export current note…** on an open note, or **Export note…** in
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

Text and CSV have a text view/table. Raster images use a library-validated custom protocol and have an editable
description saved in metadata. Image references require local raster files. PDF uses a bundled local pdf.js worker
for a bounded canvas page, selectable text, zoom/rotation, separate semantic page text,
page navigation, in-document search, and persisted PDF notes. ePub uses local epub.js paginated spine rendering,
a nested navigation table of contents and section navigation/search. Chapter markup is sanitized; broader hostile-
archive/resource validation, reading-position persistence and ePub annotations remain open. Extracted ePub text remains available
for search and assistive technology; scripts, embedded frames, forms, and unsafe attributes are removed before display.
Both are limited to 40 MB.
DOCX uses a local bounded parser and semantic reader with headings, lists, tables, safe links, raster images,
navigation and search. Encrypted Office archives, macros, embedded OLE packages and unsafe external resources are
rejected. DOCX annotations are not available; legacy binary `.doc` is unsupported.
**Open in external app** remains available. Text previews are limited to 5 MB and images to 20 MB.

## Settings

Settings sections have visible semantic headings for screen-reader heading navigation: **General editing and autosave**,
**Appearance and interface**, **Reminder alerts**, **PDF Reading**, **Keyboard Shortcuts**, and **Library security**.
Scoped metadata encryption has its own heading when available, with security subsections under Library security.

In **Appearance and interface**, **Zoom in percent** scales the whole interface from 50 to 200 percent; unlike
font size, which grows text only, Zoom grows buttons, spacing, and everything else with it. **Focus indicator**
offers a high-visibility option with thicker, more offset outlines, and **Reduce motion** turns off interface
animations and transitions. **Show command/action buttons in the UI** restores the button-rich application
layout. It is off by default, including for older settings files, to favor the native-menu-first design.

**Automatic backups**, in the same section, copies the whole library folder on a schedule you choose: every 1 to
30 days, keeping the newest 1 to 50 copies and deleting older ones. A backup runs when the library is opened and
at most once per interval while the app runs, and only the saved content is copied, so save first if it matters.
Backups live outside the library, in the folder you name or, if you leave it blank, a Backups folder next to the
library. Encrypted files stay encrypted in the copy, and a backup opens as a library in its own right. Automatic
backups are off until you turn them on.
The native menu remains available in either mode. Essential navigation, content, dialog, form, and Settings controls
remain available; browser development without the native bridge retains command buttons. This preference and
shortcut edits apply only after **Save settings**; **Cancel** discards them, and reset changes the draft.
The saved preference survives restarts in library settings and app defaults.

Every command in **Keyboard Shortcuts** has both a textbox for manual entry and a uniquely labelled **Capture Shortcut**
button. Activate the button, then press Ctrl/Alt with a letter or number, or an F1–F12 combination (Ctrl/Alt/Shift
modifiers are supported). The listening command and result are announced. A valid, nonconflicting combination is
normalized into that command's draft textbox and focus returns there; it is not saved automatically.
Modifier-only presses wait, repeats are ignored, and unsupported input, IME composition, and AltGraph leave the old
value unchanged. Conflicting bindings, fixed aliases, and reserved navigation/editing keys are rejected with feedback;
try again or cancel. **Escape**, **Tab**, or **Cancel capture** cancels without changing the binding; Escape during
capture does not close Settings. Tab retains normal dialog navigation. Starting another capture replaces the old one.
Reset, save, close, and leaving Settings stop capture. Application shortcuts and native menu accelerators are
suspended while listening, but operating-system-reserved combinations cannot always be intercepted.

**Settings** (Ctrl+Alt+S) changes autosave delay (0 disables it), dark/light/high-contrast theme, font size,
and command shortcuts. Conflicts with command defaults and reserved navigation/editing keys are rejected.
Blank shortcuts disable a command binding; reset restores defaults. Settings are saved in the library's
`.a11ynotebook/settings.json` and app userData defaults. Keyboard Shortcuts and the palette display active bindings;
the generated documentation lists defaults. Library idle locking is available in Security settings. Reminder defaults
are saved from the reminder creation dialog; in-app alert/sound preferences are available in Settings.

## Security

Security settings can enable the library password gate and configure idle locking. Selected notes can use distinct
passwords through **Encrypt note**; the dialog can generate a password and clear it from the clipboard after 30
seconds if it has not been replaced. To opt in to library recovery, open Settings → Library security while the library is
unlocked, confirm the current library password, then save the displayed one-time recovery key separately and check the
acknowledgment before committing it. The app never copies the recovery key automatically. Recovery can reset the library
password and preserves migrated credentials and library-key-encrypted notes; it cannot recover notes with independent
passwords. You can rotate the recovery key after saving its replacement or revoke recovery after confirming the current
password. Losing a note password is unrecoverable. Library protection gates app access but does not encrypt unmarked
files, filenames, search indexes, or most metadata.

Scoped annotation/checkpoint protection requires an unlocked **version-3** library (enable recovery first for older
configs) and explicit consent. It protects only Markdown/HTML/PDF annotations and cognitive checkpoints.
**Search index/snippets, link index, bookmarks, reminders, settings, flashcard schedules, image
descriptions, source files, attachments and exports remain plaintext. This is not whole-library encryption.**
Migration removes the old annotation store after committing authenticated ciphertext; deleted plaintext may still
persist on disk or in backups. Tampered/missing protected data fails closed, never silently falls back to plaintext.
Recovery password reset and recovery-key rotation/revocation preserve protected stores; independent note passwords
remain separate. See [Security](security.md) before storing sensitive information.

### Sensitive-action history

The app keeps a small local `.a11ynotebook/audit.json` log of protection, recovery, credential access/changes,
note encryption and export requests. It contains only the operation category, result and time, never passwords,
keys, credentials, note text or paths. It retains at most 1,000 entries from the last 90 days when a new entry is
written. This plaintext local file can be changed/deleted by anyone with your OS account and is not a forensic proof.

If a warning says an entry was **not recorded**, read its operation outcome: a successful change/export remains
successful, and a committed operation may have encountered later cleanup/indexing errors. Do not repeat the
operation merely to retry logging. Check disk space and metadata permissions; a damaged log is not silently
deleted or overwritten. There is no in-app history/repair viewer. Automatic idle/exit/switch locks and ordinary
editing are not logged. See the security documentation for exact limits.

## Keyboard shortcuts

| Shortcut                                                     | Action                                         |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Ctrl+O                                                       | Open library                                   |
| Ctrl+N                                                       | New item in the current view                   |
| Ctrl+W                                                       | Close current note tab                         |
| Ctrl+E                                                       | Toggle read/edit mode                          |
| Alt+Q                                                        | Focus global search                            |
| Ctrl+Shift+P                                                 | Open command palette                           |
| Ctrl+K                                                       | Insert link                                    |
| Ctrl+Tab / Ctrl+Shift+Tab                                    | Switch to next / previous open tab             |
| Ctrl+S                                                       | Save the current note                          |
| Ctrl+D                                                       | Bookmark or unbookmark the current note        |
| F1                                                           | Show keyboard shortcuts                        |
| F5                                                           | Refresh the library tree                       |
| F6 / Shift+F6                                                | Move focus to next / previous pane             |
| Alt+1 / Alt+2 / Alt+3                                        | Focus navigation / main / right pane           |
| Alt+Left / Alt+Right                                         | Go back / forward in browsing history          |
| F9                                                           | Show or hide the right pane                    |
| Shift+F10 / Applications key / right-click                   | Open the context-aware command menu            |
| In the tree: Up/Down, Left/Right, Home/End                   | Navigate and expand/collapse                   |
| In the tree: Enter, F2, Delete, `*`, first-letter type-ahead | Open, rename, delete, expand siblings, or find |

## Accessibility notes

Use Tab for normal controls, and F6 or Shift+F6 to move between the application panes. Plain-source mode uses a
native textarea; rich-text mode uses a labelled multiline editor and a one-tab-stop toolbar. Manual JAWS, NVDA, and
Narrator testing is still needed; see the [testing strategy](accessibility/testing-strategy.md).

## Not available yet

Whole-library encryption and encryption of excluded indexes/metadata are not available. Cognitive checkpoints require
explicit scoped protection consent; save important edits explicitly, including while persistent recovery is disabled.
DOCX local reading is implemented; DOCX annotations and legacy `.doc` local reading remain unavailable.
Reminders require the app process to be running: no opt-in Task Scheduler/helper integration ships here, and closing
a window must not be assumed to preserve notifications after process exit.
Format conversion creates a warned sibling copy and keeps the original; complete loss analysis and in-place conversion
remain open. PDF sidebar/export/lifecycle workflows, ePub annotations, and broader document lifecycle features are open implementation
work, not externally blocked. See the [reader and annotation follow-up plan](roadmap.md#document-reader-and-annotation-follow-up-plan).
Recent-library selection, heading and position bookmarks, general YAML
metadata editing, and calendar organization remain open.
Manual Windows screen-reader and UI Automation smoke tests have not been run.
