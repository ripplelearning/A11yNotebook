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

## Electron integration tests

- Smoke-test the Electron shell startup path.
- Confirm the browser window loads the renderer and displays the expected app shell.
- Confirm the preload bridge is enabled without exposing Node to the renderer. `window.a11yNotebook` exposes only typed updater, vault, and menu-command operations; `require` and `process` are undefined.
- Confirm the packaged build loads `dist/index.html` from the asar archive with the Content Security Policy in place.
- Updater state machine unit tests (`src/test/updater-controller.test.ts`): development and portable builds never contact GitHub, nothing downloads without consent, and errors are reported once.

## Windows UI Automation smoke-test plan

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
