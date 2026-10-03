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
- ✅ Persistent search cache, notebook/kind/tag/modified-date filters and context snippets.
- ✅ External-change watching, clean-note reload, and dirty-note conflict choices with autosave paused.
- ✅ Confirmed moves/renames with unambiguous wiki/inline-relative link repair and metadata path migration.
- ✅ Shift+F10/Applications-key tree menu and labelled file-operation dialogs.
- ⏳ Recent-vault picker, encrypted tree actions, reference-style link repair, and crash-atomic multi-file moves.

## Phase 3 — Reader and editor experience

- ✅ Sanitized semantic Markdown rendering and native textarea source editing.
- ✅ Open-note tabs with close controls, unsaved state, Ctrl+W, Ctrl+Tab, and auto-save.
- ✅ Wiki links and relative Markdown links with resolved/missing state; readable JSON link index, outgoing links, and backlinks.
- ✅ Persistent note bookmarks with an accessible list and jump action.
- ✅ Formatting toolbar/menu/palette, bold/italic shortcuts, heading levels 1–3, lists, quote, code, link/table dialogs, and imported attachment insertion.
- ✅ Labelled Markdown annotations with robust anchors, accessible marks, jump/edit/delete.
- ⏳ Heading levels 4–6 formatting tools, heading/position bookmarks, guaranteed fallback undo, PDF/ePub annotations.

## Phase 4 — Search, indexing, and annotations

- ✅ Persistent main-process indexed search and Markdown annotations.
- ✅ Markdown, plain-text, CSV, and extracted HTML search; unsupported files have filename-only records.
- 🚧 Inline/front-matter tag extraction and tag filtering; general YAML metadata editing/suggestions remain planned.
- ⏳ PDF/ePub text extraction and web capture indexing.

## Phase 5 — Tasks, reminders, and project planning

- ✅ Markdown checkbox tasks with optional due dates/priorities, filters, sortable table, and source-file toggles.
- ✅ Task markers and standalone reminders, persisted main-process scheduler, native notification events, snooze/dismiss, startup missed reminders.
- ✅ Accessible reminder table, grouped Overdue/Today/This week agenda, and notebook completion/progress summaries.
- ⏳ Notification delivery while the app is closed, named milestones, and reminder-default settings.
- 🚧 Manual Windows notification and screen-reader verification.

## Phase 6 — Cognitive assets and templates

- ✅ Markdown outlines, JSON mind maps with primary accessible trees/decorative SVG, and Markdown outline export.
- ✅ Q:/A: and :: flashcards, answer reveal, Again/Hard/Good/Easy ratings, persisted SM-2-style schedules.
- ✅ CSV/Markdown-table grids with keyboard cell editing, sorting, and row/column controls.
- ✅ Built-in Daily/Meeting/Project/Reading/Lecture templates, placeholders/cursor, preview, and editable `Templates/` Markdown.
- ✅ Extensible shared asset-type registry; no executable plugin loading.
- ⏳ Rich mind-map layout, background flashcard review notifications, general Markdown-to-outline conversion, crash recovery for unsaved asset edits.

## Phase 7 — Security and local protection

- ✅ Optional vault password gate, configurable idle lock, and unsaved-edit timeout.
- Secure local storage model
- Audit logging for sensitive changes
- ✅ AES-256-GCM encrypted notes selected by the user and encrypted credential storage using a main-process scrypt key.
- ⏳ Per-note passwords, password generator, clipboard auto-clear, audit logging, and whole-vault encryption.
- ✅ Implemented protection limits and unsupported formats documented in `security.md`.

## Phase 8 — Import and document support

- ✅ Attachments are stored in the vault, listed in the tree, and can be revealed or opened externally.
- ✅ Sanitized sandboxed HTML, plain-text/CSV and raster-image previews; saved image descriptions; validated image protocol.
- ✅ Sandboxed PDF preview with best-effort text extraction/page navigation, bounded ePub spine extraction/navigation, and HTTPS web capture with local raster images.
- ⏳ Full pdf.js/epub.js rendering fidelity, advanced PDF/ePub navigation/find/zoom, SVG support, and PDF/ePub annotations.

## Phase 9 — Accessibility validation and release readiness

- Automated DOM and keyboard interaction tests
- Windows UI Automation smoke testing
- Manual screen-reader validation across JAWS, NVDA, and Narrator
- ✅ Packaging, installer, and release process (delivered early, in Phase 1)
- ✅ Persisted autosave, theme/font size, customizable shortcut conflict detection/reset, and active-binding help.
- ⏳ Complete manual JAWS/NVDA/Narrator/forced-colors checks for the new widgets and installed/portable Windows smoke tests.

This increment adds no new runtime dependencies, changes no app version, and publishes no release. Completion marks describe
implemented functionality, not a claim that manual Windows accessibility or the remaining security/import phases are finished.
