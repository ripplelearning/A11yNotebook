# User guide

## Open a vault

Choose **Vault → Open vault** and select a folder. The folder stays on disk as an ordinary folder. Subfolders appear
as notebooks, `.md` files as notes, and other files as attachments. The last opened vault is restored next time.

## Navigate files

Use the **Vault files** tree. Up and Down move between visible items; Right expands a notebook or enters its first
child; Left collapses or moves to its parent. Home and End move to the first and last visible item. Enter opens a
note or opens an attachment in its default application. F2 renames the focused item. Delete asks before moving it
to the Recycle Bin. Type a letter to find the next item beginning with that letter; `*` expands sibling notebooks.

Use **New note**, **New notebook**, or **Import file** in the navigation pane. Imported files are copied into the
selected notebook. The tree's filesystem context may be revealed in Explorer or opened in its default external app
using the corresponding vault actions.

## Read and edit notes

Notes open in tabs. The read view contains semantic headings, paragraphs, lists, links, and code rendered from
Markdown; unsafe embedded HTML is removed. Toggle **Read-only/edit mode** with Ctrl+E to edit the Markdown source
in a native text area. Ctrl+S saves immediately; edits also save after a short idle period. A tab marks unsaved
content and asks before discarding it when closed.

## Search

Type in **Global search** to search Markdown note titles and body text in the open vault. Select a result to open its
note. Search currently does not index attachment contents, tags, or metadata.

## Tasks

Choose **Open Tasks** in the navigation pane or command palette. Markdown checkboxes appear in a sortable table;
the status, due-date, and notebook filters narrow the list. Checking or unchecking a task updates its checkbox in
the source note. Optional dates use `due:YYYY-MM-DD` or `📅 YYYY-MM-DD`; priorities use `priority:low`,
`priority:normal`, `priority:high`, or `priority:urgent`.

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

Reminders, bookmarks, annotations, backlinks, shortcut customization, formatting dialogs,
password protection, in-app attachment previews, and cognitive assets are planned but are not presented as working
features in this build.
