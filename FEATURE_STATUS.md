# A11y Notebook — Feature Completion Status

**Last Updated:** 2026-10-07  
**Current Version:** 0.1.0  
**Main Branch Commit:** 222d0610 (PR #25 merged: selective replacement integration for PR #5)

---

## ✅ Completed Features

### Phase 1 — Foundation Shell and Accessibility Model
- ✅ Electron + React + TypeScript scaffold (installs, type checks, lints, tests, builds cleanly)
- ✅ Real focus management: F6/Shift+F6 pane cycling, modal command palette, WAI-ARIA tabs
- ✅ Windows packaging: NSIS installer and portable `.exe` (electron-builder)
- ✅ Secure user-initiated in-app updater (GitHub Releases)
- ✅ CI/CD workflow (type check, lint, test, build) and tag-triggered release workflow
- ✅ Code-signing wiring (WINDOWS_CERTIFICATE secrets)

### Phase 2 — Vault and Notebook Model
- ✅ Local vault folders with notebooks, Markdown/HTML notes, and attachments
- ✅ Human-readable hidden `.a11ynotebook/` metadata directory
- ✅ Filesystem service with path validation and symlink rejection
- ✅ Accessible tree navigation (roving focus, expansion, Home/End, type-ahead, F2 rename, Delete)
- ✅ Global full-text search with snippet context and filtering (notebooks, kind, tags, dates)
- ✅ External-change watching and conflict resolution with autosave pause
- ✅ Confirmed moves/renames with unambiguous link repair and metadata migration
- ✅ Registry-backed global context menu (Shift+F10, Applications key, right-click)
- ✅ Context-menu note encryption when vault protection enabled

### Phase 3 — Reader and Editor Experience
- ✅ Sanitized semantic Markdown rendering and plain-text source editing
- ✅ Tab management: close controls, unsaved state, Ctrl+W, Ctrl+Tab, autosave
- ✅ Wiki and relative Markdown links with link index, outgoing links, backlinks
- ✅ Persistent note bookmarks with accessible list and jump action
- ✅ Formatting toolbar/menu/palette: bold, italic, headings 1–6, lists, quote, code, links, tables
- ✅ Labelled Markdown annotations with robust anchors and accessible marks
- ✅ PDF stable quote/page anchors, persisted notes, accessible note creation
- ✅ PDF zoom/rotation-aware highlights

### Phase 3b — HTML Notes and Rich Text
- ✅ Create and edit `.html` notes in plain source or keyboard-accessible rich-text mode
- ✅ Semantic rich-text toolbar (headings, emphasis, lists, code, links, tables, local images with alt text)
- ✅ HTML sanitization on load, render, save, and rich paste
- ✅ Search and index HTML notes; link graph includes relative/wiki references
- ✅ Markdown/HTML note conversion with explicit format-loss warnings (source preserved)
- ✅ HTML checklists with stable `data-a11y-task-id`, completion, due-date, priority, and reminder attributes
- ✅ Built-in and vault HTML/Markdown templates with placeholders, cursor placement, and preview
- ✅ Markdown/HTML export through native save dialog (sanitized standalone HTML with embedded images)
- ✅ Web capture offers Markdown or HTML format; main-process sanitization preserves semantic structure
- ✅ HTML and Markdown note annotations with shared quote/context anchor storage

### Phase 4 — Search, Indexing, and Annotations
- ✅ Persistent main-process indexed search and Markdown/HTML annotations
- ✅ Markdown, HTML, plain-text, CSV, PDF, and ePub text search with bounded extraction
- ✅ PDF.js rendering with accessible text, page navigation, and in-document search
- ✅ epub.js rendering with paginated content, nested navigation TOC, section text, and in-document search
- 🚧 **Inline/front-matter tag extraction and filtering** — extracted; general YAML editing remains open

### Phase 5 — Tasks, Reminders, and Project Planning
- ✅ Markdown and semantic HTML checkbox tasks with optional due dates/priorities
- ✅ Task filters, sortable table, and safe source-file toggles
- ✅ Task markers and standalone reminders with persisted main-process scheduler
- ✅ Native notification events, snooze/dismiss, and startup missed-reminder recovery
- ✅ Accessible reminder table with grouped Overdue/Today/This week agenda
- ✅ Notebook completion and progress summaries
- ✅ Persisted, validated reminder defaults and creation-dialog preferences
- ✅ Named milestone service with stable task associations, move preservation, and live progress
- ✅ Unified reminder and opt-in flashcard scheduler with persistent deduplication
- ✅ Vault switch and lock cancellation for scheduled tasks
- ⏳ **Exited-process notification delivery** — open; design needed for opt-in Windows integration
- ⏳ **Milestone planning UI** — open; service infrastructure complete

### Phase 6 — Cognitive Assets and Templates
- ✅ Markdown outlines with semantic heading preservation
- ✅ JSON mind maps with primary accessible trees and decorative SVG
- ✅ Markdown outline export
- ✅ Q:/A: and :: flashcards with answer reveal and AGAIN/HARD/GOOD/EASY ratings
- ✅ Persisted SM-2-style flashcard schedules
- ✅ CSV/Markdown-table grids with keyboard cell editing, sorting, and row/column controls
- ✅ Built-in Daily/Meeting/Project/Reading/Lecture templates
- ✅ Placeholders, cursor placement, and preview in template selection
- ✅ Editable `Templates/` folder for user custom Markdown/HTML templates
- ✅ Extensible shared asset-type registry (no executable plugin loading)
- ⏳ **Rich mind-map visual layouts** — open; semantic tree is authoritative
- ⏳ **Background flashcard review notifications** — open
- ⏳ **General Markdown-to-outline conversion** — open; heading hierarchy/content preservation design needed
- ⏳ **Crash recovery for unsaved asset edits** — open; depends on encrypted metadata policy

### Phase 7 — Security and Local Protection
- ✅ Optional vault password gate with configurable idle-lock timeout
- ✅ Unsaved-edit timeout protection with timed-out notes cleared after successful saves
- ✅ Opt-in versioned vault recovery with separate random recovery key
- ✅ Authenticated password wrapper and credential-preserving atomic migration
- ✅ Password reset, rotation, and revocation via recovery
- ✅ AES-256-GCM encrypted credential storage (main-process vault key)
- ✅ User-selected AES-256-GCM encrypted individual notes with scrypt-derived passwords
- ✅ Cryptographic password generation and conditional 30-second clipboard clearing
- ✅ Implemented protection limits and unsupported formats documented in `security.md`
- ✅ Vault switch/lock detection and race-condition guarding for security operations
- ✅ Recovery migration commit race-condition protection against concurrent locks
- ⏳ **Sensitive-action audit logging** — open; bounded format with retention policy needed
- ⏳ **Encrypted indexes and metadata** — open; depends on stable key handling and per-store domain separation
- ⏳ **Whole-vault encryption** — open; separate opt-in mode with streaming/container format design needed

### Phase 8 — Import and Document Support
- ✅ Attachments stored in vault, listed in tree, reveal/external open available
- ✅ Sanitized sandboxed HTML, plain-text/CSV, and raster-image previews
- ✅ Saved image descriptions and validated image protocol
- ✅ Local pdf.js page rendering and text extraction
- ✅ PDF page navigation and in-document search
- ✅ PDF reading with bounded-scale canvas, selectable text layer, zoom/rotation
- ✅ Semantic tagged-PDF DOM with conservative inferred text for untagged pages
- ✅ PDF stable persisted anchors and accessible note creation/highlights
- ✅ PDF Reading Settings with independent AT preferences (running headers/footers, printed page numbers)
- ✅ PDF Reading Settings applied live without removing visible/selectable/searchable text
- ✅ epub.js paginated book content rendering with nested navigation-document TOC
- ✅ ePub chapter sanitization and section text navigation/search
- ✅ Bounded ePub text extraction for search indexing
- 🚧 **ePub annotations** — open; lifecycle validation and manual accessibility checks remain
- ⏳ **PDF sidebar/export/lifecycle workflows** — open; annotation sidebar, bidirectional navigation, clipboard export
- ⏳ **ePub reading-progress persistence** — open
- ⏳ **DOCX support** — open; requires semantic structure extraction and hostile-archive validation
- ⏳ **Legacy `.doc` support** — unsupported; pending vetted local parser/converter strategy

### Phase 9 — Accessibility Validation and Release Readiness
- ✅ Automated DOM and keyboard interaction tests
- ✅ Windows UI Automation smoke-test script (`npm run test:ui-smoke` after `npm run package:win`)
- ✅ Packaging, installer, and release process
- ✅ Persisted autosave, theme/font-size, and conflict-checked keyboard-shortcut settings
- ✅ Customizable shortcut conflict detection and reset
- ✅ Active-binding help in modal
- ⛔ **Running UI Automation smoke tests** — blocked; requires Windows desktop runner
- ⛔ **Manual JAWS, NVDA, and Narrator validation** — blocked; requires Windows and licensed AT tooling
- ⛔ **Forced-colors and high-contrast testing** — blocked; requires Windows manual testing
- ⛔ **Manual JAWS/NVDA/Narrator/forced-colors checks on installed/portable builds** — blocked

---

## ⏳ Open Features (Not Yet Implemented)

### Remaining Phase 2 Work
- Recent-vault picker UI (only automatic last-vault restoration currently exists)
- Reference-style Markdown link repair
- Crash-atomic multi-file moves

### Remaining Phase 3 Work
- Heading/position bookmarks
- Guaranteed fallback undo

### Remaining Phase 4 Work
- General YAML metadata editing and suggestions

### Remaining Phase 5 Work
- **Exited-process reminders/reviews** — requires opt-in Windows integration (Task Scheduler or equivalent)
  - Explicit consent, uninstall/disable cleanup, no shell injection/secrets/plaintext
  - Duplicate/restart/race prevention and privacy/lock behavior design
- **Milestone planning UI** — service infrastructure exists; UI layer needed
- **Due flashcard notifications** — requires out-of-process delivery infrastructure

### Remaining Phase 6 Work
- **Crash recovery for unsaved edits** — requires encrypted metadata/draft policy
- **Markdown-to-outline conversion** — requires heading hierarchy preservation and content-loss preview
- **Mind-map visual layouts** — semantic tree is authoritative; visual enhancements remain
- **Due flashcard background notifications** — depends on Phase 5 out-of-process delivery

### Shared Accessible Reader (Cross-document)
- Common reader capability contract for outline/TOC, sequential navigation, headings/links/tables, search, bookmarks
- Original-quote export with confidence/orphan status reporting
- Reading position persistence (especially for ePub)
- Markdown and sanitized HTML annotation parity verification
- ePub hostile-archive and remote-resource validation
- DOCX support: semantic structure extraction without external resource loading
- Legacy `.doc` support: pending safe local parser/converter strategy
- PDF annotation sidebar and bidirectional navigation (Phase 5 work)
- PDF clipboard export with original quotes (Phase 6 work)

### Security and Storage
- **Audit logging** — requires bounded format, retention policy, and explicit error handling
- **Encrypted indexes/metadata** — requires per-store domain separation, versioning, and backward-compatible migration
- **Whole-vault encryption** — requires threat model specification, streaming/container format, and crash/rollback testing

### Other Requested Features
- Tag and metadata suggestions with calendar-like organization
- Exited-process reminder delivery verification on Windows
- Whole-vault encryption and encrypted metadata

---

## ⛔ Externally Blocked (Manual/Windows Infrastructure)

- **Code signing for production** — requires owner-provisioned Windows code-signing certificate
- **Windows installer and portable `.exe` testing** — requires Windows manual testing
- **JAWS, NVDA, Narrator validation** — requires Windows and licensed screen-reader software
- **Windows UI Automation execution** — requires Windows desktop runner or manual testing
- **Native notification delivery verification** — requires Windows testing
- **Forced-colors and high-contrast validation** — requires Windows manual testing

---

## Summary

**Production Ready Features:** Phases 1–4, 6, most of Phase 5, partial Phase 7, partial Phase 8, partial Phase 9  
**Testable on Windows:** Core app, installer, updater, UI Automation smoke tests, portable `.exe`  
**Manual AT Validation Needed:** All new security workflows, recovery flows, PDF/ePub navigation, milestone planning  
**Design & Implementation Open:** Exited-process delivery, audit logging, encrypted metadata, whole-vault encryption, shared reader contract, DOCX/`.doc` support

---

## Recent PR #5 Integration (2026-10-07)

**PR #25** (merged) completed the remaining checklist items from PR #5:
- ✅ PDF/ePub support fully implemented via pdf.js and epub.js (PR #23)
- ✅ Typecheck, lint, tests (537 passed), build, and format check all passing
- ✅ CodeQL security scan: 0 alerts
- ✅ Secret scan: clean
- ✅ Vault security race-condition guards implemented and tested
- ✅ Credential serialization and key disposal on lock
- ✅ Recovery migration race protection
- ✅ Capture filename visibility and IP classification

PR #5 remains open for reference but will not be merged due to stale base-branch conflicts. All intended functionality is live on `main`.
