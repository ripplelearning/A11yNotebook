# Product roadmap

Status key: ✅ complete · 🚧 partial/in progress · ⏳ open · ⛔ blocked on external or manual work

## Phase 1 — Foundation shell and accessibility model ✅

- ✅ Scaffold stabilized: installs, type checks, lints, tests, and builds cleanly. The main and preload code compiles to CommonJS, and the renderer is bundled by Vite.
- ✅ Real focus management: F6/Shift+F6 pane cycling, focus commands, a modal command palette, and WAI-ARIA tabs
- ✅ Windows packaging: NSIS installer and portable `.exe` built with electron-builder (`npm run package:win`)
- ✅ Secure, user-initiated in-app updater through Help → Check for Updates, backed by GitHub Releases
- ✅ CI workflow (type check, lint, test, build) and a tag-triggered Windows release workflow
- ✅ Code-signing wiring reads `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` secrets.
- ⛔ Signed production release (requires the repository owner to provision a valid Windows certificate).
- ⛔ Manual JAWS, NVDA, and Narrator checks (requires Windows and licensed/accessibility tooling).

- Electron + React + TypeScript shell
- Accessible menu, header, navigation, content area, tabs, info pane, and status bar
- Global command registry and command palette
- Focus-region cycling with F6 and Shift+F6
- Read-only/edit mode toggles and live state announcements
- JSON persistence boundary and sample vault data
- Automated tests for registry behavior and renderer accessibility primitives

## Phase 2 — Vault and notebook model

- ✅ A vault is a local folder; notebook folders, Markdown/HTML notes, and attachments are read directly from disk.
- ✅ Human-readable hidden `.a11ynotebook/` metadata directory; Markdown and HTML notes remain ordinary files.
- ✅ Native folder picker, recent-vault restoration, create notebook/note, rename, import, reveal, external open, and recycle-bin delete.
- ✅ Main-process filesystem service validates relative paths and rejects symlinks; renderer receives only typed IPC operations.
- ✅ Accessible tree with roving focus, expansion, arrows, Home/End, Enter, F2, Delete, type-ahead, and `*`.
- ✅ Global search across Markdown and HTML note names/bodies and supported text attachment types.
- ✅ Persistent search cache, notebook/kind/tag/modified-date filters and context snippets.
- ✅ External-change watching, clean-note reload, and dirty-note conflict choices with autosave paused.
- ✅ Confirmed moves/renames with unambiguous wiki/inline-relative link repair and metadata path migration.
- ✅ Registry-backed global context menu: Shift+F10, Applications key, and right-click; tree/tab/editor/link/task/search/annotation/reminder/attachment contexts.
- ✅ Context-menu note encryption action when vault protection is enabled.
- ⏳ Recent-vault picker (only automatic last-vault restoration currently exists), reference-style link repair, and crash-atomic multi-file moves.

## Phase 3 — Reader and editor experience

- ✅ Sanitized semantic Markdown rendering and native textarea source editing.
- ✅ Open-note tabs with close controls, unsaved state, Ctrl+W, Ctrl+Tab, and auto-save.
- ✅ Wiki links and relative Markdown links with resolved/missing state; readable JSON link index, outgoing links, and backlinks.
- ✅ Persistent note bookmarks with an accessible list and jump action.
- ✅ Formatting toolbar/menu/palette, bold/italic shortcuts, heading levels 1–6, lists, quote, code, link/table dialogs, and imported attachment insertion.
- ✅ Labelled Markdown annotations with robust anchors, accessible marks, jump/edit/delete.
- ✅ Heading levels 4–6 formatting tools.
- ⏳ Heading/position bookmarks and guaranteed fallback undo.
- ⏳ PDF/ePub annotations are not implemented; the accessible text reader is available.

## HTML notes and rich text

- ✅ Create and edit `.html` notes in plain source or a keyboard-accessible rich-text mode.
- ✅ Semantic rich-text toolbar for headings, emphasis, lists, quote, code, links, tables, and local images with required alt text.
- ✅ Sanitize HTML on load, render, save, and rich paste; external image loads and active content are removed.
- ✅ Search/index HTML notes and index local relative/wiki references in the link graph.
- ✅ Convert Markdown/HTML note content into a sibling copy after an explicit format-loss warning; the source remains unchanged.
- 🚧 Conversion warnings flag common CSS/active-content/table/image loss, but do not provide a complete itemized loss report or in-place path/metadata migration.
- ⏳ HTML task checklists, templates, annotations end-to-end, web capture as HTML, and export integration.

## Phase 4 — Search, indexing, and annotations

- ✅ Persistent main-process indexed search and Markdown annotations.
- ✅ Markdown, HTML, plain-text, CSV, PDF, and ePub text search with bounded extraction; unsupported files have filename-only records.
- 🚧 Inline/front-matter tag extraction and tag filtering; general YAML metadata editing/suggestions remain planned.
- ✅ PDF.js PDF rendering with accessible text and page navigation/search; epub.js ePub spine text with section navigation/search. Captured pages saved as Markdown are indexed with other notes.

## Phase 5 — Tasks, reminders, and project planning

- ✅ Markdown checkbox tasks with optional due dates/priorities, filters, sortable table, and source-file toggles.
- ✅ Task markers and standalone reminders, persisted main-process scheduler, native notification events, snooze/dismiss, startup missed reminders.
- ✅ Accessible reminder table, grouped Overdue/Today/This week agenda, and notebook completion/progress summaries.
- ⏳ Notification delivery while the app is closed, named milestones, and reminder-default settings.
- ⛔ Manual Windows notification and screen-reader verification.

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
- ✅ AES-256-GCM encrypted credential storage using the main-process vault key.
- ✅ User-selected AES-256-GCM encrypted notes with separate scrypt-derived passwords.
- ✅ Cryptographic password generation and conditional 30-second clipboard clearing for passwords generated in the note-encryption dialog.
- ⏳ Vault recovery key, audit logging, encrypted indexes/metadata, and whole-vault encryption.
- ✅ Implemented protection limits and unsupported formats documented in `security.md`.

## Phase 8 — Import and document support

- ✅ Attachments are stored in the vault, listed in the tree, and can be revealed or opened externally.
- ✅ Sanitized sandboxed HTML, plain-text/CSV and raster-image previews; saved image descriptions; validated image protocol.
- ✅ Local pdf.js page rendering and text extraction, page navigation, and in-document search; epub.js archive/spine parsing, accessible section text, section navigation, and in-document search.
- 🚧 ePub reading is a text-first accessible view, not full visual reflow. Advanced PDF selection/zoom, EPUB visual styling/TOC navigation, and PDF/ePub annotations remain open.

## Phase 9 — Accessibility validation and release readiness

- Automated DOM and keyboard interaction tests
- ✅ Windows UI Automation smoke-test script: `npm run test:ui-smoke` after `npm run package:win`.
- ⛔ Running UI Automation smoke tests requires a Windows desktop runner.
- Manual screen-reader validation across JAWS, NVDA, and Narrator
- ✅ Packaging, installer, and release process (delivered early, in Phase 1)
- ✅ Persisted autosave, theme/font size, customizable shortcut conflict detection/reset, and active-binding help.
- ⛔ Complete manual JAWS/NVDA/Narrator/forced-colors checks and installed/portable Windows smoke tests.

This increment uses `pdfjs-dist` and `epubjs` for the accessible document reader and overrides ePub's
XML parser to patched `@xmldom/xmldom` 0.8.15. It changes no app version and publishes no release. Completion marks
describe implemented functionality; blocked manual checks and unfinished integrations are explicitly called out above.

## Other requested roadmap items

- ⏳ Tag and metadata suggestions, general YAML editing, and calendar-like organization are not implemented.
- 🚧 Notebook task-completion summaries exist; named milestone planning and milestone summaries do not.
- 🚧 The shared asset registry is extensible by adding trusted application code; user-loaded executable plugins are not supported.
- ⏳ Heading/position bookmarks, missing-link repair prompts, and reference-style link repair are not implemented.
- ⏳ Recent-vault selection is not available; the app restores the last opened vault automatically.
- ⛔ Windows signing, UI Automation execution, native notification delivery verification, and real JAWS/NVDA/Narrator speech checks need owner-provisioned credentials or Windows/manual test infrastructure.
