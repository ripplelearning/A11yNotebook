# A11y Notebook

A11y Notebook is a local-first Windows desktop app for accessible personal knowledge management. It supports
Markdown notes, sanitized HTML notes, a rich-text editing mode, attachments, an accessible file tree, note tabs,
and a sandboxed reader.

## Current scope

- An accessible shell with a header, menu bar, navigation pane, tabs, main content pane, right pane, and status bar.
- Local vault folders with notebooks as subfolders, Markdown and HTML notes, and attachments. Vault metadata is stored as
  readable JSON under `.a11ynotebook/`.
- Keyboard-operable tree navigation, note creation, rename and deletion (to the OS Recycle Bin), file import,
  Explorer reveal, external open, and recent-vault restoration.
- Sanitized semantic Markdown/HTML reading, plain-source editing, and accessible rich-text editing with Ctrl+S and idle autosave.
- Markdown and HTML note creation; rich-text paste is sanitized. HTML notes support relative links, search, stable-ID checklists, task filters/toggles, and text annotations.
- Convert a note into a Markdown/HTML sibling copy with a loss warning; the source file is retained.
- Create from Markdown or safe HTML templates, including built-ins converted to either format, with placeholders and cursor placement.
- Export HTML or Markdown notes through a native save dialog as sanitized standalone HTML or Markdown. Local raster images are embedded in HTML exports; relative links are not packaged. Protected notes require explicit decrypted-content consent.
- Capture public HTTPS pages as Markdown or HTML. Capture HTML is sanitized in the main process; headings, lists, tables and links are retained, raster images are localized, and partial image failures are noted.
- Persistent main-process full-text search with snippets, notebook/kind/tag/modified-date filters, and debounced queries.
- External-change watching, clean-note reloads, and explicit conflict resolution that preserves unsaved edits.
- Confirmed moves/renames with repair of unambiguous wiki and inline relative Markdown links.
- Labelled Markdown highlights/comments; formatting tools and link/table/attachment dialogs.
- Built-in and user-editable note templates; outline, mind-map, flashcard, CSV, and Markdown-table tools.
- Reminders, native notifications while the app runs, a grouped agenda, and notebook task progress.
- Sandboxed HTML, plain-text/CSV, and local raster-image previews, including saved image descriptions.
- PDF.js-rendered PDF pages with accessible text and search; epub.js text-first section navigation and search. PDF zoom/selectable text layers and ePub visual reflow/TOC remain open.
- Persisted autosave, appearance, font-size, and conflict-checked keyboard-shortcut settings.
- Checkbox tasks indexed from Markdown and semantic HTML. HTML tasks use stable `data-a11y-task-id` identity, completion, due-date and priority attributes; both formats support filters, sorting, reminders and progress summaries.
- Wiki and relative Markdown links with a vault-wide forward/backlink index, plus persisted note bookmarks.
- Real focus movement between panes with F6 and Shift+F6. The right pane is skipped when it is hidden.
- A command registry that drives the menu bar, keyboard shortcuts, and a modal command palette (Ctrl+K).
- One context-aware menu driven by the command registry, available with Shift+F10, the Applications key, and right-click.
- Closable tabs that follow the WAI-ARIA tabs pattern (arrow keys, Home, End, roving focus).
- Switching between read-only and edit mode, with announcements in the status bar.
- A Help menu with **Check for Updates**, **Keyboard Shortcuts**, and **About A11y Notebook**.
- A Windows installer (`.exe`), a portable `.exe`, and a secure in-app updater that uses GitHub Releases.
- Tests for vault path validation, tree keyboard behavior, Markdown sanitization, focus management, dialogs, and updater logic.
- Documentation of how HomerDev influenced the design without copying it.

## Accessibility commitments

- Use native semantic controls before custom ones.
- Give controls screen-reader-friendly labels and states.
- Make everything keyboard operable, with visible focus and feedback when commands run.
- Plan for compatibility with JAWS, NVDA, Narrator, and Windows UI Automation.

## Install on Windows

1. Open the [Releases page](https://github.com/ripplelearning/A11yNotebook/releases) and download
   `A11y-Notebook-Setup-X.Y.Z.exe`.
2. Run it. The installer lets you choose the install folder and installs for your user account only, so no
   administrator rights are needed. It adds a desktop shortcut and a Start menu shortcut, both named
   **A11y Notebook**.
3. Unsigned builds make Windows SmartScreen show "Windows protected your PC". Choose **More info**, then
   **Run anyway**. See [Security posture of the updater](#security-posture-of-the-updater).

`A11y-Notebook-Portable-X.Y.Z.exe` runs without installing, but it cannot update itself.

## Development

Requires Node.js 22 or later.

```sh
npm install        # install dependencies
npm run dev        # start the Vite dev server and Electron
npm test           # run the Vitest suite
npm run typecheck  # type check the renderer and the Electron main/preload code
npm run lint       # ESLint
npm run format     # Prettier
npm run docs:shortcuts # regenerate docs/keyboard-shortcuts.md from the command registry
npm run build      # build the renderer (dist/) and the main/preload code (dist-electron/)
npm run test:ui-smoke # Windows only; run after npm run package:win
```

## Build the Windows `.exe`

Run this on Windows. On macOS or Linux, electron-builder also needs [Wine](https://www.winehq.org/) to build the
NSIS installer.

```sh
npm install
npm run package:win
```

The output goes to `release/`:

- `release/A11y-Notebook-Setup-X.Y.Z.exe`: the NSIS installer. This is the file to install and test updates with.
- `release/A11y-Notebook-Portable-X.Y.Z.exe`: the portable build.
- `release/win-unpacked/`: the unpacked app, useful for quick checks.
- `release/latest.yml`: the update metadata that `electron-updater` reads.

`npm run package:win` never publishes anything. `npm run release:win` builds **and publishes** to GitHub Releases.
It needs a `GH_TOKEN` with `repo` scope and is normally run only by the release workflow.

The app icon is `build/icon.ico` (256×256 plus smaller sizes). To use a different icon, replace that file.

## How updates work

1. In the installed app, choose **Help → Check for Updates**. It is also in the command palette and in the native
   Windows Help menu (Alt, H).
2. The app checks the GitHub Releases of `ripplelearning/A11yNotebook`.
3. If a newer version exists, a dialog shows the version and a summary of its release notes. Choose **Download**
   or **Not now**. Nothing downloads without your choice.
4. Download progress appears in the dialog and in the status bar. Screen readers hear it every 10 percent.
5. When the download finishes, choose **Restart and install** or **Install on exit**.

Updates do not run from `npm run dev`. That build says "Updates are only available in the installed build."

See [`docs/updater.md`](docs/updater.md) for the full design.

## Release procedure

`electron-updater` only sees **published GitHub Releases**. A plain `git push` to `main` is invisible to Check
for Updates, so you must publish a tagged release.

1. Bump `version` in `package.json` (for example, to `0.2.0`). It must be higher than the installed version:
   ```sh
   npm version 0.2.0 --no-git-tag-version
   ```
2. Commit and push:
   ```sh
   git commit -am "Release v0.2.0"
   git push
   ```
3. Tag the commit with the **same** version and push the tag:
   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. The **Release** workflow (`.github/workflows/release.yml`) runs on `windows-latest`. It checks that the tag
   matches `package.json`, runs the type check and tests, builds, and publishes the installer, portable `.exe`,
   and `latest.yml` to a GitHub Release named `v0.2.0`.
5. When the workflow finishes, open the installed app and choose **Help → Check for Updates**.

To test updates during development: install one release, then publish a newer tag every time you want to pick up
the latest changes.

## Security posture of the updater

- Updates start only when you ask for them. There are no silent downloads and no automatic installs.
- Updates come only from this repository's GitHub Releases. The feed is fixed in the main process, and the web
  page inside the app cannot change it.
- The app embeds no GitHub token. Public releases do not need one.
- The renderer runs with `contextIsolation`, `sandbox`, and without Node integration. It can reach only a small,
  typed updater and vault APIs. The main process accepts calls only on whitelisted IPC channels, and only from the
  app's own window. Vault paths are validated against the open vault.
- Release notes are shown as plain text, never as HTML.
- **Code signing:** the release workflow automatically signs when the `WINDOWS_CERTIFICATE` and
  `WINDOWS_CERTIFICATE_PASSWORD` repository secrets are configured. This branch wires secret-based signing; no
  certificate is provided or used by this development build. Signing prevents
  SmartScreen warnings, and `electron-updater` then checks that every update is signed by the same publisher.
  **Unsigned builds still update, but without a signature check, so they are fine for testing and not safe for
  production.**

## Project structure

- `electron/`: Electron main process (window, native menu, updater, local store) and the sandboxed preload bridge.
- `src/renderer/`: React UI shell, dialogs, and hooks.
- `src/shared/`: commands, types, IPC contract, and updater model. No Node or Electron imports.
- `src/test/`: Vitest and React Testing Library tests.
- `build/`: packaging resources (application icon).
- `docs/`: product, accessibility, and updater docs.
- `.github/workflows/`: CI (type check, lint, test, build) and the tag-triggered Windows release.

## Roadmap summary

This remains an unfinished development build. Vault password gating and selected-note encryption exist, but
whole-vault encryption, recovery keys, and sensitive-action audit logging do not. PDF.js currently draws a bounded
canvas page and exposes separately flattened page text; there is no selectable/zoomable text layer. epub.js exposes
flattened spine-section text, not styled reflow or a navigation TOC. PDF/ePub annotations remain open. Markdown and
HTML notes support text annotations, with HTML anchored in the sanitized rendered note. HTML tasks, two-format
templates, sanitized export and HTML capture are implemented with documented metadata and asset limits. Several other
roadmap items still need implementation, and Windows UI Automation and manual screen-reader validation have not been run.
See [`docs/roadmap.md`](docs/roadmap.md), [`docs/security.md`](docs/security.md), and the manual accessibility matrix.
No app version was changed and no release was published by this feature work.

## Documentation

- [User guide](docs/user-guide.md)
- [Architecture](docs/architecture.md)
- [Security and remaining protection work](docs/security.md)
- [Keyboard shortcuts](docs/keyboard-shortcuts.md) (`npm run docs:shortcuts` regenerates this file)
- [Accessibility testing strategy](docs/accessibility/testing-strategy.md)

## License

[MIT](LICENSE)
