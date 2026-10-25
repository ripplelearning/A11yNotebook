# Keyboard shortcuts

Generated from `src/shared/command-registry.ts` by `npm run docs:shortcuts`.

| Shortcut       | Command                                 |
| -------------- | --------------------------------------- |
| Ctrl+N         | New in current view                     |
| Ctrl+Shift+B   | Back up library                         |
| Ctrl+Shift+O   | Open in external app                    |
| Ctrl+Shift+I   | Import file                             |
| Ctrl+0         | Contents view                           |
| Ctrl+1         | Libraries                               |
| Ctrl+2         | Notebooks                               |
| Ctrl+3         | Notes & Files                           |
| Alt+ArrowLeft  | Back in history                         |
| Alt+ArrowRight | Forward in history                      |
| Ctrl+Shift+X   | Export current note…                    |
| Ctrl+Shift+W   | Capture webpage…                        |
| Ctrl+Shift+E   | Reveal selected item in Explorer        |
| Ctrl+Shift+Y   | Encrypt current note…                   |
| Ctrl+Shift+F   | Convert current note to another format… |
| Ctrl+Shift+G   | Convert current note to outline…        |
| Ctrl+Shift+M   | Insert image or attachment              |
| Ctrl+Alt+S     | Settings                                |
| Ctrl+Shift+N   | New note from template                  |
| Ctrl+Shift+A   | Annotate selection                      |
| Ctrl+Alt+A     | Annotate PDF selection                  |
| Ctrl+Alt+P     | Annotate this paragraph/heading/cell    |
| Ctrl+Shift+R   | Open Reminders                          |
| Ctrl+6         | Open Milestones                         |
| Ctrl+5         | Cognitive tools                         |
| Ctrl+B         | Bold                                    |
| Ctrl+I         | Italic                                  |
| Ctrl+Alt+1     | Heading 1                               |
| Ctrl+Alt+2     | Heading 2                               |
| Ctrl+Alt+3     | Heading 3                               |
| Ctrl+Alt+4     | Heading 4                               |
| Ctrl+Alt+5     | Heading 5                               |
| Ctrl+Alt+6     | Heading 6                               |
| Ctrl+Alt+8     | Bulleted list                           |
| Ctrl+Alt+7     | Numbered list                           |
| Ctrl+Alt+9     | Checkbox list                           |
| Ctrl+Alt+Q     | Quote                                   |
| Ctrl+Alt+C     | Code block                              |
| Ctrl+Shift+L   | Insert link                             |
| Ctrl+K         | Insert link                             |
| Ctrl+Alt+T     | Insert table                            |
| Alt+=          | Insert math                             |
| Ctrl+O         | Open library                            |
| Ctrl+S         | Save note                               |
| Ctrl+4         | Tasks                                   |
| Ctrl+D         | Toggle note bookmark                    |
| Ctrl+Shift+D   | Edit note metadata…                     |
| Ctrl+W         | Close current tab                       |
| Ctrl+E         | Toggle read-only/edit mode              |
| F9             | Toggle right pane                       |
| Alt+Q          | Focus search                            |
| Alt+1          | Focus navigation                        |
| Alt+2          | Focus main content                      |
| Alt+3          | Focus right pane                        |
| Ctrl+Shift+P   | Command Palette                         |
| F5             | Refresh links                           |
| F1             | Keyboard Shortcuts                      |
| Ctrl+Shift+U   | Check for Updates                       |
| Ctrl+Shift+H   | About A11y Notebook                     |

## Navigation keys

| Shortcut                                                             | Action                                         |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| F6 / Shift+F6                                                        | Move to the next / previous pane               |
| Ctrl+Tab / Ctrl+Shift+Tab                                            | Switch open tabs                               |
| In the library tree: Up/Down, Left/Right, Home/End                   | Move, expand, and collapse                     |
| In the library tree: Enter, F2, Delete, `*`, first-letter type-ahead | Open, rename, delete, expand siblings, or find |

## Feature navigation

These are defaults; Settings can change command bindings. Help and the command palette show active bindings.
Standard text editing and pane/tab navigation are reserved.

| Context               | Keys / behavior                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Global context menu   | Shift+F10 / Applications key / right-click; arrows, Home/End, type-ahead, Enter/Space, Escape         |
| Rich-text toolbar     | One tab stop; Left/Right, Home/End; Tab leaves toolbar                                                |
| Outline/mind-map tree | Arrows; Enter new item; Tab/Shift+Tab indent/outdent; Alt+Up/Down reorder                             |
| Editable grid         | Arrows, Home/End; Enter/F2 edit; Enter commit; Shift+Enter newline; Escape cancel; Space sorts header |
| Details grid          | Arrows/Home/End navigate cells and headers; Enter opens or sorts; Space selects or sorts; F2 renames  |
| Flashcards            | Tab to Show answer, then Again/Hard/Good/Easy                                                         |

## Customize and capture

Settings exposes a **Keyboard Shortcuts** heading. Every command has a manual textbox and an optional
**Capture Shortcut for [command]** button. Activate it, then press Ctrl/Alt plus a letter or number, or F1–F12
with optional Ctrl/Alt/Shift modifiers. Capture normalizes the combination into that command's draft textbox;
**Save settings** applies it and **Cancel** discards draft changes.

**Escape** or **Cancel capture** cancels without closing Settings or changing the old binding. **Tab** cancels
and continues dialog navigation. A different capture button replaces the listener. Reset, save and close stop capture.
Modifier-only presses wait; repeats, IME/composition, AltGraph and unsupported keys do not replace the old value.
Existing conflict checks apply to defaults, custom assignments, fixed aliases, and reserved navigation/editing keys.
Listening and validation feedback are announced; successful capture focuses the textbox and cancellation returns
focus to the capture button (Tab instead continues navigation). App shortcuts and native accelerators are suspended
while listening. Operating-system-reserved combinations may not reach the app and cannot always be intercepted.

Under **Appearance and interface**, **Show command/action buttons in the UI** restores the button-rich layout.
It defaults off (also for older settings), keeps the native menu in either mode, and applies on Save settings.
Browser-only development retains accessible command buttons without a native menu.
