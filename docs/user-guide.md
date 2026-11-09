# User guide

## Open a library

Choose **File → Open library** and select a folder. The folder stays on disk as an ordinary folder. Subfolders appear
as notebooks, managed `.md` and `.html` files as notes, and other files as attachments. The last opened library is restored next time, on the notebook you last had open. Closing a library forgets it, so a closed library stays closed on the next launch.
Reopening a library shows that notebook's Notes and Files view; when no notebook was recorded, or the notebook is gone, it lands on the Notebooks view instead. **Ctrl+W** closes whatever is current: a tab, a selected notebook, or
the open library; closing a library closes everything inside it and returns to the Libraries view. To delete a library,
focus it in the Libraries grid and press **Delete**, or choose **Delete library** from its context menu; the confirmation
warns that everything inside the library goes too, and confirming moves the whole folder to the Recycle Bin.

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
| Notebooks                                                         | Create a notebook in the open library, choosing the Library root or the selected notebook as its location                             |
| Notes and Files                                                   | Create a note in the selected notebook                                                                                                |
| Tasks                                                             | Choose an associated note and add a persisted checkbox task, with optional due date and priority                                      |
| Cognitive Tools                                                   | Choose Outline, Mind map, Flashcards, CSV Grid, or Markdown grid, then name and create the tool at the library root                   |
| Note tabs, Contents, Reminders, previews, and Libraries | Create a note using the current notebook context, or the library root when no notebook is selected                                    |

The explicit **New notebook** command still creates a notebook; it has not been redefined to mean contextual New.
Settings can change or disable New's shortcut, with conflict validation. The native File menu and command palette expose
the same commands. Cancel leaves existing files and unsaved edits intact; save or resolve pending edits when requested.
New notes use Markdown by default; the creation dialog also offers HTML. Views that need an open library explain
that prerequisite rather than silently creating a different kind of item.

## Navigate files

In the main view, move through the Libraries, Notebooks, and Notes and Files grids with the arrow keys; Home and End move to the first and last row. Typing a letter jumps to the next item whose name starts with it, wrapping around, so pressing the same letter again cycles through every match. Enter opens the selected item: a managed note, a supported managed preview, or a notebook, which opens its Notes and Files view. A notebook's Notes and Files view shows its own notes and files plus the notebooks inside it; a sub-notebook's notes only appear when that sub-notebook is opened, so a note never shows under two notebooks at once. The Type column shows the file's real type — PDF, ePub, Word document, Excel spreadsheet, CSV, PowerPoint presentation — instead of the generic "Attachment". External or unknown-origin documents use Open With rather than being silently treated as app-created notes. F2 opens a rename dialog. Delete asks before moving an item to the Recycle Bin; Shift+Delete deletes permanently.
Deleting a note or notebook that contains tasks first warns how many tasks will be deleted with it, since tasks
live inside notes and have no separate copy. Space selects a row. To arrange notebooks, notes, and files in the library tree, use the Organize Library dialog below.

Use **File → New note**, **File → New notebook**, or **Tools → Import file**. Imported files are copied into the
selected notebook. Creating a notebook asks where it goes: the Library root by default, or inside the notebook
you have selected. The new notebook becomes the selected notebook, and the app announces where it was created.
Select an item before using **Tools → Reveal selected item in Explorer** or **Open selected item
in external app**. These commands use the current selection, not a previously selected item.

### Organize library

Choose **View → Organize library** (Ctrl+Shift+V). The dialog holds the library tree as its primary content; there is
no tree pane in the main view anymore. Items at the library root are reached through this dialog tree and through
global search. In the dialog tree, Up and Down move between visible items; Right expands a notebook or enters its first
child; Left collapses or moves to its parent. Home and End move to the first and last visible item. Type a letter to
find the next item beginning with that letter; `*` expands sibling notebooks.

Changes inside the dialog are staged: **OK** applies them all, **Cancel** discards them, and **Escape** closes the
dialog and returns focus to where it was before. F2 renames, or use the context menu. Enter opens the selected item
and closes the dialog without applying staged changes. Delete moves an item to the Recycle Bin, or use the context
menu; Shift+Delete deletes permanently. Cut, copy, and paste with Ctrl+X, Ctrl+C, and Ctrl+V, or from the context
menu: cut and paste moves an item, with links repaired as a move repairs them; copy and paste duplicates an item,
recursively for a notebook, under a non-colliding name.

Move an item with Alt+Up or Alt+Down to put it into the previous or next notebook in tree order, or with
Alt+Shift+Up or Alt+Shift+Down to move it out one level, into its grandparent notebook or to the library root.
Repeat the out-one-level move to walk an item up to the root. For any other destination, use **Move** from the
context menu and choose the destination notebook. A notebook can never move into itself or one of its descendants,
and notebooks are never reordered among their siblings.

**Protect** is in the context menu. A protected item cannot be edited, moved, deleted, or renamed. Trying any of
those opens a dialog saying the item is protected, with **Unprotect** and **Cancel**. Unprotect removes the
protection and immediately carries out the action; Cancel leaves the item protected and does nothing. Protection
lasts until removed, and also blocks operating on a notebook that contains a protected item inside it.

**Send to email** is in the context menu. It creates a mail file with the selected note or file attached and opens
it in the default mail app, where you press Send; a mailto link cannot carry an attachment, so the app uses this
file instead. Only files can be sent by email, so a notebook folder cannot be emailed this way.

**Properties** is in the context menu. It shows the item's name and kind, its saved location, the date it was
created, the date and time it was last updated, its size on disk, and whether it is protected, plus counts of its
tasks, reminders, bookmarks, annotations, and cognitive tools where applicable, its contained notes and files, and
its linked items.

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
The original is preserved, but once its managed copy exists the original is hidden from the Notes and Files grid and
search results. It still appears in the Organize Library dialog tree, which shows every item. Turn on **Show original files** in Settings to see it again; deleting the managed copy brings it
back on its own. Markdown and HTML notes support reading and editing; supported text, image, PDF, ePub
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
use qualified wiki paths such as `[[Notebook/Title]]`. Reference-style Markdown links are repaired through their definitions.

## Read and edit notes

Notes open in tabs. Create either Markdown (`.md`) or HTML (`.html`) notes using the **Note format** selector.
Opening the same note again reuses its tab; opening another note keeps existing notes and their unsaved edits.
Navigation views do not close note tabs. Ctrl+Tab cycles open tabs, and arrow keys navigate the tab strip.
Closing an active tab returns to Notes & Files and focuses the tab strip; cancelling an unsaved-change confirmation
keeps the note open. Reopening a closed note reloads its saved content and reapplies the default mode.
When a note reopens in Read mode, it resumes at the heading you had reached while reading; bookmark jumps
still take precedence over the resumed position.
In **Settings → Default note open mode**, choose **Read mode** (the default, including older settings)
or **Edit mode**. This preference applies to managed notes when opened or activated; it does not make read-only
document previews editable or bypass an encrypted-note or editing lock. Ctrl+E remains the explicit editing toggle.
The read view contains semantic content; Markdown renders with unsafe raw HTML removed, and HTML notes are sanitized
on load, edit, paste, save, and render. Scripts, forms, active embedded content, event handlers, remote images, and
unsafe URL schemes are not allowed. HTML images must have alternative text and use local raster files.
Toggle **Read-only/edit mode** with Ctrl+E. Switching to edit mode moves focus straight into the editor — the Markdown or HTML source, plain text, or the rich-text editor when that form is active — with the caret where you left it. Ctrl+R switches straight to reading mode without toggling. Ctrl+F opens
a Find dialog that searches within the current note, in both reading and editing mode, with Find next and Find
previous and an optional Match case. Searching also lists every match with the text around it: Arrow keys move
through the list, and Enter on a match closes the dialog and moves to that match in the note. After the dialog closes, F3 finds the next match and Shift+F3 the previous
match of the last search. Ctrl+F also searches documents: in a PDF, ePub, or DOCX preview it moves focus to that
reader's own search box, and in a text, CSV, or HTML attachment it searches the preview (HTML previews report
matches without moving to them, because their preview frame cannot be selected inside). Images have no text to
search. **Plain source** edits Markdown or HTML source in a native text area;
**Rich text** exposes an accessible formatting toolbar and multiline textbox. Ctrl+S saves immediately; edits also
save after a short idle period. A tab marks unsaved content and asks before discarding it when closed.

**Focus Mode** (F11, or **Toggle Focus Mode** in the command palette and the View menu) hides every
persistent pane except the title header (which holds search), the menu bar, and the document itself, in both
reading and editing modes, so the open note or file fills the window. Hidden panes also leave the Tab order,
so only the title, menu, search, and document stay focusable. Press F11 again to restore the full layout;
Focus Mode also ends on its own when the open note or file is closed, when you switch to another view, and
when the app is closed and reopened (it is never saved). Dialogs and context menus still open above it.

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
In Markdown source, **Enter** on a list item continues the list (numbered lists increment, checked task items continue
unchecked); **Enter** on an empty list item ends the list, so pressing Enter twice in a row stops the list.
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
announce the displayed count through the status bar. **Search scope** sits right after the search box, even with no
library open (where the scope controls are shown disabled):
**Current notebook** searches only the selected notebook (including its sub-notebooks) and, with no notebook
selected, shows guidance instead of searching the whole library; **Whole library** searches every notebook.
The scope is remembered on this device. In Whole library scope, the notebook filter in Search filters can still
narrow results to one notebook. Search filters also select kind — notes, text attachments, DOCX documents, tasks,
reminders, and appointments — tag, and modified-date range. `#tag` terms also filter by tag. Inline hashtags and supported front-matter tag fields
are indexed; this is not a general YAML editor. Text/CSV/HTML attachment and note contents, plus bounded PDF/ePub
extracted text, are searchable. Unsupported or invalid attachments are searchable by filename. Results are capped at
100 in the UI.

Global search also finds tasks, reminders, and appointments: a task result shows its text and due date or priority,
a reminder its title and scheduled time, shown as MM/DD/YYYY, HH:MM AM/PM, and an appointment its title, time, and location. Opening a task result
shows the task in the Tasks view and focuses its row; a reminder result opens the Reminders tab and focuses the
reminder; an appointment result opens the appointment itself. Tasks, reminders, and appointments have no tags and
no modified date, so the tag and modified-date filters exclude them; appointments belong to no notebook, so the
notebook filter (and Current notebook scope) excludes them too.

## Tasks

Choose **View → Tasks** or use the command palette. Markdown checkboxes and semantic HTML tasks appear
in a sortable table; status, due-date, priority, and notebook filters narrow the list. Checking/unchecking a Markdown
task updates its source checkbox. HTML tasks update only the completion attribute on the matching stable task ID;
stale note revisions or duplicate/missing IDs fail safely. Markdown optional dates use `due:YYYY-MM-DD` or
`📅 YYYY-MM-DD`; priorities use `priority:<option>`, where the options are the library's configured priority
list (displayed as Critical, High, Medium, Low, and Optional by default). Legacy `low`, `normal`, `high`, and
`urgent` values still parse.

Press Ctrl+Q anywhere to open the Quick Task dialog: the task text box is focused first, so type the task,
press Enter or OK, and it becomes a new task in the Tasks list, saved as a task file in the current library
and notebook. When no notebook is open, a notebook chooser follows the text box in the same dialog,
preselected to the most recent notebook — saving without choosing uses that notebook. When the library has
no notebooks at all, a destination must be picked before saving. Every Quick Task confirms with
"Task created in [Notebook Name]", announced and shown in the status bar, including when a notebook is open.
If no library is open, Quick Task first asks for a library.
On macOS, Quick Task has no default shortcut; assign one under Settings → Keyboard Shortcuts.

Open the context menu on a task row (Shift+F10, the Applications key, or right-click) for **Set due date**,
which opens a dialog with due date, due time, and an optional reminder, and **Set priority**, which opens a
dialog with the library's priority options and lets you add, rename, or delete options. At least one priority
option is always kept, and option names are single words so they survive in task lines.

The same context menu offers **Link to note**, **Link to file**, and **Link to Notebook**. Each opens a
dialog listing the library's notes, files, or notebooks; choosing one links it to the focused task. Linked
items appear in the Links column of the Tasks table, where each link can be opened or removed. Every task is
also linked automatically to the note it lives in, so the Links column always shows its own note; removing
that automatic link stops it coming back. Links are
stored in `.a11ynotebook/task-links.json`. Links to tasks removed from a note, and links in a deleted
note or notebook, are removed automatically; links to tasks without a stable ID are kept, since a line
move renumbers them. When a note, file, or notebook moves, its task links move with it: links from its
tasks and links pointing at it are rewritten to the new paths.

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
bookmark or unbookmark it; saved bookmarks appear in the right pane and open the note when selected. From
edit mode, **Bookmark heading at cursor** (Ctrl+Alt+H) bookmarks the heading at or before the cursor, and
**Bookmark position at cursor** (Ctrl+Alt+J) bookmarks the cursor position; both are also in the Tools
menu and the command palette. Neither shortcut jumps anywhere: both only save a bookmark. To jump back
to a saved bookmark, activate it in the Bookmarks section of the right pane. Opening an anchored bookmark lands on its heading in the reading view, or
at its position in edit mode — in plain source and in the rich-text editor alike — moves the reading cursor there, as a Find match does, so a screen reader follows the jump, and announces the heading
it landed on. When you create a bookmark you are asked to name it: the name is pre-filled with the heading or the surrounding text, and you can accept it or type your own. The name is what the bookmark is listed under in the right pane. Bookmarks and
the refreshed link graph are stored as readable JSON in `.a11ynotebook/`.

When a link points at a note that does not exist, the right pane marks it as a missing note with a Repair
button. **Repair broken links**, in the Tools menu and the command palette, lists every broken link in the
library: create the missing note, or retarget the link to an existing note. Creating a note repairs every
link that pointed at it; retargeting rewrites the link in its source note, leaving fenced code blocks and
other links untouched. A link that was already changed reports that instead of writing an identical note.

## Citations and bibliographies

Each notebook keeps its own bibliography. From the Insert menu, choose **Citation generator…**
(Ctrl+Shift+C) to create an entry: pick the source type (book, journal article, website, book chapter,
conference paper, report, or thesis), then fill in the fields by hand or paste a DOI, ISBN, or web address
and choose **Fill in from source** to fetch the public record (Crossref for DOIs, Open Library for ISBNs,
the page's own metadata for URLs). Choose a citation style to preview the bibliography entry and the
in-text citation, then save it to the notebook's bibliography. Choose **Bibliography…** (Ctrl+Shift+J) to
view, edit, or delete saved entries, insert an in-text citation for one of them (with an optional cited
page), or insert the full bibliography into the current note. Entries are stored in the library's
bibliography file, move with the notebook when it is renamed or moved, and stay encrypted when the
library is encrypted.

### Citation styles

Four styles are available: APA, MLA, Chicago (Author-Date), and Chicago (Notes-Bibliography).

- **APA** is common in the social sciences and education. In-text citations are parenthetical
  (Author, Year, p. 23), and the list is headed **References**.
- **MLA** is common in the humanities. In-text citations are parenthetical (Author 23), and the list
  is headed **Works Cited**.
- **Chicago (Author-Date)** is the Chicago style most used in the sciences and social sciences. Like
  APA, it cites parenthetically with the year after the author, and its list is headed **References**.
- **Chicago (Notes-Bibliography)** is the Chicago style most used in history and the humanities. It
  cites with numbered footnotes instead of parenthetical citations, and its list is headed
  **Bibliography**. The year appears at the end of each bibliography entry, not after the author.
  Use it when your reader, publisher, or course asks for footnotes; use Author-Date when they ask
  for parenthetical citations.

### Footnotes (Chicago Notes-Bibliography)

Inserting a citation in Notes-Bibliography mode adds a numbered footnote marker in the text and the
citation itself in a notes section at the end of the note. The first time a source is cited the footnote
gives the full citation; later mentions of the same source give a shortened form (author, shortened
title, and page). In Markdown notes the marker looks like `[^1]` with the definition at the end of the
note; in HTML notes it is a superscript numbered link. Either way, the marker is a link to its note and
each note has a link back to the marker, so you can move between them with the keyboard: Tab to the
marker and press Enter to jump to the note, then follow the backlink to return.

### How the inserted list is formatted

In HTML notes the inserted bibliography follows the style guide: a centered heading (**References**
in bold for APA; **Works Cited** for MLA; **References** for Chicago Author-Date; **Bibliography** for
Chicago Notes-Bibliography), a 0.5-inch hanging indent, and Times New Roman 12-point type. APA and MLA
lists are double-spaced with no blank line between entries; Chicago lists are single-spaced within
entries with a blank line between entries.

In Markdown and plain-text notes the hanging indent, line spacing, and font cannot be applied, so the
inserted list follows the style only as far as plain text allows: the heading is a Markdown heading and
the entries are separated by blank lines. The citation dialog says so when you insert, rather than
claiming the output is fully formatted.

Titles are entered exactly as you type them. APA uses sentence case for titles (only the first word and
proper nouns capitalized); the app does not convert your titles for you, so type them in sentence case
for APA entries. For APA web pages with no publication date, the entry adds a retrieval date
("Retrieved Month Day, Year, from …"); dated pages and other source types do not get one.

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
Completed tasks do not notify. **Open Reminders** (Ctrl+Shift+R) also creates standalone reminders, linked to a note or a file. You can also open the context menu on a note or file in Notes and Files and choose **Create reminder**: the dialog opens with that note or file already selected, and the **Link to** list switches between notes and files.
Switch between the labelled table and Overdue/Today/This week lists. Snooze for 5/15/30/60 minutes, 1 day, or until the
same local clock time tomorrow; Dismiss removes an item from active views. Clicking a native notification opens
its note when the library is still open. Windows notification settings may suppress delivery.
While the app is running, the scheduler delivers reminders in the app; missed pending reminders fire on next launch, and
already-fired reminders remain visible until dismissed. When the app is closed and the machine is awake, due reminders
still fire through a scheduled background task: the app shows the notification and opens the window focused on the
due reminder. If several reminders are due, the earliest-due reminder takes focus. A sleeping machine is never woken:
a missed fire comes late on the next wake instead. Reminder state persists in `.a11ynotebook/reminders.json`.
The creation dialog can save time, snooze, title privacy, and notification choices as future defaults in
`.a11ynotebook/reminder-defaults.json`; existing standalone reminders retain their choices. Task notifications
use the current privacy/notification preferences. Due flashcard notifications are opt-in and share the same
scheduler and persisted delivery tracking. Closing the last window exits the app on Windows; scheduled background delivery still fires while the machine is awake, as described above.

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

Actual Windows scheduled delivery, background sound and focus, and JAWS/NVDA/Narrator announcements still need manual verification.
Tasks also show per-notebook completion counts and native progress elements.

The **Calendar** is one calendar for the whole library, opened with **Ctrl+6**, **Tools → Calendar** in the
app menu, **View → Calendar** in the native menu, or the command palette's **Calendar** command. Appointments
are stored in the library's `.a11ynotebook/calendar.json` and may stand alone or link to a note, file, or task.
Links live in library files and survive local saves, cloud-folder copies, offline mode, and provider sync;
provider sync never sends a link, so a link does not transfer to a fresh library through Google, but it is
never deleted from the library file either. If a linked note, file, or task is gone, the calendar shows that
the linked item is no longer available instead of dropping the link. When a linked note, file, or
notebook moves, the appointment link is rewritten to the new path.
Timed appointments may also carry a reminder: in the appointment dialog, choose No reminder, At start, or a
preset before the start (5 or 15 or 30 minutes, 1 hour, 1 day). All-day appointments do not offer reminders,
because their start has no time to count back from. Reminders fire through the same alert pipeline as task
reminders, with snooze, dismiss, and complete, and they appear in Reminders; clicking a fired appointment
reminder's system notification opens the Calendar. Reminder choices are local-only like links: they live in
the calendar file, are never sent to providers, and a reminder-only edit does not count as a sync change.
The **Agenda** view lists upcoming occurrences grouped under date headings, with previous/next 30-day and
Today controls. The **Month grid** is a table with a button per day labelled with its appointment count;
choosing a day lists that day's appointments below the grid. **New appointment** offers title, all-day or
timed start and end, location, description, recurrence (daily, weekly, monthly, yearly, with interval, count,
end date, and weekly weekdays), and an optional link. Editing or deleting a recurring appointment changes or
removes the whole series, not just one occurrence; deletion asks for confirmation in a separate dialog —
a single appointment asks "Delete this appointment?", and a recurring one warns that deleting removes the
whole series. Live two-way
sync with Google Calendar, Outlook Calendar, and Apple Calendar is built in (see Calendar sync
setup below). Windows screen-reader verification has not been run.

### Calendar sync setup

Live sync is two-way: local changes go to the provider and provider
changes come down to the library. Google, Outlook, and Apple sync each
have an in-app sign-in step: open the Calendar, find the provider's
sync section, enter your sign-in details, save, then Sign in (Google
and Outlook open a browser sign-in; Apple verifies directly) and Sync
now. Keep every client ID, secret, and
app-specific password in your password manager; enter them in the app
when it asks, never in chat or email. If a sync reports conflicts (an
appointment changed both locally and at the provider), the local
version is kept and the sync state is frozen, so the same conflicts are
reported again on the next sync until you resolve them. Press
**Resolve conflicts** and choose per appointment: **Keep local version**
pushes your version to the provider, and **Take Google version** (or
**Take Outlook version**) saves the provider's version locally (your
local-only link and reminder are kept either way). After the last
conflict is resolved, run Sync now again to finish the sync.

**Staying offline.** You do not need to set up anything to keep the
calendar offline: appointments live in your library's calendar file, and
nothing is sent to a calendar service unless you set up sync and press
Sync now. If your library folder itself is cloud-synced (Drive, Dropbox,
OneDrive), that file travels between your computers on its own, and the
other computer's app picks up the change live. Task reminders travel the
same way, because they live in your task files, and reminder state lives
in your library's reminders file. The Google Calendar sync section has
a "Keep calendar offline" button that hides provider sync setup for
every provider and blocks sync runs; going offline signs you out first
and never unlinks your appointments, so turning setup back on resumes
cleanly.

Read this part carefully, because it is easy to misunderstand: these steps
set up sync for YOU, on your accounts. They do not set it up for everybody
else, and they give nobody access to your accounts. A client ID and secret
identify the app to the provider; they are not a password to your account.
Each person who signs in does so with their own account, grants access to
their own calendar only, and gets their own token that lives on their own
device. Your calendar can only be reached with a token you granted by
signing in yourself. For the app to work for everybody without each person
doing these steps, it needs one shared, Google-verified client owned by the
app itself instead of by you; that is not set up yet. Until then, each user
follows the steps below for themselves.

**Google.** In the Google Cloud Console (console.cloud.google.com), create
your own project (for example "A11yNotebook Calendar Sync"), open "APIs &
Services", then "Library", and enable the Google Calendar API. Under "OAuth
consent screen", choose user type External, set the app name to
A11yNotebook with your email as support and developer contact, add the
scope `https://www.googleapis.com/auth/calendar` (full access, required
because sync writes local changes to Google), and add your own email under
"Test users". Under "Credentials", create an "OAuth client ID" of
application type **Desktop app** (not Web application) and save the Client
ID and Client Secret it shows. While the consent screen stays in Testing
mode, only the test users you add (up to 100) can sign in at all, and
Google expires sign-in after 7 days, so you would sign in again about
weekly; moving to Production removes the 7-day limit and the test-user cap
but requires a Google-verification review for the Calendar scope.

**Outlook.** In the Entra portal (entra.microsoft.com), open "App
registrations" and create a registration named A11yNotebook with supported
account types "Accounts in any organizational directory and personal
Microsoft accounts", so personal Outlook.com calendars work. Under
"Authentication", add the "Mobile and desktop applications" platform
with redirect URI `http://localhost` (the app signs in through a
loopback address on your own computer). Under "API permissions", add
the Microsoft Graph delegated permission `Calendars.ReadWrite` and save
the Application (client) ID. Then, in the app's Outlook Calendar sync
section, enter that client ID, save, then Sign in with Outlook and Sync
now. Outlook uses a public native client, so there is no client secret
to enter. Personal accounts work directly; work or school accounts may
need an administrator to consent to the calendar permission. One limit:
Outlook events with a relative recurrence (for example "the second
Tuesday of each month") are skipped when pulling from Outlook, because
the app has no matching pattern; absolute monthly and yearly patterns
sync.

**Apple.** Apple offers no third-party calendar sign-in API, so Apple sync
uses CalDAV with an app-specific password instead of your main password.
At appleid.apple.com, under "Sign-In and Security", open "App-Specific
Passwords" (this requires two-factor authentication on the Apple ID) and
generate one named A11yNotebook; the password is shown once, so save it
immediately. Then, in the app's Apple Calendar sync section, enter your
Apple ID and that app-specific password and save: the app verifies the
sign-in by finding your calendar at `caldav.icloud.com` and reports the
calendar name it found. Sync uses the first event calendar in the
account until you pick another: the Choose Apple calendar button lists
your event calendars, and saving a choice switches sync to it. Switching
after syncing asks for confirmation, because it resets Apple sync state
and unlinks existing Apple events from local appointments (the
appointments themselves stay, and upload to the new calendar on the next
sync). As with Outlook, events with a
relative recurrence (for example "the second Tuesday of each month")
are skipped when pulling from Apple. You can revoke the password at any
time from the same Apple ID page. Never enter your main Apple ID password
into the app.

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

Use **File → Export note…** (Ctrl+Shift+X) on an open note, or **Export note…** in
a note or tab menu; from a menu it exports that note, otherwise it exports the current note. Choose standalone HTML or Markdown and then a location in the native save dialog. The source is
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

Text has a text view. Raster images use a library-validated custom protocol and have an editable
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

## Audio notes, dictation, and transcription

Audio files (`.webm`, `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, up to 40 MB) can be imported like any
attachment and open in the app with standard playback controls. Transcription runs entirely on your machine
with a free local Whisper model, so audio never leaves it.

**Record an audio note.** File menu, then **Record audio note** (also in the command palette). It records
into the currently selected notebook, or the library root when none is selected. Use the same command again
to stop. The recording is saved as "Audio note" plus a timestamp and opens in the attachment preview, where
you can play it back.

**Dictate into a note.** With an editable note open in edit mode, press **Ctrl+Alt+D** (Edit menu, then
**Dictate**, or the Dictate button among the editor command buttons) to start, and the same shortcut again
to stop. The recorded segment is transcribed and the text is inserted at the caret. Dictation works in
segments — speak, stop, and the text appears — rather than word-by-word as you speak.

**Choose a transcription model.** The first time you dictate or transcribe, a dialog asks which model to
download: the **Smaller model** (Whisper Base, about 150 MB; faster to download and transcribe, good
accuracy for clear speech) or the **Larger model** (Whisper Small, about 500 MB; slower, noticeably more
accurate, especially with accents, background noise, or quiet speech). The download happens once. You can
change the model later in Settings, under **Transcription model**; the new model downloads the next time
you transcribe.

**Transcribe an audio file.** Open the audio file and press **Transcribe**. The transcript is saved as a
note next to the audio file — for example, "Interview transcript.md" for "Interview.webm" — with a link
back to the audio file. When a transcript exists, the audio preview offers an **Open transcript** button.
Transcribing again replaces the existing transcript note instead of creating a duplicate.

## Spreadsheets and slide decks

Spreadsheets (`.xlsx`, `.ods`, `.csv`, up to 40 MB) can be imported like any attachment and open in an
editable grid. Slide decks (`.pptx`, `.odp`, up to 40 MB) open as read-only text: a list of slides with
titles, body text, and speaker notes.

**Edit a spreadsheet.** Open the file to see its sheets as a table with row numbers and column letters.
Each cell is a text box labelled with its row and column; type a new value and move on — numbers stay
numbers, TRUE and FALSE stay true and false, and a date typed into a cell that already held a date stays a
date. Cells that hold a formula show the formula's calculated value and are labelled as formulas; editing
one replaces the formula with the value you type. Use **Add row** and **Add column** to grow the sheet at
the end, and **Delete row** / **Delete column** to remove the row or column the focused cell is in. When a
workbook has more than one sheet, pick the sheet from the **Sheet** list.

**Save a spreadsheet.** Press **Ctrl+S**, or the **Save spreadsheet** button, to save back into the same
file, like a note. Old binary `.xls` files are read-only in place: saving one creates a new `.xlsx` file
next to it and leaves the original unchanged.

**Read a slide deck.** Choose a slide from the list to read its text. Speaker notes appear under the slide
text when the deck has them. Slides cannot be edited in this release.

**Formats that need an export first.** Apple Numbers (`.numbers`), Apple Keynote (`.key`), and old
PowerPoint (`.ppt`) files cannot be read directly: export them from their app as `.xlsx` or `.pptx` and
import that file. Google Sheets (`.gsheet`) and Google Slides (`.gslides`) files are only links: open them
in Google Sheets or Slides, download as `.xlsx`, `.csv`, or `.pptx`, and import that file.

## Links

A link is a standalone item in the Notes and Files grid — a shortcut to a web page that lives in a
notebook alongside your notes. It is not a link inside a note: adding a link never writes into the open
note. A link shows its page title as its name and **Link** as its Type.

**Add a link.** File menu, then **Add link** (or the **Add link** button, or **Ctrl+Alt+L**). Type the
title yourself and the web address, then press **Add link**. The address must start with `http://`,
`https://`, or `mailto:`. The link is saved as a `.url` file in the current notebook, so it also opens in
a browser when double-clicked outside the app. If a link with that title already exists, the new one gets
a number added to its name.

**Open a link.** Press Enter on it in the grid, or double-click it, and the page opens in the default
browser. The link itself never opens inside the app.

**Edit a link.** Open the context menu on it (Shift+F10, Applications key, or right-click) and choose
**Edit link**. Change the title, the address, or both, then press **Save changes**. Changing the title
renames the file; the address is stored in the file.

**Delete a link.** Delete it like a note: select it in the grid and press Delete, or choose **Delete
selected item** from its context menu. A protected link must be unprotected first, like any protected
item.

**Find a link.** Link titles and addresses are searchable like note titles: search the library for the
title or part of the address.

**Add a Google Docs, Sheets, or Slides link.** A `.gdoc`, `.gsheet`, or `.gslides` file is only a link
to an online document, not the document itself. When you import one, a dialog offers **Add as link**
alongside the usual guidance: type a title and press **Add link** to keep the live document as a link
item in the notebook, or follow the guidance to download the document and import the downloaded file
instead.

## Settings

Settings sections have visible semantic headings for screen-reader heading navigation: **General editing and autosave**,
**Appearance and interface**, **Reminder alerts**, **PDF Reading**, **Keyboard Shortcuts**, and **Library security**.
Scoped metadata encryption has its own heading when available, with security subsections under Library security.

In **Appearance and interface**, **Theme** offers Dark (the default), Light, or High contrast. Light is a full light
palette built to the same WCAG 2.2 AA bars as the dark theme: body text at 4.5:1 or better, and
focus outlines and control borders at 3:1 or better. High contrast is a full black-and-white
palette with yellow links, focus outlines, and selected elements, built to the same bars. In
Windows forced-colors mode the system colors govern instead, whatever theme is selected. **Zoom in percent** scales the whole interface from 50 to 200 percent; unlike
font size, which grows text only, Zoom grows buttons, spacing, and everything else with it. **Focus indicator**
offers a high-visibility option with thicker, more offset outlines, and **Reduce motion** turns off interface
animations and transitions. **Show command/action buttons in the UI** restores the button-rich application
layout. It is off by default, including for older settings files, to favor the native-menu-first design.

**Interaction**, in the same section, offers two options, both off by default. **Immersive Focus mode** hides the search box and search scope as well while Focus mode is on, so only the title bar, menu bar, and document remain. **Auto-focus on grids when switching views** puts keyboard focus in the grid automatically when switching to the Libraries, Notebooks, or Notes and Files view, without needing to enter forms mode first. It only fires on an actual view switch, never while a dialog is open.

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

**Settings** (Ctrl+Alt+S) changes autosave delay (0 disables it), theme (Dark or Light, plus a
High contrast option for Windows forced-colors mode), font size,
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
| Ctrl+Q                                                       | Quick Task                                     |
| Ctrl+Alt+L                                                   | Add link                                       |
| Ctrl+W                                                       | Close current note tab                         |
| Ctrl+E                                                       | Toggle read/edit mode                          |
| Ctrl+R                                                       | Enable reading mode                            |
| Ctrl+F                                                       | Find in document                               |
| F3                                                           | Find next match                                |
| Shift+F3                                                     | Find previous match                            |
| Alt+Q                                                        | Focus global search                            |
| Ctrl+Shift+P                                                 | Open command palette                           |
| Ctrl+K                                                       | Insert link                                    |
| Ctrl+Tab / Ctrl+Shift+Tab                                    | Switch to next / previous open tab             |
| Ctrl+S                                                       | Save the current note                          |
| Ctrl+D                                                       | Bookmark or unbookmark the current note        |
| F1                                                           | Show keyboard shortcuts                        |
| F5                                                           | Refresh library and links                      |
| F6 / Shift+F6                                                | Move focus to next / previous pane             |
| Alt+Left / Alt+Right                                         | Go back / forward in browsing history          |
| F9                                                           | Show or hide the right pane                    |
| Shift+F10 / Applications key / right-click                   | Open the context-aware command menu            |
| Ctrl+Shift+V                                                 | Open the Organize Library dialog               |
| In the Organize Library dialog tree: Up/Down, Left/Right, Home/End                   | Navigate and expand/collapse                   |
| In the Organize Library dialog tree: Enter, F2, Delete, `*`, first-letter type-ahead | Open, rename, delete, expand siblings, or find |
| In the Organize Library dialog: Alt+Up/Down, Alt+Shift+Up/Down | Move into the previous/next notebook, or out one level |
| In the Organize Library dialog: Ctrl+X, Ctrl+C, Ctrl+V       | Cut, copy, paste                               |

## Accessibility notes

Use Tab for normal controls, and F6 or Shift+F6 to move between the application panes. Plain-source mode uses a
native textarea; rich-text mode uses a labelled multiline editor and a one-tab-stop toolbar. Manual JAWS, NVDA, and
Narrator testing is still needed; see the [testing strategy](accessibility/testing-strategy.md).

## Not available yet

Whole-library encryption and encryption of excluded indexes/metadata are not available. Cognitive checkpoints require
explicit scoped protection consent; save important edits explicitly, including while persistent recovery is disabled.
DOCX local reading is implemented; DOCX annotations and legacy `.doc` local reading remain unavailable.
Format conversion creates a warned sibling copy and keeps the original; complete loss analysis and in-place conversion
remain open. PDF sidebar/export/lifecycle workflows, ePub annotations, and broader document lifecycle features are open implementation
work, not externally blocked. See the [reader and annotation follow-up plan](roadmap.md#document-reader-and-annotation-follow-up-plan).
Recent-library selection and calendar organization remain open.
Manual Windows screen-reader and UI Automation smoke tests have not been run.
