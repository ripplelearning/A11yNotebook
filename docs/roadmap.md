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
- ✅ PDF stable quote/page anchors, persisted notes, accessible note creation, and zoom/rotation-aware highlights (reader PHASE 3–4).
- ⏳ PDF sidebar/export/lifecycle workflows (reader PHASE 5–7) and ePub annotations.

## HTML notes and rich text

- ✅ Create and edit `.html` notes in plain source or a keyboard-accessible rich-text mode.
- ✅ Semantic rich-text toolbar for headings, emphasis, lists, quote, code, links, tables, and local images with required alt text.
- ✅ Sanitize HTML on load, render, save, and rich paste; external image loads and active content are removed.
- ✅ Search/index HTML notes and index local relative/wiki references in the link graph.
- ✅ Convert Markdown/HTML note content into a sibling copy after an explicit format-loss warning; the source remains unchanged.
- 🚧 Conversion warnings flag common CSS/active-content/table/image loss, but do not provide a complete itemized loss report or in-place path/metadata migration.
- ✅ HTML checklists use stable task IDs in `data-a11y-task-id`, `data-a11y-task-complete`, optional `data-a11y-task-due`, `data-a11y-task-priority`, and `data-a11y-task-remind` attributes. Rich text can insert a task item; source editing can edit its metadata. Task indexing, filters, due/priority sorting, targeted toggles, reminders, and progress summaries include HTML.
- ✅ Built-in and vault HTML/Markdown templates can create either note format; placeholder escaping/sanitization, correct extension, preview, and cursor placement are supported. Markdown remains the default.
- ✅ Markdown/HTML notes export through an accessible action and native save dialog to Markdown or sanitized standalone HTML. Export does not modify the source, protects the original from being selected as output, confirms overwrites, requires consent for decrypted protected notes, embeds local raster images in HTML, and warns that relative links/other metadata are not packaged.
- ✅ Web capture offers Markdown or HTML. Main-process sanitization preserves semantic headings, lists, tables and safe links, localizes supported raster images with alt descriptions, records canonical source attribution, opens/indexes the note, and announces partial image failures.
- ✅ HTML note text annotations use the same labelled quote/context anchor storage and jump/edit/delete UI as Markdown. PDF uses an independent target contract; ePub annotation UI remains open.

## Phase 4 — Search, indexing, and annotations

- ✅ Persistent main-process indexed search and Markdown/HTML note annotations.
- ✅ Markdown, HTML, plain-text, CSV, PDF, and ePub text search with bounded extraction; unsupported files have filename-only records.
- 🚧 Inline/front-matter tag extraction and tag filtering; general YAML metadata editing/suggestions remain planned.
- ✅ PDF.js PDF rendering with accessible text and page navigation/search; epub.js ePub spine text with section navigation/search. Captures in either supported note format are indexed with other notes.

## Phase 5 — Tasks, reminders, and project planning

- ✅ Markdown and semantic HTML checkbox tasks with optional due dates/priorities, filters, sortable table, and safe source-file toggles.
- ✅ Task markers and standalone reminders, persisted main-process scheduler, native notification events, snooze/dismiss, startup missed reminders.
- ✅ Accessible reminder table, grouped Overdue/Today/This week agenda, and notebook completion/progress summaries.
- ✅ Persisted, validated reminder defaults and creation-dialog preferences without rewriting existing reminders.
- ✅ Named milestone service/typed IPC with stable task associations, move preservation, and live progress.
- ✅ Unified reminder/opt-in flashcard scheduler with persistent deduplication and vault switch/lock cancellation.
- ⏳ Exited-process notification delivery and milestone planning UI.
- ⛔ Manual Windows notification and screen-reader verification.

## Phase 6 — Cognitive assets and templates

- ✅ Markdown outlines, JSON mind maps with primary accessible trees/decorative SVG, and Markdown outline export.
- ✅ Q:/A: and :: flashcards, answer reveal, Again/Hard/Good/Easy ratings, persisted SM-2-style schedules.
- ✅ CSV/Markdown-table grids with keyboard cell editing, sorting, and row/column controls.
- ✅ Built-in Daily/Meeting/Project/Reading/Lecture templates, placeholders/cursor, preview, and editable `Templates/` Markdown/HTML.
- ✅ Extensible shared asset-type registry; no executable plugin loading.
- ⏳ Rich mind-map layout, background flashcard review notifications, general Markdown-to-outline conversion, crash recovery for unsaved asset edits.

## Phase 7 — Security and local protection 🚧

- ✅ Optional vault password gate, configurable idle lock, and unsaved-edit timeout.
- ✅ Opt-in versioned vault recovery with a separate random recovery key, authenticated password wrapper, credential-preserving atomic migration, password reset, rotation and revocation
- ⏳ Sensitive-action audit logging with bounded retention and explicit storage-failure handling
- ✅ AES-256-GCM encrypted credential storage using the main-process vault key.
- ✅ User-selected AES-256-GCM encrypted notes with separate scrypt-derived passwords.
- ✅ Cryptographic password generation and conditional 30-second clipboard clearing for passwords generated in the note-encryption dialog.
- ⏳ Encrypted indexes/metadata and whole-vault encryption.
- ✅ Implemented protection limits and unsupported formats documented in `security.md`.

## Phase 8 — Import and document support

- ✅ Attachments are stored in the vault, listed in the tree, and can be revealed or opened externally.
- ✅ Sanitized sandboxed HTML, plain-text/CSV and raster-image previews; saved image descriptions; validated image protocol.
- ✅ Local pdf.js page rendering and text extraction, page navigation, and in-document search; epub.js archive/spine parsing, accessible section text, section navigation, and in-document search.
- ✅ PDF reading draws a bounded-scale canvas with a selectable text layer, zoom/rotation, semantic tagged-PDF DOM, conservative inferred text for untagged pages, stable persisted anchors, and accessible note creation/highlights.
- ✅ PDF Reading Settings persist independent, default-exposed AT preferences for running headers/footers and printed page numbers. Changes apply live without removing visible/selectable/searchable text; see `pdf-semantic-phase1.md` for detection limits. Remaining PDF sidebar/export/lifecycle work is listed below.
- 🚧 ePub reading extracts flattened text from spine sections. It does not render the book's styles/resources or expose its navigation document as a TOC; ePub annotations are not available.

### Document reader and annotation follow-up plan

These are open implementation/design tasks, not externally blocked work:

1. ✅ Add a bounded selectable PDF.js text layer, zoom/rotation transforms, canonical page text offsets, marked-content mappings, persisted quote/context anchors, accessible note creation, and selection highlights.
2. Add a safe ePub rendition with accessible reflow, navigation-document TOC entries, and archive-relative image/font/style resource resolution. Keep scripts disabled, reject unsafe archive paths/resources, and revoke/release renderer resources on book changes.
3. ✅ Version and validate PDF page/quote targets in metadata v2 without changing Markdown/HTML records. Add selection/quote/semantic creation with confidence and orphan/unverified reporting. ePub spine/CFI anchors remain open.
4. Test anchors and renderer lifecycle with PDF/ePub fixtures, unsafe archives, changed documents, and keyboard-only interaction. Manual Windows JAWS/NVDA/Narrator and UI Automation checks remain a separate validation step; passing them does not replace the missing implementation.
5. PDF PHASE 5: annotation sidebar and bidirectional navigation. PHASE 6: clipboard export with original quotes. PHASE 7: lifecycle, cleanup, performance, and broader security validation. Continuous-page cross-page pointer selection remains follow-up; grouped per-page targets are supported by the contract.

## Phase 9 — Accessibility validation and release readiness

- Automated DOM and keyboard interaction tests
- ✅ Windows UI Automation smoke-test script: `npm run test:ui-smoke` after `npm run package:win`.
- ⛔ Running UI Automation smoke tests requires a Windows desktop runner.
- Manual screen-reader validation across JAWS, NVDA, and Narrator
- ✅ Packaging, installer, and release process (delivered early, in Phase 1)
- ✅ Persisted autosave, theme/font size, customizable shortcut conflict detection/reset, and active-binding help.
- ⛔ Complete manual JAWS/NVDA/Narrator/forced-colors checks and installed/portable Windows smoke tests.

This increment uses `pdfjs-dist` and `epubjs` for the accessible document reader and overrides ePub's
XML parser to patched `@xmldom/xmldom` 0.8.15. It changes no app version and publishes no release. Completion marks describe implemented functionality; blocked manual checks and unfinished integrations are explicitly called out above. This development work does not change the app version or publish a release.

## Other requested roadmap items

- ⏳ Tag and metadata suggestions, general YAML editing, and calendar-like organization are not implemented.
- 🚧 Notebook task-completion summaries and milestone service/progress exist; milestone planning UI remains open.
- 🚧 The shared asset registry is extensible by adding trusted application code; user-loaded executable plugins are not supported.
- ⏳ Heading/position bookmarks, missing-link repair prompts, and reference-style link repair are not implemented.
- ⏳ Recent-vault selection is not available; the app restores the last opened vault automatically.
- ⛔ Windows signing, UI Automation execution, native notification delivery verification, and real JAWS/NVDA/Narrator speech checks need owner-provisioned credentials or Windows/manual test infrastructure.

## Dependency-ordered continuation

`docs/continuation-plan.md` distinguishes this increment's shipped recovery foundation from open or externally blocked
work. It includes acceptance criteria for security follow-ups, Phase 5/6, and common accessible reading/navigation/
annotation across Markdown, sanitized HTML, ePub, DOCX, and (if no safe local parser is feasible) legacy DOC. It also
includes the required Windows assistive-technology and UI Automation validation matrix. None of those remaining
features are complete merely because this continuation plan exists.
