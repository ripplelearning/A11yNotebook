# Product roadmap

Status key: ✅ complete · 🚧 in progress · ⏳ planned

## Phase 1 — Foundation shell and accessibility model ✅

- ✅ Scaffold stabilized: installs, type checks, lints, tests, and builds cleanly. The main and preload code compiles to CommonJS, and the renderer is bundled by Vite.
- ✅ Real focus management: F6/Shift+F6 pane cycling, focus commands, a modal command palette, and WAI-ARIA tabs
- ✅ Windows packaging: NSIS installer and portable `.exe` built with electron-builder (`npm run package:win`)
- ✅ Secure, user-initiated in-app updater through Help → Check for Updates, backed by GitHub Releases
- ✅ CI workflow (type check, lint, test, build) and a tag-triggered Windows release workflow
- 🚧 Code-signed releases (needs a Windows code-signing certificate)
- 🚧 Manual JAWS, NVDA, and Narrator checks of the Help menu and update dialog

- Electron + React + TypeScript shell
- Accessible menu, header, navigation, content area, tabs, info pane, and status bar
- Global command registry and command palette
- Focus-region cycling with F6 and Shift+F6
- Read-only/edit mode toggles and live state announcements
- JSON persistence boundary and sample vault data
- Automated tests for registry behavior and renderer accessibility primitives

## Phase 2 — Vault and notebook model

- ✅ A vault is a local folder; notebook folders, Markdown notes, and attachments are read directly from disk.
- ✅ Human-readable hidden `.a11ynotebook/` metadata directory; the note format remains ordinary Markdown.
- ✅ Native folder picker, recent-vault restoration, create notebook/note, rename, import, reveal, external open, and recycle-bin delete.
- ✅ Main-process filesystem service validates relative paths and rejects symlinks; renderer receives only typed IPC operations.
- ✅ Accessible tree with roving focus, expansion, arrows, Home/End, Enter, F2, Delete, type-ahead, and `*`.
- ✅ Global search across Markdown names and bodies.
- ⏳ External-change watching, moves, metadata/index cache, search filters, richer context menus, and recent-vault picker.

## Phase 3 — Reader and editor experience

- ✅ Sanitized semantic Markdown rendering and native textarea source editing.
- ✅ Open-note tabs with close controls, unsaved state, Ctrl+W, Ctrl+Tab, and auto-save.
- ⏳ Formatting commands, full internal wiki-link handling, link/backlink index, and annotation/bookmark workflows.

## Phase 4 — Search, indexing, and annotations

- ⏳ Persistent indexed search, search filters, bookmarks, annotations, and link graph/backlinks.
- ⏳ Search beyond Markdown notes (documents, PDFs, ePubs, and web captures).
- User-generated tags and metadata suggestions

## Phase 5 — Tasks, reminders, and project planning

- ⏳ Task parsing, task list/table and filtering, reminders, and calendar-like organization.
- Project tracking and milestone summaries
- Sortable tables and cognitive assets

## Phase 6 — Cognitive assets and templates

- ⏳ Mind maps, outlines, flashcards, and tables.
- ⏳ User-editable templates and custom asset modules.
- Extensible asset model for later plugin architecture

## Phase 7 — Security and local protection

- ⏳ Optional vault password protection and editing locks (requires a reviewed encryption design).
- Secure local storage model
- Audit logging for sensitive changes

## Phase 8 — Import and document support

- ✅ Attachments are stored in the vault, listed in the tree, and can be revealed or opened externally.
- ⏳ In-app PDF/ePub/HTML/web capture previews and link resolution.

## Phase 9 — Accessibility validation and release readiness

- Automated DOM and keyboard interaction tests
- Windows UI Automation smoke testing
- Manual screen-reader validation across JAWS, NVDA, and Narrator
- ✅ Packaging, installer, and release process (delivered early, in Phase 1)
