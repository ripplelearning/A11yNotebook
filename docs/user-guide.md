# User guide

Press F1 any time to open this guide. You can search it, jump around with
its table of contents, and trust its Keyboard shortcuts section: that
section is built from the app's commands each time the guide opens, so a
shortcut you changed or added shows up there by itself.

## Introduction to A11y Notebook

A11y Notebook is a personal knowledge manager you can drive entirely from
the keyboard, with a screen reader or without one. It keeps your notes,
tasks, documents, and research in a library — an ordinary folder on your
computer, so your files stay yours.

Here is what you can do with it:

- **Keep notes.** Write notes in Markdown or HTML, read them back as a
  structured page with headings, links, images, and tables, and find
  them again with search.
- **Stay organized.** Sort notes into notebooks, move things around in
  the Organize Library dialog, and link notes to each other.
- **Track tasks.** Turn checkboxes in your notes into tasks with due
  dates, priorities, and reminders, and see them all in the Tasks view.
- **Plan your time.** Keep appointments on the library calendar, set
  reminders, and sync with Google, Outlook, or Apple Calendar if you
  want to.
- **Work with sources.** Save citations, build a bibliography, and
  annotate notes and PDFs.
- **Use your files.** Read PDFs, ePubs, Word documents, spreadsheets,
  and slide decks, capture web pages, and turn scanned files into
  readable text.
- **Study and think.** Use outlines, mind maps, flashcards, and grids,
  or start from a template.
- **Record and transcribe.** Record audio notes, dictate into a note,
  and transcribe recordings on your own computer.

A few everyday uses: keeping research and reading notes for a course or
a project, planning a project with tasks and deadlines, studying with
flashcards, and keeping appointments and reminders in one place.

This guide starts with a short introduction, then explains the screens
and how to move around them with the keyboard, then covers the
accessibility features and the settings that control them. After that,
it walks through what the app can do, feature by feature.

## The user interface and how to navigate it using a keyboard

The app is built around a few main views: **Libraries**, **Notebooks**,
**Notes and Files**, **Tasks**, **Cognitive Tools**, the **Calendar**,
**Reminders**, and the **Contents view**. Jump between them with Ctrl+1
for Libraries, Ctrl+2 for Notebooks, Ctrl+3 for Notes and Files, Ctrl+4
for Tasks, Ctrl+5 for Cognitive Tools, Ctrl+6 for the Calendar, Ctrl+7
for Reminders, and Ctrl+0 for the Contents view. Each shortcut also
announces where you are; pressing it again announces the view again.

Across the top is a menu bar — **File**, **Edit**, **View**, **Insert**,
**Format**, **Tools**, and **Help** — with the usual Alt shortcuts for
each menu, then arrow keys, Enter, and Escape. The command palette holds
the same commands, and every shortcut can be changed in Settings. Most
things in the app live in grids: move with the arrow keys, jump to the
first or last row with Home and End, type a letter to jump to the next
item starting with it, and press Enter to open what you are on. F6 and
Shift+F6 move between the main areas of the window, and Tab moves
between controls. Notes open in tabs, and Ctrl+Tab moves between them.
Shift+F10, the Applications key, or a right-click opens a context menu
whose actions depend on what you are focused on. The sections after this
one walk through each view in turn.

The title bar names what you have open: with a file or note open it
reads "[FileName] | [NotebookName] | [LibraryName] | A11y Notebook" — a
file at the library root has no notebook, so that part is left out. With
no file open it names the current view and notebook instead.

### Open a library

Choose **File → Open library** and pick a folder. The folder stays on
your disk as an ordinary folder. Its subfolders show up as notebooks,
its managed `.md` and `.html` files as notes, and its other files as
attachments. The last library you opened comes back next time, on the
notebook you last had open. Closing a library makes the app forget it,
so a closed library stays closed on the next launch. Reopening a library
shows that notebook's Notes and Files view; if no notebook was recorded,
or that notebook is gone, you land on the Notebooks view instead.
**Ctrl+W** closes whatever is current: a tab, a selected notebook, or
the open library; closing a library closes everything inside it and
takes you back to the Libraries view. To delete a library, focus it in
the Libraries grid and press **Delete**, or choose **Delete library**
from its context menu; the confirmation warns that everything inside the
library goes too, and confirming moves the whole folder to the Recycle
Bin.

Choose **File → Back up library** to copy the whole open library to a
new folder with the date and time in its name, inside a folder you
choose. The copy includes the library's private details, so the backup
folder opens as a library in its own right. Encrypted files stay
encrypted in the copy: nothing is unlocked for the backup. The app
counts the copied files and checks the copy matches the library before
reporting success; a failed copy is removed rather than left behind as a
partial backup. The backup never overwrites a folder that already
exists, and it refuses a destination inside the library or one that
contains the library.

### Create in the current view

**New** (Ctrl+N by default) makes the kind of item that fits the view
you are in:

| Active view                                             | What New makes                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Libraries                                               | A **new local library**, choosing a parent folder and a new name in the system dialog; an existing folder is never overwritten |
| Notebooks                                               | A notebook in the open library, in the Library root or inside the notebook you have selected                                   |
| Notes and Files                                         | A note in the selected notebook                                                                                                |
| Tasks                                                   | A saved checkbox task with an associated note, with an optional due date and priority                                          |
| Cognitive Tools                                         | An Outline, Mind map, Flashcards, CSV Grid, or Markdown grid, which you name and create at the library root                    |
| Note tabs, Contents, Reminders, previews, and Libraries | A note using the current notebook, or the library root when no notebook is selected                                            |

The **New notebook** command on its own still makes a notebook; it has
not been changed to mean the contextual New. Settings can change or turn
off New's shortcut, and conflicting shortcuts are rejected. The File
menu and the command palette offer the same commands. Cancelling leaves
existing files and unsaved edits alone; save or sort out pending edits
when asked. New notes use Markdown by default; the creation dialog also
offers HTML. A view that needs an open library says so instead of
quietly making a different kind of item.

### Navigate files

In the main view, move through the Libraries, Notebooks, and Notes and
Files grids with the arrow keys; Home and End go to the first and last
row. Typing a letter jumps to the next item whose name starts with it,
wrapping around, so pressing the same letter again steps through every
match. Enter opens the selected item: a managed note, a supported
managed preview, or a notebook, which opens its Notes and Files view. A
notebook's Notes and Files view shows its own notes and files plus the
notebooks inside it; a sub-notebook's notes only show when you open that
sub-notebook, so a note never shows under two notebooks at once. The
Type column shows the file's real type — PDF, ePub, Word document, Excel
spreadsheet, CSV, PowerPoint presentation — instead of the generic
"Attachment". Documents from outside the app, or of unknown origin, use
Open With rather than being quietly treated as app-made notes. F2 opens
a rename dialog. Delete asks before moving an item to the Recycle Bin;
Shift+Delete deletes permanently. Deleting a note or notebook that holds
tasks first warns you how many tasks will go with it, since tasks live
inside notes and have no copy of their own. Space selects a row. To
arrange notebooks, notes, and files in the library tree, use the
Organize Library dialog below.

Use **File → New note**, **File → New notebook**, or **Tools → Import
file**. Imported files are copied into the notebook you have selected.
Making a notebook asks where it goes: the Library root by default, or
inside the notebook you have selected. The new notebook becomes the
selected notebook, and the app announces where it was made. Select an
item before using **Tools → Reveal selected item in Explorer** or **Open
selected item in external app**. These commands use the current selection,
not one you picked earlier.

### Organize library

Choose **View → Organize library** (Ctrl+Shift+V). The dialog holds the
library tree as its main content; there is no tree pane in the main view
anymore. Items at the library root are reached through this dialog tree
and through global search. In the dialog tree, Up and Down move between
visible items; Right opens a notebook or moves into its first child;
Left closes it or moves to its parent. Home and End go to the first and
last visible item. Type a letter to find the next item starting with
that letter; `*` opens all the notebooks at the same level.

Changes inside the dialog are staged: **OK** applies them all, **Cancel**
throws them away, and **Escape** closes the dialog and puts focus back
where it was. F2 renames, or use the context menu. Enter opens the
selected item and closes the dialog without applying staged changes.
Delete moves an item to the Recycle Bin, or use the context menu;
Shift+Delete deletes permanently. Cut, copy, and paste with Ctrl+X,
Ctrl+C, and Ctrl+V, or from the context menu: cutting and pasting moves
an item, with links fixed up as a move fixes them; copying and pasting
duplicates an item, a whole notebook included, under a name that does
not clash.

Move an item with Alt+Up or Alt+Down to put it into the previous or next
notebook in tree order, or with Alt+Shift+Up or Alt+Shift+Down to move
it out one level, into its grandparent notebook or to the library root.
Repeat the out-one-level move to walk an item up to the root. For any
other destination, use **Move** from the context menu and pick the
destination notebook. A notebook can never move into itself or one of
its own sub-notebooks, and notebooks are never reordered among their
siblings.

**Protect** is in the context menu. A protected item cannot be edited,
moved, deleted, or renamed. Trying any of those opens a dialog saying
the item is protected, with **Unprotect** and **Cancel**. Unprotect
removes the protection and carries out the action right away; Cancel
leaves the item protected and does nothing. Protection lasts until you
remove it, and it also blocks working on a notebook that has a protected
item inside it.

**Send to email** is in the context menu. It makes a mail file with the
selected note or file attached and opens it in your default mail app,
where you press Send; a mailto link cannot carry an attachment, so the
app uses this file instead. Only files can be sent by email, so a
notebook folder cannot be emailed this way.

**Properties** is in the context menu. It shows the item's name and
kind, where it is saved, the date it was created, the date and time it
was last changed, its size on disk, and whether it is protected, plus
counts of its tasks, reminders, bookmarks, annotations, and cognitive
tools where they apply, the notes and files it holds, and the items
linked to it.

The Windows app has a native menu bar with **File**, **Edit**, **View**,
**Insert**, **Format**, **Tools**, and **Help**. Use Alt and the
underlined letter, then the arrow keys, Enter, or Escape. Menu commands
have no built-in shortcuts; the app's changeable shortcuts (including
Ctrl+K and F6/Shift+F6) are the only shortcut path. The app menu takes
the place of the duplicate command groups that used to sit in the page.
In a browser without the app's native features, a compact, accessible
HTML set of commands is still available. Controls that belong to one
thing, such as the formatting toolbar, reader page and zoom controls,
tab close buttons, and dialog buttons, stay next to the content they
work on.

The installed and portable builds work the same way for navigation and
creation. Ctrl+1 announces **Libraries** or the open library's name;
Ctrl+2 announces **Notebooks** or **Notebooks in [library name]**;
Ctrl+3 announces **Notes and Files in [notebook name]** when a notebook
is selected. Pressing a shortcut again announces the view again. The
notebook you have selected stays selected when you pick a file row.

Notes & Files also has **New note from template**. Open and unlock a
library before making anything in it.

Shift+F10, the Applications key, or right-click opens the global context
menu. Its commands come from the command list and depend on what you are
focused on: library files, tabs, selected editor text, links, tasks,
search results, annotations, reminders, and attachment previews each get
different actions. Use Up and Down, Home and End, type-ahead,
Enter/Space, or Escape. Actions that cannot be used are announced as
unavailable, and Escape puts focus back on the thing that opened the
menu. The menu does not change how modal dialogs handle the keyboard.

### Paste files and folders

Copy files or folders in File Explorer, then paste them while focus is
in the main panel (not inside an editor). Where they land depends on the
view. In **Libraries**, a pasted folder asks whether to make an
app-specific copy of the library (you then choose where to save it) or
use the original folder as the library; files sitting directly in the
pasted folder ask how to organize them — one notebook for all files, or
one notebook per file — because a library cannot hold files outside a
notebook. In **Notebooks**, a pasted folder becomes a notebook in the
current library, and pasted files go into the selected notebook. In
**Notes and Files**, only files paste, into the selected notebook. Pasted
copies are checked file by file; a failed copy is removed and reported.
The clipboard path step has not yet been confirmed with a real Windows
copy-and-paste run.

### Managed documents and older libraries

When the app makes a file, or you explicitly import one, it records
where the file came from in `.a11ynotebook/provenance.json`; the
original document gets no marker embedded in it. A file's extension and
which notebook it sits in do not prove where it came from on their own.
Libraries made before these records existed can still be read on disk
and are not automatically relabelled as app-made: older or unknown files
need an explicit import before they open inside the app. One exception
keeps older encrypted libraries reachable: a recognized encrypted-note
file offers you the choice to use the existing unlock steps. Content
shows only after unlocking works; this does not quietly treat other old
files as app-made. Cancelling leaves the encrypted file unchanged.

For a compatible file from outside the app, use **Import into A11y
Notebook** from its context menu to make a managed copy. The original is
kept, but once its managed copy exists the original is hidden from the
Notes and Files grid and search results. It still shows in the Organize
Library dialog tree, which shows everything. Turn on **Show original
files** in Settings to see it again; deleting the managed copy brings it
back on its own. Markdown and HTML notes support reading and editing;
supported text, image, PDF, ePub, and DOCX previews are read-only
unless a dedicated editing tool is provided (for example, a CSV grid).
Formats that are not supported or not valid are not offered as editable
imports; files that are too big, unsafe, or broken are turned down.
Cancelling an import does not change the original. Keep the metadata
folder when copying a whole library; missing records are handled
carefully, not rebuilt from dates or filenames.

On Windows, **Open With** asks Windows to pick an application for a
document; **Open externally** uses the application already set as the
default. Picking an application once does not quietly change defaults.
To change the default, use the **Choose default application…** context
action and confirm the Windows Default Apps settings option. In Windows
11, search Settings → Apps → Default apps for the extension (for example
`.txt`) and pick the default there; Windows 10 offers **Choose default
apps by file type**. Windows owns and confirms that choice: A11y
Notebook does not edit registry settings or claim a default changed just
because Settings opened. The chooser is Windows-only; on other platforms
use the existing default application or your system's own file-type
settings. Microsoft documents that [SHOpenWithDialog cannot change
defaults on Windows 10 and later](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shopenwithdialog).
Programs, scripts, and shortcuts are not document imports or supported
external document actions.

**Move** asks for a destination notebook. Save all open edits before a
rename or move; the confirmation lists notes whose links will change.
Cancelling leaves the files untouched. Bookmarks, annotations, image
descriptions, flashcard schedules, and reminders follow moves the app
makes. Links that use only a title and could point at more than one note
are not fixed; use full paths such as `[[Notebook/Title]]`.
Reference-style Markdown links are fixed through their definitions.

### Read and edit notes

Notes open in tabs. Make either Markdown (`.md`) or HTML (`.html`)
notes using the **Note format** selector. Opening the same note again
reuses its tab; opening another note keeps the notes you already have
open, unsaved edits included. Moving between views does not close note
tabs. Ctrl+Tab moves between open tabs, and the arrow keys move along
the tab strip. Closing the tab you are on takes you back to Notes &
Files and puts focus on the tab strip; if you cancel a warning about
unsaved changes, the note stays open. Reopening a closed note loads its
saved content and uses your default mode again. When a note reopens in
Read mode, it picks up at the heading you had reached; a bookmark jump
still wins over that saved spot.

In **Settings → Default note open mode**, choose **Read mode** (the
default, including for older settings) or **Edit mode**. This applies to
managed notes when they are opened or switched to; it does not make
read-only document previews editable, and it does not get around a
locked encrypted note or an editing lock. Ctrl+E is still the way to
switch editing on and off by hand.

The read view shows the note as a structured page; Markdown is shown
with unsafe raw HTML taken out, and HTML notes are cleaned when loaded,
edited, pasted, saved, and shown. Scripts, forms, active embedded
content, event handlers, remote images, and unsafe link types are not
allowed. Images in HTML notes need alternative text and must use local
image files. Toggle **Read-only/edit mode** with Ctrl+E. Switching to
edit mode puts focus straight into the editor — the Markdown or HTML
source, plain text, or the rich-text editor when that form is active —
with the cursor where you left it. Ctrl+R goes straight to reading mode
without toggling. Ctrl+F opens a Find dialog that searches inside the
current note, in reading and in editing mode, with Find next, Find
previous, and an optional Match case. The search also lists every match
with the text around it: move through the list with the arrow keys, and
press Enter on a match to close the dialog and go to that match in the
note. After the dialog closes, F3 finds the next match and Shift+F3 the
previous match of the last search. Ctrl+F also searches documents: in a
PDF, ePub, or DOCX preview it moves focus to that reader's own search
box, and in a text, CSV, or HTML attachment it searches the preview
(HTML previews report matches without moving to them, because their
preview frame cannot be selected from inside). Images have no text to
search. **Plain source** edits Markdown or HTML source in a plain text
box; **Rich text** gives you an accessible formatting toolbar and a
multiline text box. Ctrl+S saves right away; edits also save after a
short pause. A tab shows when it has unsaved content and asks before
throwing it away when closed.

**Focus Mode** (F11, or **Toggle Focus Mode** in the command palette and
the View menu) hides every side panel except the title header (which
holds search), the menu bar, and the document itself, in both reading
and editing modes, so the open note or file fills the window. Hidden
panels also leave the Tab order, so only the title, menu, search, and
document can take focus. Press F11 again to bring the full layout back;
Focus Mode also ends on its own when the open note or file is closed,
when you switch to another view, and when the app is closed and reopened
(it is never saved). Dialogs and context menus still open above it.

The Format menu and the formatting toolbar offer bold, italic, heading
levels 1–6, lists, quote, and fenced code. In Markdown source, **Enter**
on a list item carries the list on (numbered lists count up, checked
task items carry on unchecked); **Enter** on an empty list item ends the
list, so pressing Enter twice in a row stops the list. Ctrl+B and Ctrl+I
format the selection; Ctrl+K (or Ctrl+Shift+L) opens a link dialog with
a note picker. The table dialog picks rows and columns. Insert image or
attachment picks a file already imported into the library and needs a
text description. Pasting into rich text keeps safe semantic formatting.
The rich editor supports bold, italic, underline, strikethrough,
headings, lists, block quotes, code, links, tables, and local images
with required descriptions. Changing format makes a warned copy next to
the original and keeps the original. In an HTML note, **Insert checklist
task** adds a proper task item. Edit its title in rich text; edit its
stable ID, completion, due date, priority, or reminder details in HTML
source. Plain-source formatting commands keep working on the Markdown
editor. The editor tries to keep native undo; a fallback insert done by
the app may not keep an undo step.

Renames, moves, and saves the app makes keep track of where a file came
from. Ordinary edits made outside the app keep it too; files replaced
outside the app, or renamed outside the app, may become unknown and
need an explicit import again.

Edits made outside the app load silently into clean notes. If you have
unsaved text, autosave pauses and a dialog offers **Keep mine** (save
your version), **Load disk version**, or **Save copy** (a new note with
the date and time in its name). Notes that were removed offer Save copy.
Escape leaves the conflict unsorted and tells you to pick an option; it
does not throw your edits away. Switching libraries is blocked until
unsaved work is saved or sorted out.

### Mathematics

Write maths as plain shorthand and the app turns it into MathML, which
browsers show and screen readers can read. The shorthand covers sqrt(x),
frac(a,b), pow(a,b), abs(x), log(x), x^2, x_1, pi, Greek letters, div for
the division sign, rad for radians, and scientific notation such as 1.5e3
or 3x10^8. The shorthand you typed is kept in the MathML `alttext`.

Open **Insert → Insert math** or press Alt+= to show the Mathematics
toolbar in the rich-text editor. Type shorthand there, use the template
buttons for fractions, roots, powers, and more, check the live preview,
and choose Insert math. While typing in a note, a finished function call,
power, or scientific-notation value at the cursor turns into MathML on
its own; ordinary words never change.

Markdown notes store maths as a `` `math:` `` code span (for example
`` `math:sqrt(16)` ``), which shows as MathML when reading and turns
back when editing, so maths survives the Markdown round trip. HTML notes
store the MathML element itself. Plain-text notes keep the shorthand as
typed.

### Spelling, grammar, and thesaurus

**Tools → Spelling and Grammar Check** (F7) opens a dialog like the one
in Word. It steps through each issue in the current note, in order,
showing the word, the sentence around it, and an explanation for grammar
issues. For each issue you can Ignore Once, Ignore All (or Ignore Rule
for grammar), Add to Dictionary, Change, or Change All. A Replace with
box lets you type your own replacement, and Undo steps back one change.
Changes are gathered and applied to the note only when you close the
dialog. Code blocks and inline code are not checked, and all-caps
acronyms are skipped. The grammar check covers repeated words, a/an
choice, could/should/would/must of (for have), a lowercase pronoun i,
its/it's confusion, alot, and common missing apostrophes. It works from
patterns, not a full grammar engine, so it will not catch every error.

**Tools → Thesaurus** (Shift+F7) looks up synonyms for the selected
word, grouped by part of speech. Each synonym offers Look up (to look
that word up instead) and, in edit mode with a selection, Replace with
this word. If nothing is found, it suggests words spelled similarly. The
built-in word list has synonyms only, no antonyms. Words added from the
spelling check live in the custom dictionary, which you can edit in
**Settings → Custom dictionary, one word per line**. All spelling,
grammar, and thesaurus work runs on your device; nothing is sent
anywhere.

### Search

Type in **Global search**; the search waits 250 ms after you stop
typing. The app keeps an index in `.a11ynotebook/search-index.json` and
updates it bit by bit when files change. Results show the matching text
and announce how many there are in the status bar. **Search scope** sits
right after the search box, even with no library open (where the scope
controls show as disabled): **Current notebook** searches only the
notebook you have selected (including its sub-notebooks) and, with no
notebook selected, shows guidance instead of searching the whole
library; **Whole library** searches every notebook. The scope is
remembered on this computer. In Whole library scope, the notebook filter
in Search filters can still narrow results to one notebook. Search
filters also pick the kind — notes, text attachments, DOCX documents,
tasks, reminders, and appointments — a tag, and a changed-date range.
`#tag` terms also filter by tag. Hashtags in text and supported tag
fields at the top of a note are indexed; this is not a general YAML
editor. Text, CSV, and HTML attachment and note contents, plus a bounded
amount of PDF and ePub text, are searchable. Attachments that are not
supported or not valid are searchable by filename. Results are capped at
100 on screen. Pressing Escape in the search box clears the search text
and removes the results from the display.

Global search also finds tasks, reminders, and appointments: a task
result shows its text and due date or priority, a reminder its title and
scheduled time, shown as MM/DD/YYYY, HH:MM AM/PM, and an appointment its
title, time, and location. Opening a task result shows the task in the
Tasks view and puts focus on its row; a reminder result opens the
Reminders tab and puts focus on the reminder; an appointment result opens
the appointment itself. Tasks, reminders, and appointments have no tags
and no changed date, so the tag and changed-date filters leave them out;
appointments belong to no notebook, so the notebook filter (and Current
notebook scope) leaves them out too.

### Links and bookmarks

Use `[[Note title]]` to link to a note by title, or a relative Markdown
link such as `[Related](./Related.md)`. In read mode, activating a link
that works opens its note in a tab. Links to notes that do not exist are
marked and announced as missing. The right pane lists the links going
out of the current note and the links coming into it. Choose **Bookmark
note** to bookmark or unbookmark it; the Bookmarks section of the right
pane lists the open file's bookmarks — the file open in a tab, even after
you switch to another view — and with no file open, it lists every
bookmark in the library — and activating one opens its note at the
bookmark. From edit mode, **Bookmark heading at cursor** (Ctrl+Alt+H)
bookmarks the heading at or before the cursor, **Bookmark position at
cursor** (Ctrl+Alt+B) bookmarks the cursor position, and **Jump to next
bookmark** (Ctrl+Alt+J) jumps to the next bookmark after the cursor,
wrapping to the first bookmark when past the last; all three are also in
the Tools menu and the command palette. In reading mode the same
shortcuts work from the line you are reading — the line at the screen
reader's position in the document — so H bookmarks the heading at or
before it, B bookmarks that exact line, and J jumps to the next bookmark
after it. Open a PDF instead and B bookmarks the page and the spot you
are on, with the name already filled in as "Page N", and J jumps to the
next bookmarked page and spot; H has no heading to bookmark in a PDF, so
it says heading bookmarks are for notes. Activating a PDF bookmark opens
its PDF if it is closed and lands on that page and spot, in Paginated
and Continuous view alike. With only one bookmark, J jumps to it; with
none, it says there are no bookmarks. To go back to a saved bookmark,
activate it in the Bookmarks section of the right pane or press
Ctrl+Alt+J. Opening a bookmarked heading lands on its heading in the
reading view, or on its exact line for a position bookmark — in plain
source and in the rich-text editor alike — moves the reading cursor
there, as a Find match does, so a screen reader follows the jump, and
announces the bookmark it landed on. When you make a bookmark you are
asked to name it: the name is already filled in with the heading or the
surrounding text, and you can keep it or type your own. The name is what
the bookmark is listed under in the right pane. Bookmarks and the
refreshed link graph are stored as readable JSON in `.a11ynotebook/`.

When a link points at a note that does not exist, the right pane marks
it as a missing note with a Repair button. **Repair broken links**, in
the Tools menu and the command palette, lists every broken link in the
library: make the missing note, or point the link at a note that exists.
Making a note fixes every link that pointed at it; pointing a link
elsewhere rewrites the link in its source note, leaving fenced code
blocks and other links untouched. A link that was already changed says
so instead of writing a note that is identical.

### Keyboard shortcuts

<!-- guide-shortcuts: generated from the command registry when the guide opens; do not hand-edit this section. -->

The shortcuts in this section are always current: they are built from the
command registry when the guide is shown in the app (press F1), so a
shortcut you changed or added shows up there without anyone editing this
file. See `src/shared/user-guide.ts`. The full list also shows in the
Keyboard Shortcuts dialog on the Help menu, and in
`docs/keyboard-shortcuts.md`, which is made by `npm run docs:shortcuts`.

## Accessibility features and accessibility settings

A11y Notebook is built from the start to be used with a keyboard and a
screen reader — not adapted afterward. Notes read as structured pages
with headings you can jump between, controls are labelled, and the app
announces what it does. This part gathers the features that make that
work and the settings that control them: themes and contrast, zoom,
focus outlines, motion, keyboard shortcuts, reminder alerts, and library
security. Most of these live in Settings (Ctrl+Alt+S), under the headings
in the next section.

### Settings

Settings has clear headings you can jump between with a screen reader:
**General editing and autosave**, **Appearance and interface**,
**Reminder alerts**, **PDF Reading**, **Keyboard Shortcuts**, and
**Library security**. Scoped metadata encryption gets its own heading
when it is available, with security subsections under Library security.

In **Appearance and interface**, **Theme** offers Dark (the default),
Light, or High contrast. Light is a full light palette built to the same
WCAG 2.2 AA bars as the dark theme: body text at 4.5:1 or better, and
focus outlines and control borders at 3:1 or better. High contrast is a
full black-and-white palette with yellow links, focus outlines, and
selected elements, built to the same bars. In Windows forced-colors mode
the system colors take over instead, whatever theme you picked. **Zoom
in percent** scales the whole interface from 50 to 200 percent; unlike
font size, which grows text only, Zoom grows buttons, spacing, and
everything else with it. **Focus indicator** offers a high-visibility
option with thicker, more offset outlines, and **Reduce motion** turns
off interface animations and transitions. **Show command/action buttons
in the UI** brings back the button-rich layout. It is off by default,
including for older settings files, to favor the menu-first design.

**Interaction**, in the same section, offers two options, both off by
default. **Immersive Focus mode** hides the search box and search scope
as well while Focus mode is on, so only the title bar, menu bar, and
document remain. **Auto-focus on grids when switching views** puts
keyboard focus in the grid on its own when you switch to the Libraries,
Notebooks, or Notes and Files view, without needing to enter forms mode
first. It only fires on a real view switch, never while a dialog is
open.

**Automatic backups**, in the same section, copies the whole library
folder on a schedule you choose: every 1 to 30 days, keeping the newest
1 to 50 copies and deleting older ones. A backup runs when the library
is opened and at most once per interval while the app runs, and only the
saved content is copied, so save first if it matters. Backups live
outside the library, in the folder you name or, if you leave it blank, a
Backups folder next to the library. Encrypted files stay encrypted in
the copy, and a backup opens as a library in its own right. Automatic
backups are off until you turn them on.

The native menu stays available either way. The controls you need for
navigation, content, dialogs, forms, and Settings stay available; in a
browser without the native features, command buttons stay. These
preferences and shortcut changes only take effect after **Save
settings**; **Cancel** throws them away, and reset changes the draft.
The saved settings survive restarts, in the library settings and the app
defaults.

Every command in **Keyboard Shortcuts** has both a textbox for typing a
shortcut in by hand and a **Capture Shortcut** button with its own
label. Turn the button on, then press Ctrl or Alt with a letter or
number, or an F1–F12 combination (Ctrl, Alt, and Shift all work). The
command you are changing and the result are announced. A shortcut that
is valid and does not clash is written into that command's draft textbox
and focus goes back there; it is not saved on its own. Pressing only a
modifier waits, repeats are ignored, and input that is not supported,
IME typing, and AltGraph leave the old value alone. Shortcuts that
clash, fixed aliases, and reserved navigation and editing keys are
turned down with a message; try again or cancel. **Escape**, **Tab**, or
**Cancel capture** stops without changing the shortcut; Escape during
capture does not close Settings. Tab keeps its normal dialog navigation.
Starting another capture replaces the old one. Reset, save, close, and
leaving Settings stop capture. App shortcuts and native menu shortcuts
are paused while listening, but combinations the operating system keeps
for itself cannot always be caught.

**Settings** (Ctrl+Alt+S) changes the autosave delay (0 turns it off),
theme (Dark or Light, plus a High contrast option for Windows
forced-colors mode), font size, and command shortcuts. Shortcuts that
clash with command defaults or reserved navigation and editing keys are
turned down. A blank shortcut turns that command's shortcut off; reset
brings back the defaults. Settings are saved in the library's
`.a11ynotebook/settings.json` and the app's userData defaults. Keyboard Shortcuts
and the palette show the shortcuts in use; the generated documentation
lists the defaults. Library idle locking is in Security settings.
Reminder defaults are saved from the reminder creation dialog; in-app
alert and sound settings are in Settings.

### Accessibility notes

Use Tab for normal controls, and F6 or Shift+F6 to move between the
application panes. Plain-source mode uses a native text box; rich-text
mode uses a labelled multiline editor and a toolbar you pass through
with a single Tab stop. Manual JAWS, NVDA, and Narrator testing is still
needed; see the [testing strategy](accessibility/testing-strategy.md).

### Windows accessibility and application-chooser checks

Automated tests do not check spoken output or the real Windows
application chooser. With a backed-up test library, check both the
installed and portable builds:

- With NVDA, JAWS, or Narrator, repeat Ctrl+1 through Ctrl+5, with and
  without an open library or notebook. Check you hear one announcement
  of where you landed, with no competing focus or status speech.
- Use Ctrl+N in each view; cancel and complete making something. Check
  that unsaved work and locked libraries stay protected. Make, save, and
  reopen all five cognitive tool types and check that a new task survives
  reopening the library.
- Pick a different file row and repeat Ctrl+3 and Ctrl+N; check that the
  selected notebook stays the place things are made in. Check both the
  note and template buttons you can see.
- Save each default note-open mode and open, switch, close, and reopen
  notes. Check that Ctrl+E still works and an editing lock cannot be
  worked around.
- On an unknown file, test Open With with filenames that have spaces and
  non-English characters. Cancel the Windows chooser and check that the
  existing association has not changed. If Windows offers a default-app
  choice, test it only on a throwaway file type, check that the system
  opens it afterward, and put the original association back afterward.
- Import compatible files from outside the app, including HTML with
  active content. Check that the copy opens inside the app, unsafe HTML
  is removed, the original is unchanged, and rename, move, and reopen
  keep the copy's record of where it came from.

## Features in detail

This part walks through what the app can do, feature by feature.

### Tasks

Choose **View → Tasks**, or open the command palette. Markdown
checkboxes and HTML tasks show up in a table you can sort, and you can
narrow the list by status, due date, priority, or notebook. Checking or
unchecking a Markdown task updates the checkbox in its note. For an HTML
task, only the completion mark on that task changes, matched by its
stable task ID; if the note changed since the task was read, or the ID
is missing or appears twice, the change fails safely instead of editing
the wrong thing.

To give a Markdown task a date, write `due:10/05/2026` or
`📅 10/05/2026`. To give it a priority, write `priority:<option>`, where
the options are the ones set up for your library — Critical, High,
Medium, Low, and Optional by default. Notes written with the older date
form still work. The older priority words `low`, `normal`,
`high`, and `urgent` still work too.

Press Ctrl+Q anywhere to open the Quick Task dialog. The task text box
is focused first, so just type the task and press Enter or OK. It becomes
a new task in the Tasks list, saved as a task file in the current library
and notebook. If no notebook is open, a notebook chooser appears after
the text box in the same dialog, already set to your most recent
notebook — saving without choosing uses that notebook. If the library has
no notebooks at all, you need to pick a destination before saving. Every
Quick Task confirms with "Task created in [Notebook Name]", announced and
shown in the status bar, even when a notebook is already open. If no
library is open, Quick Task asks for a library first. On macOS, Quick
Task has no default shortcut; give it one under Settings → Keyboard
Shortcuts.

From the Notes and Files grid, open the context menu on a selected
note, link, or file and choose **Create task**: the New Task dialog
opens with that item already linked to the task — a note becomes the
task's associated note, and a file or saved web link is attached to
the created task.

Open the context menu on a task row (Shift+F10, the Applications key, or
right-click) for **Set due date**, which opens a dialog with a due date,
a due time, and an optional reminder, and **Set priority**, which opens a
dialog with the library's priority options and lets you add, rename, or
delete options. At least one priority option is always kept, and option
names are single words so they survive in task lines. Date fields in
that dialog, in the New Task dialog, and in the Create Reminder dialog
are entered as MM/DD/YYYY.

The same context menu offers **Link to note**, **Link to file**, and
**Link to Notebook**. Each opens a dialog listing the library's notes,
files, or notebooks; pick one to link it to the task you are on. Linked
items show in the Links column of the Tasks table, where you can open or
remove each link. Every task is also linked on its own to the note it
lives in, so the Links column always shows that note; if you remove that
automatic link, it stays removed. Links are stored in
`.a11ynotebook/task-links.json`. Links to tasks that were removed from a
note, and links in a note or notebook that was deleted, are removed on
their own; links to tasks without a stable ID are kept, since moving a
line changes its number. When a note, file, or notebook moves, its task
links move with it: links from its tasks and links pointing at it are
rewritten to the new paths.

HTML checklist items are `<li>` elements with a unique stable ID and a
completion state, for example:

```html
<ul>
  <li
    data-a11y-task-id="task-1234"
    data-a11y-task-complete="false"
    data-a11y-task-due="10/05/2026"
    data-a11y-task-priority="high"
  >
    Read chapter
  </li>
</ul>
```

You can also add `data-a11y-task-remind="10/04/2026 09:30"` to schedule
the same local-time reminder as a Markdown task reminder. HTML tasks
count toward due-date and priority sorting, filtering, and the
per-notebook progress summaries. Notes in encrypted envelopes are never
read or shown as tasks.

### Citations and bibliographies

Each notebook keeps its own bibliography. From the Insert menu, choose
**Citation generator…** (Ctrl+Shift+C) to create an entry: pick the
source type (book, journal article, website, book chapter, conference
paper, report, or thesis), then fill in the fields by hand — or paste a
DOI, ISBN, or web address and choose **Fill in from source** to fetch the
public record (Crossref for DOIs, Open Library for ISBNs, the page's own
details for web addresses). Pick a citation style to preview the
bibliography entry and the in-text citation, then save it to the
notebook's bibliography. Choose **Bibliography…** (Ctrl+Shift+J) to see,
edit, or delete saved entries, add an in-text citation for one of them
(with a cited page if you want), or insert the full bibliography into the
note you have open. Entries are stored in the library's bibliography
file, move with the notebook when it is renamed or moved, and stay
encrypted when the library is encrypted.

### Citation styles

Four styles are available: APA, MLA, Chicago (Author-Date), and Chicago
(Notes-Bibliography).

- **APA** is common in the social sciences and education. In-text
  citations sit in parentheses (Author, Year, p. 23), and the list is
  headed **References**.
- **MLA** is common in the humanities. In-text citations sit in
  parentheses (Author 23), and the list is headed **Works Cited**.
- **Chicago (Author-Date)** is the Chicago style most used in the
  sciences and social sciences. Like APA, it cites in parentheses with
  the year after the author, and its list is headed **References**.
- **Chicago (Notes-Bibliography)** is the Chicago style most used in
  history and the humanities. It cites with numbered footnotes instead
  of parenthetical citations, and its list is headed **Bibliography**.
  The year comes at the end of each bibliography entry, not after the
  author. Use it when your reader, publisher, or course asks for
  footnotes; use Author-Date when they ask for parenthetical citations.

### Footnotes (Chicago Notes-Bibliography)

When you insert a citation in Notes-Bibliography mode, a numbered
footnote marker goes into the text and the citation itself goes into a
notes section at the end of the note. The first time you cite a source,
the footnote gives the full citation; later mentions of the same source
give a shortened form (author, shortened title, and page). In Markdown
notes the marker looks like `[^1]` with the note at the end of the note;
in HTML notes it is a superscript numbered link. Either way, the marker
is a link to its note and each note has a link back to the marker, so you
can move between them with the keyboard: Tab to the marker and press
Enter to jump to the note, then follow the backlink to return.

### How the inserted list is formatted

In HTML notes the inserted bibliography follows the style guide: a
centered heading (**References** in bold for APA; **Works Cited** for
MLA; **References** for Chicago Author-Date; **Bibliography** for
Chicago Notes-Bibliography), a 0.5-inch hanging indent, and Times New
Roman 12-point type. APA and MLA lists are double-spaced with no blank
line between entries; Chicago lists are single-spaced inside entries
with a blank line between entries.

In Markdown and plain-text notes the hanging indent, line spacing, and
font cannot be applied, so the inserted list follows the style only as
far as plain text allows: the heading is a Markdown heading and the
entries are separated by blank lines. The citation dialog says so when
you insert, rather than claiming the output is fully formatted.

Type titles exactly as you want them. APA uses sentence case for titles
(only the first word and proper nouns capitalized); the app does not
change your titles for you, so type them in sentence case for APA
entries. For APA web pages with no publication date, the entry adds a
retrieval date ("Retrieved Month Day, Year, from …"); dated pages and
other source types do not get one.

### Annotations

In read mode, select text with the keyboard or with your screen
reader's selection command, then press Ctrl+Shift+A or choose Annotate
selection. Give the highlight a **text label**, a color, and an optional
comment. Annotations appear under the right-pane heading with Jump,
Edit, and Delete controls. Highlights have descriptions and are
underlined, so color is never the only clue. Quote, context, and offset
markers try to find text that has moved; if a marker is unclear, the
text changed, or markers overlap, the list says so instead of attaching
the note to the wrong text. Annotations are saved in
`.a11ynotebook/annotations.json`, unless you have turned on scoped
annotation and checkpoint protection, in which case the authenticated
encrypted store is the one that counts. The same text annotation works
on sanitized `.html` note content. PDF notes use a separate page and
quote system:

- Select PDF text, then choose **Annotate PDF selection** from the
  palette or the Shift+F10 / Applications / right-click context menu.
- If nothing is selected, use **Annotate a quote**, search for the
  quote, and pick a match from its page and context preview.
- Put focus on a paragraph, heading, or cell in the accessible page
  text and choose **Annotate this paragraph/heading/cell**.
- Add a label or a comment (or both), pick a labelled color or None,
  and Save. Tab and Shift+Tab stay in the dialog; Escape cancels.
  Comments can run to more than one line.

PDF highlights follow zoom and rotation. Notes show how sure the match
is; quotes that cannot be found are kept as orphans, and changed files
need a manual check rather than silently moving highlights. The reader
shows one page at a time; dragging a selection across pages is not
available. The PDF sidebar, clipboard export, and wider annotation
workflows are later follow-up work (phases 5–7). In an ePub, select text
and choose Annotate selection, then give it a label, a color, and an
optional comment, the same way as in a note. ePub annotations appear
under the right-pane heading with Jump, Edit, and Delete controls;
Jump moves your focus to the exact spot in the book where the
annotation was inserted, even when it is in another section.

### Reminders and project progress

Put `remind:10/04/2026 09:30` or `⏰ 10/04/2026 09:30` on an open
checkbox task (local time). Notes written with the older reminder form
still work. Finished tasks never send a reminder. **Open
Reminders** (Ctrl+Shift+R) also lets you make standalone reminders,
linked to a note or a file. You can also open the context menu on a note
or file in Notes and Files and choose **Create reminder**: the dialog
opens with that note or file already picked, and the **Link to** list
switches between notes, files, and links.

Switch between the labelled table and the Overdue, Today, and This week
lists. Snooze for 5, 15, 30, or 60 minutes, for 1 day, or until the same
local clock time tomorrow; Dismiss takes an item out of the active views.
Clicking a system notification opens its note when the library is still
open. Windows notification settings can hold back delivery.

While the app is running, its scheduler delivers reminders inside the
app; reminders you missed fire when you next open the app, and reminders
that already fired stay visible until you dismiss them. When the app is
closed and the computer is awake, due reminders still fire through a
scheduled background task: the app shows the notification and opens the
window on the due reminder. If several reminders are due, the earliest
one gets the focus. A sleeping computer is never woken up: a missed
reminder comes late on the next wake instead. Reminder state is saved in
`.a11ynotebook/reminders.json`. The creation dialog can save your time,
snooze, title privacy, and notification choices as the defaults for next
time, in `.a11ynotebook/reminder-defaults.json`; reminders you already
made keep the choices they had. Task notifications use your current
privacy and notification settings. Flashcard due notifications are
opt-in and share the same scheduler and delivery tracking. Closing the
last window exits the app on Windows; scheduled background delivery
still fires while the computer is awake, as described above.

The **Calendar** is one calendar for the whole library. Open it with
**Ctrl+6**, **Tools → Calendar** in the app menu, **View → Calendar**
in the native menu, or the command palette's **Calendar** command.
Appointments are stored in the library's `.a11ynotebook/calendar.json`
and can stand alone or link to a note, file, or task. Links live in
library files and survive local saves, cloud-folder copies, offline
mode, and provider sync; provider sync never sends a link, so a link
does not carry over to a fresh library through Google, but it is never
deleted from the library file either. If a linked note, file, or task
is gone, the calendar says the linked item is no longer available
instead of dropping the link. When a linked note, file, or notebook
moves, the appointment link is rewritten to the new path.

Timed appointments can also carry a reminder: in the appointment
dialog, choose No reminder, At start, or a set time before the start
(5, 15, or 30 minutes, 1 hour, or 1 day). All-day appointments offer no
reminders, because their start has no time to count back from.
Reminders fire through the same alerts as task reminders, with snooze,
dismiss, and complete, and they show in Reminders; clicking a fired
appointment reminder's system notification opens the Calendar. Reminder
choices are local-only, like links: they live in the calendar file, are
never sent to providers, and changing only a reminder does not count as
a sync change.

The **Agenda** view lists coming occurrences grouped under date
headings, with controls for the previous and next 30 days and for Today.
The **Month grid** is a table with a button for each day, labelled with
how many appointments that day has; picking a day lists that day's
appointments below the grid. **New appointment** asks for a title,
an all-day or timed start and end, location, description, recurrence
(daily, weekly, monthly, or yearly, with interval, count, end date, and
weekdays for weekly), and an optional link. Editing a recurring
appointment changes the whole series, not just one occurrence. Deleting
asks for confirmation in a separate dialog — a single appointment asks
"Delete this appointment?", and a recurring one offers **Delete this
appointment only** or **Delete the whole series**. Deleting one
occurrence removes it in the app only: it stays on Google, Outlook, or
Apple calendars, because the deletion is not sent to providers. Live
two-way sync with Google Calendar, Outlook Calendar, and Apple Calendar
is built in (see Calendar sync setup below). Windows screen-reader
checks have not been run yet.

### In-app reminder alerts

In **Settings**, you can turn on **in-app reminder alerts** on their
own, separate from the built-in Electron and Windows notifications. You
can set **Play reminder sound**, pick one of the bundled sounds and its
volume, and use **Test sound** to hear the sound you picked. The system
mute is respected. While the app is running, a sound can play even when
its window is unfocused or minimized. The alert waits until you bring
A11y Notebook to the front; it never pushes the app in front of another
application.

The bundled `src/assets/reminder-gentle-chime.wav` is an original sound
made for this project and shared under the project's MIT license, not a
third-party recording. It is 0.6 seconds of mono 16-bit sound at 22,050
Hz: two sine tones in a row, 660 Hz then 880 Hz, fading in and out with
squared-sine fades, at a peak loudness of 9,000. No sound is downloaded
and no extra sound software is needed.

The alert takes keyboard focus and shows queued reminders one at a time,
telling you how many are waiting. Use **Mark Complete** to finish the
linked task (if the note has conflicting edits, sort those out first),
or to finish a standalone reminder. **Dismiss** and **Snooze** work the
way they do elsewhere; the alert offers 5 minutes, 15 minutes, 30
minutes, 1 hour, and 1 day (24 hours). The older Tomorrow choice keeps
the same local clock time on the next calendar day, which can shift
across a daylight-saving change. Tab and Shift+Tab stay inside the
dialog, and focus goes back where it was after it closes. What happens
is announced in the status area. **Escape/Later closes the alert
without dismissing the reminder**; the item stays in Reminders. Alerts
with hidden titles use generic text.

Switching libraries cancels the old library's alert queue. Reminders
missed while the app was closed use the same queue when it starts. The
startup sound buffer keeps the latest 100 deliveries; older reminders
are still there in the visual queue and in Reminders, but they load
without sound. Reminders that already fired also reload silently, so
their sound does not play again.

**Locked-library delivery is partial:** locking stops the scheduler and
cancels queued alerts and sounds. No titles are shown, but reminders due
while the library is locked do not sound or produce the generic unlock
alert you asked for. Unlocking restarts scheduling and catches up on
missed reminders. A generic privacy-safe locked-delivery snapshot on the
same scheduler is still open work; do not count on reminder delivery
until the library is unlocked.

Delivery through the real Windows scheduler, background sound and
focus, and JAWS, NVDA, and Narrator announcements still need to be
checked by hand. Tasks also show per-notebook completion counts and
built-in progress bars.

### Calendar sync setup

Live sync works both ways: changes you make locally go to the provider,
and changes at the provider come down to the library. Google, Outlook,
and Apple sync each have a sign-in step inside the app: open the
Calendar, find the provider's sync section, enter your sign-in details,
save, then Sign in (Google and Outlook open a browser sign-in; Apple
checks directly) and Sync now. Keep every client ID, secret, and
app-specific password in your password manager; type them into the app
when it asks, never in chat or email. If a sync reports conflicts (an
appointment changed both locally and at the provider), the local version
is kept and sync stops there, so the same conflicts show up again on the
next sync until you settle them. Press **Resolve conflicts** and choose
for each appointment: **Keep local version** sends your version to the
provider, and **Take Google version** (or **Take Outlook version**) saves
the provider's version locally (your local-only link and reminder are
kept either way). After the last conflict is settled, run Sync now again
to finish the sync.

**Staying offline.** You do not need to set anything up to keep the
calendar offline: appointments live in your library's calendar file, and
nothing is sent to a calendar service unless you set up sync and press
Sync now. If your library folder itself is synced by the cloud (Drive,
Dropbox, OneDrive), that file travels between your computers on its own,
and the app on the other computer picks up the change live. Task
reminders travel the same way, because they live in your task files, and
reminder state lives in your library's reminders file. The Google
Calendar sync section has a "Keep calendar offline" button that hides
provider sync setup for every provider and blocks sync runs; going
offline signs you out first and never unlinks your appointments, so
turning setup back on picks up cleanly.

Read this part carefully, because it is easy to misunderstand: these
steps set up sync for YOU, on your accounts. They do not set it up for
everybody else, and they give nobody access to your accounts. A client
ID and secret identify the app to the provider; they are not a password
to your account. Each person who signs in does so with their own
account, allows access to their own calendar only, and gets their own
sign-in token that lives on their own device. Your calendar can only be
reached with a token you gave by signing in yourself. For the app to work
for everybody without each person doing these steps, it needs one shared,
Google-verified client owned by the app itself instead of by you; that is
not set up yet. Until then, each user follows the steps below for
themselves.

**Google.** In the Google Cloud Console (console.cloud.google.com),
create your own project (for example "A11yNotebook Calendar Sync"), open
"APIs & Services", then "Library", and turn on the Google Calendar API.
Under "OAuth consent screen", choose user type External, set the app name
to A11yNotebook with your email as the support and developer contact,
add the scope `https://www.googleapis.com/auth/calendar` (full access,
needed because sync writes your local changes to Google), and add your
own email under "Test users". Under "Credentials", create an "OAuth
client ID" of application type **Desktop app** (not Web application) and
save the Client ID and Client Secret it shows. While the consent screen
stays in Testing mode, only the test users you add (up to 100) can sign
in at all, and Google ends the sign-in after 7 days, so you would sign
in again about once a week; moving to Production removes the 7-day limit
and the test-user cap but needs a Google review for the Calendar scope.

**Outlook.** In the Entra portal (entra.microsoft.com), open "App
registrations" and create a registration named A11yNotebook with
supported account types "Accounts in any organizational directory and
personal Microsoft accounts", so personal Outlook.com calendars work.
Under "Authentication", add the "Mobile and desktop applications"
platform with redirect URI `http://localhost` (the app signs in through
an address on your own computer). Under "API permissions", add the
Microsoft Graph delegated permission `Calendars.ReadWrite` and save the
Application (client) ID. Then, in the app's Outlook Calendar sync
section, enter that client ID, save, then Sign in with Outlook and Sync
now. Outlook uses a public native client, so there is no client secret
to enter. Personal accounts work directly; work or school accounts may
need an administrator to approve the calendar permission. One limit:
Outlook events with a relative recurrence (for example "the second
Tuesday of each month") are skipped when pulling from Outlook, because
the app has no matching pattern; absolute monthly and yearly patterns
sync.

**Apple.** Apple offers no third-party calendar sign-in, so Apple sync
uses CalDAV with an app-specific password instead of your main password.
At appleid.apple.com, under "Sign-In and Security", open "App-Specific
Passwords" (this needs two-factor authentication on the Apple ID) and
make one named A11yNotebook; the password is shown once, so save it
right away. Then, in the app's Apple Calendar sync section, enter your
Apple ID and that app-specific password and save: the app checks the
sign-in by finding your calendar at `caldav.icloud.com` and tells you
the calendar name it found. Sync uses the first event calendar in the
account until you pick another: the Choose Apple calendar button lists
your event calendars, and saving a choice switches sync to it. Switching
after syncing asks for confirmation, because it resets Apple sync state
and unlinks existing Apple events from local appointments (the
appointments themselves stay, and upload to the new calendar on the next
sync). As with Outlook, events with a relative recurrence (for example
"the second Tuesday of each month") are skipped when pulling from Apple.
You can cancel the password at any time from the same Apple ID page.
Never type your main Apple ID password into the app.

### Templates and cognitive tools

**New note from template** (Ctrl+Shift+N) lists the templates in the
library's `Templates/` folder with a read-only preview and a
Markdown/HTML choice (Markdown is the default). Every library has a
`Templates/` folder at its root: the first time a library is opened, the
five built-in templates — Daily, Meeting, Project, Reading, and Lecture
— are copied there, and new libraries get fresh copies. Templates are
ordinary notes, so open one to edit it; editing a library's copy changes
only that library's copy, and deleting a built-in copy leaves it deleted.
Put your own safe, editable Markdown or HTML templates in `Templates/`
to add more; HTML templates are cleaned up after they are filled in.
You can use `{{title}}`, `{{date}}`, `{{time}}`, `{{weekday}}`,
`{{notebook}}`, and `{{cursor}}`; the first cursor marker sets where
the editing cursor lands. Built-ins change to the format you pick.

**Save note as template** (Ctrl+Shift+S) saves the open note as a
template: choose a template name (already filled in with the note's
title) and whether to keep the original note or throw it away once the
template is made. The template keeps the note's format (Markdown or
HTML). If a template with that name already exists, the dialog asks
whether to replace it.

Any other `{{Name}}` in a template is a fillable textbox: opening a note
made from the template shows a textbox named for it in the reading view
(a name used twice gets numbered names, such as "Client Name 1" and
"Client Name 2"). Fill the boxes in while reading; the rest of the note
stays read-only. Saving writes the typed values into the note text as
plain filled text, and the filled note remembers its template: a "New
fillable copy from this template" button in its reading view makes a
fresh fillable copy. If the template was renamed or moved, the button
follows it; if the template is gone, the button says so. Filling in a
template note itself never changes the template: saving it asks for the
filled copy's format, location, and name instead. Edit a template's
structure in editing mode, where the `{{Name}}` markers are plain text.
A misspelled placeholder such as `{{dat}}` becomes a textbox rather than
staying visible as text.

Choose **Cognitive tools** to create or open `.outline.md`,
`.mindmap.json`, `.cards.md`, `.csv`, or `.grid.md` files. Outline and
mind-map trees use arrow keys to move, Enter for a new item on the same
level, Tab and Shift+Tab to indent and outdent, and Alt+Up/Down to
reorder. The mind-map picture is decoration; the accessible tree is the
real content. Mind maps export to a new Markdown outline without
overwriting an export that already exists. Grids use arrow keys, Home
and End, and Ctrl+Home/End to move; Enter or F2 to edit, Enter to save
the cell, Escape to cancel, and Shift+Enter for a line break inside a
cell. Space sorts the focused column header; labelled controls sort and
change rows and columns. The save format starts as the current file
type; pick the matching format before saving. Flashcard decks use
`question :: answer` or `Q:`/`A:` blocks. Show the answer, then rate it
Again, Hard, Good, or Easy. Review schedules in the SM-2 style are saved
in `.a11ynotebook/flashcards.json`, and changing a question or answer
starts its history over. Save before closing a cognitive tool or
switching files; unsaved work is kept while you switch to another tab.
Changes made to a file outside the app are refused at save time; keep a
copy of your work elsewhere before closing and reopening to reload.

### Encrypted cognitive checkpoints

After you explicitly turn on scoped annotation and checkpoint protection
in an unlocked version-3 library, edits to outlines, mind maps,
flashcards, and CSV/Markdown grids are saved as checkpoints 750 ms
after you stop typing. Without that permission, saved recovery is off
and there is no plain-text draft fallback. The files themselves stay
ordinary files. Checkpoints keep the saved starting point and its hash,
expire after seven days, and are limited to 20 records, 2 MiB per saved
content or starting point, and 8 MiB in total. Checkpoint status and
errors are visible; a crash during the short wait can lose the latest
edits.

Reopen a file to get **Restore**, **Discard**, or **Compare** choices.
Compare shows the draft and the file without writing anything. Restore
puts the draft in the editor as **unsaved** content. If the file changed
since the checkpoint, a warning appears; nothing silently overwrites the
file. Discard removes the checkpoint, not the file. Drafts of outlines,
mind maps, or grids that are not valid can be compared or copied but
cannot be put back into their structured editors until the content is
valid; they are not silently thrown away. Saving successfully retires
the matching checkpoint; moves, renames, and deletes done by the app
update checkpoint paths and lifetimes. Locking or switching libraries
clears the editor and turns down stale checkpoint requests. Save
important work yourself.

### Export and web capture

Use **File → Export note…** (Ctrl+Shift+X) on an open note, or
**Export note…** in a note or tab menu; from a menu it exports that
note, otherwise it exports the note you have open. Choose standalone
HTML or Markdown and then a location in the save dialog. The source note
is never changed; overwriting needs the save dialog's confirmation, and
you cannot pick the original file as the destination. HTML output is
cleaned in the main process, has no scripts, forms, or remote resources,
and includes local images that fit the size limit. Relative links and
other attachments are not copied or adjusted. Annotation details are
stored separately and are not exported; converting to Markdown keeps
checklist state, due dates, and priorities where possible, but not HTML
task IDs or reminder scheduling. Read the format-loss and
asset-portability warnings before sharing. Exporting a note that is
encrypted on its own, or protected in another way, needs the explicit
consent box checked; locked content is never silently unlocked for
export.

Choose **Capture web page** and pick Markdown or HTML output. The app
takes public HTTPS pages only, pins public DNS addresses for each
request, checks redirects again, and applies the usual size, image, and
time limits. HTML output keeps semantic headings, lists, tables, safe
links, and images it managed to download, with their descriptions;
scripts, handlers, forms, and remote resources are removed. The note
says where it came from, using the checked final address. When some
images are missing or have no description, the app tells you how many
and adds a note about it in the saved note; the captured note is opened
and indexed.

### Attachment previews

Text files open in a text view. Raster images use a checked custom
address the library allows, and have an editable description saved in
the file's details. Image links need local image files. A PDF uses a
bundled local pdf.js worker for a bounded page image, selectable text,
zoom and rotation, separate semantic page text, page navigation,
in-document search, and saved PDF notes. An ePub uses local epub.js
page-by-page rendering, a nested table of contents, and section
navigation and search. Chapter markup is cleaned; wider checks for
hostile archives and resources are still open. Your reading position is
saved, so reopening a book resumes where you stopped, and ePub
annotations work as described under Annotations. Text taken from an
ePub stays available for
search and assistive technology; scripts, embedded frames, forms, and
unsafe attributes are removed before display. Both are limited to 40 MB.

DOCX files use a local bounded parser and a semantic reader with
headings, lists, tables, safe links, raster images, navigation, and
search. Encrypted Office files, macros, embedded OLE packages, and
unsafe external resources are turned down. DOCX annotations are not
available, and old binary `.doc` files are not supported. **Open in
external app** is still there. Text previews are limited to 5 MB and
images to 20 MB. In the PDF Page Navigation section, **PDF view** opens
every PDF in Continuous view (the whole PDF as one continuous page) to
start with. Pick Paginated view (one page at a time) instead and that
choice is remembered, so the next PDF you open starts in Paginated view
too; pick Continuous view again to go back. The Previous and Next Page
buttons only show in Paginated view. In Continuous view, every page starts with a "Page N"
heading under the "Page text" heading, so heading navigation steps
through each page in order.

### OCR scanned PDFs and ePubs

A scanned PDF or ePub has no text to read — it is pictures of pages,
not text. **OCR this file**, in the reader (and next to the "no
extractable text" message), reads the whole file with a text recognizer
that runs on your computer, so nothing leaves it. A dialog asks which
language the file is in, every time — there is no automatic detection
and no silent default. English data is built in; another language
downloads its data once, the first time you pick it, and then works
offline. A whole book can take minutes: the dialog shows progress for
each page or section and has a **Cancel OCR** button.

The recognized text is shown in the reader only at first — it is
temporary. Pages and sections that already have real text are left
alone; only the ones with no text get recognized text. When you want to
keep it, press **Ctrl+S** (the same shortcut as saving a note), or use
**Save into file** in the finished dialog. Saving writes the text into
the file: a hidden text layer in a PDF, so it becomes searchable and
selectable, and text written back into an ePub. A file the library
manages updates in place; an Alius (a link to a file kept elsewhere)
instead saves a copy in the library — the original file is never
changed. The save is announced. Files larger than 40 MB cannot be read
this way, and password-protected or permission-protected PDFs cannot be
saved into.

### Audio notes, dictation, and transcription

Audio files (`.webm`, `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, up to 40
MB) can be imported like any attachment and open in the app with the
usual playback controls. Transcription runs entirely on your machine
with a free local Whisper model, so audio never leaves it.

**Record an audio note.** File menu, then **Record audio note** (also in
the command palette). It records into the notebook you have selected,
or the library root when none is selected. Use the same command again to
stop. The recording is saved as "Audio note" plus a timestamp and opens
in the attachment preview, where you can play it back.

**Dictate into a note.** With a note open in edit mode, press
**Ctrl+Alt+D** (Edit menu, then **Dictate**, or the Dictate button among
the editor command buttons) to start, and the same shortcut again to
stop. The recorded part is transcribed and the text goes in where the
cursor is. Dictation works in chunks — speak, stop, and the text appears
— rather than word-by-word as you speak.

**Choose a transcription model.** The first time you dictate or
transcribe, a dialog asks which model to download: the **Smaller model**
(Whisper Base, about 150 MB; faster to download and transcribe, good
accuracy for clear speech) or the **Larger model** (Whisper Small, about
500 MB; slower, noticeably more accurate, especially with accents,
background noise, or quiet speech). The download happens once. You can
change the model later in Settings, under **Transcription model**; the
new model downloads the next time you transcribe.

**Transcribe an audio file.** Open the audio file and press
**Transcribe**. The transcript is saved as a note next to the audio file
— for example, "Interview transcript.md" for "Interview.webm" — with a
link back to the audio file. When a transcript exists, the audio preview
offers an **Open transcript** button. Transcribing again replaces the
existing transcript note instead of making a second one.

### Spreadsheets and slide decks

Spreadsheets (`.xlsx`, `.ods`, `.csv`, up to 40 MB) can be imported like
any attachment and open in an editable grid. Slide decks (`.pptx`,
`.odp`, up to 40 MB) open as read-only text: a list of slides with
titles, body text, and speaker notes.

**Edit a spreadsheet.** Open the file to see its sheets as a table with
row numbers and column letters. Each cell is a text box labelled with
its row and column; type a new value and move on — numbers stay numbers,
TRUE and FALSE stay true and false, and a date typed into a cell that
already held a date stays a date. Cells that hold a formula show the
formula's calculated value and are labelled as formulas; editing one
replaces the formula with the value you type. Use **Add row** and **Add
column** to grow the sheet at the end, and **Delete row** / **Delete
column** to remove the row or column the focused cell is in. When a
workbook has more than one sheet, pick the sheet from the **Sheet** list.

**Save a spreadsheet.** Press **Ctrl+S**, or the **Save spreadsheet**
button, to save back into the same file, like a note. Old binary `.xls`
files are read-only where they are: saving one creates a new `.xlsx`
file next to it and leaves the original unchanged.

**Read a slide deck.** Choose a slide from the list to read its text.
Speaker notes appear under the slide text when the deck has them.
Slides cannot be edited in this release.

**Formats that need an export first.** Apple Numbers (`.numbers`),
Apple Keynote (`.key`), and old PowerPoint (`.ppt`) files cannot be read
directly: export them from their app as `.xlsx` or `.pptx` and import
that file. Google Sheets (`.gsheet`) and Google Slides (`.gslides`) files
are only links: open them in Google Sheets or Slides, download as
`.xlsx`, `.csv`, or `.pptx`, and import that file.

### Links

A link is a standalone item in the Notes and Files grid — a shortcut to
a web page that lives in a notebook alongside your notes. It is not a
link inside a note: adding a link never writes into the open note. A
link shows its page title as its name and **Link** as its Type.

**Add a link.** File menu, then **Add link** (or the **Add link** button,
or **Ctrl+Alt+L**). Type the title yourself and the web address, then
press **Add link**. The address must start with `http://`, `https://`,
or `mailto:`. The link is saved as a `.url` file in the current
notebook, so it also opens in a browser when double-clicked outside the
app. If a link with that title already exists, the new one gets a number
added to its name.

**Open a link.** Press Enter on it in the grid, or double-click it, and
the page opens in the default browser. The link itself never opens
inside the app.

**Edit a link.** Open the context menu on it (Shift+F10, Applications
key, or right-click) and choose **Edit link**. Change the title, the
address, or both, then press **Save changes**. Changing the title
renames the file; the address is stored in the file.

**Delete a link.** Delete it like a note: select it in the grid and
press Delete, or choose **Delete selected item** from its context menu.
A protected link must be unprotected first, like any protected item.

**Create a reminder for a link.** Open the context menu on a link
(Shift+F10, Applications key, or right-click) and choose **Create
reminder**: the new reminder dialog opens with that link already linked
to the reminder.

**Find a link.** Link titles and addresses are searchable like note
titles: search the library for the title or part of the address.

**Add a Google Docs, Sheets, or Slides link.** A `.gdoc`, `.gsheet`, or
`.gslides` file is only a link to an online document, not the document
itself. When you import one, a dialog offers **Add as link** alongside
the usual guidance: type a title and press **Add link** to keep the live
document as a link item in the notebook, or follow the guidance to
download the document and import the downloaded file instead.

### Security

Security settings can turn on the library password gate and set up idle
locking. Single notes can have their own passwords through **Encrypt
note**; the dialog can make up a password and clear it from the
clipboard after 30 seconds if nothing else has replaced it. To turn on
library recovery, open Settings → Library security while the library is
unlocked, confirm the current library password, then save the one-time
recovery key it shows somewhere safe and check the acknowledgment before
saving it. The app never copies the recovery key on its own. Recovery
can reset the library password and keeps migrated credentials and notes
encrypted with the library key; it cannot recover notes with their own
passwords. You can change the recovery key after saving its replacement,
or turn off recovery after confirming the current password. Losing a
note password cannot be undone. Library protection gates access to the
app but does not encrypt unmarked files, filenames, search indexes, or
most details about your files.

Scoped annotation and checkpoint protection needs an unlocked
**version-3** library (turn on recovery first for older setups) and your
explicit permission. It protects only Markdown, HTML, and PDF
annotations and cognitive checkpoints. **Search indexes and snippets,
the link index, bookmarks, reminders, settings, flashcard schedules,
image descriptions, source files, attachments, and exports stay
unencrypted. This is not whole-library encryption.** Moving to the
protected store removes the old annotation store after the encrypted
copy is safely saved; deleted unencrypted text may still be on the disk
or in backups. Data that has been tampered with or is missing fails
closed — it is never silently read as plain text. Resetting the password
through recovery, and changing or turning off the recovery key, keep
protected stores safe; notes with their own passwords stay separate.
See [Security](security.md) before storing sensitive information.

### Sensitive-action history

The app keeps a small local `.a11ynotebook/audit.json` log of protection,
recovery, credential access and changes, note encryption, and export
requests. It holds only what kind of action it was, whether it worked,
and when — never passwords, keys, credentials, note text, or paths. It
keeps at most 1,000 entries from the last 90 days when a new entry is
written. This plain-text file on your computer can be changed or deleted
by anyone with your computer account, and it is not proof for an
investigation.

If a warning says an entry was **not recorded**, read what it says about
the action itself: a change or export that worked is still done, and an
action that was saved may have hit a later cleanup or indexing problem.
Do not run the action again just to retry the logging. Check disk space
and the permissions on the app's details folder; a damaged log is not
silently deleted or overwritten. There is no in-app viewer for this
history. Automatic locks when idle, on exit, or on switching libraries,
and ordinary editing, are not logged. See the security documentation for
the exact limits.

### Not available yet

Whole-library encryption, and encryption of the indexes and details
listed above, are not available. Cognitive checkpoints need your explicit
scoped-protection permission; save important edits yourself, including
while saved recovery is turned off. DOCX local reading works; DOCX
annotations and old `.doc` local reading are still unavailable. Format
conversion makes a warned copy next to the original and keeps the
original; a full list of what is lost and converting in place are still
open. PDF sidebar, export, and lifecycle workflows, and wider document
lifecycle features are open work, not blocked by anything outside the
app. See the [reader and annotation follow-up
plan](roadmap.md#document-reader-and-annotation-follow-up-plan).
Picking from recent libraries and organizing the calendar are still
open. Manual Windows screen-reader and UI Automation smoke tests have
not been run.
