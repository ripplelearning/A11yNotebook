# A11y Notebook — Implementation Status

**Last Updated:** 2026-10-10  
**Current Version:** 0.1.0  
**Starting main:** ea347f3 (includes PR #26 audit logging, PR #27 DOCX and PR #28 investigation)

Status marks below mean **implemented**, **partial**, **open**, or **externally blocked**. They do not mean
production-ready or manually verified. Automated DOM/mocked OS tests do not establish Windows toast delivery,
installer behavior, screen-reader speech, or secure erasure.

## Requested six-feature increment

| Feature                               | Evidence-based status                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sensitive-action audit logging        | Scoped main-process implementation and automated tests: allowlisted operation/outcome/time, bounded versioned log, atomic staging, redaction and explicit independent storage failures. Not a tamper-proof/comprehensive forensic history; see `docs/security.md` for exclusions.                                              |
| Opt-in encrypted metadata/indexes     | **Scoped implementation:** Markdown/HTML/PDF annotations and cognitive checkpoints only, stable unlocked v3 config, explicit exclusion consent, authenticated per-store containers/pointers and resumable cleanup. Other metadata/indexes remain plaintext/open; not whole-vault encryption.                                   |
| Cognitive unsaved-edit crash recovery | **Scoped implementation:** bounded encrypted debounced checkpoints, baseline conflict detection and explicit unsaved Restore/Discard/Compare. Malformed structured drafts are compare/copy-only (partial); no plaintext fallback. Debounce-window loss and manual Windows AT checks remain.                                    |
| Milestone planning UI                 | Accessible planning UI on existing service/typed IPC; automated UI tests. Manual Windows AT checks remain unrun.                                                                                                                                                                                                               |
| DOCX accessible local reading         | **Implemented on main (PR #27).** Bounded local ZIP/XML parser, semantic reader, navigation/search and hostile fixtures. DOCX annotations remain open; legacy `.doc` remains unsupported.                                                                                                                                      |
| Exited-process Windows reminders      | **Not implemented.** No Task Scheduler/helper registration, consent/status API or cleanup. In-process scheduling is not delivery after exit; Windows verification remains unrun.                                                                                                                                               |
| Custom in-app reminder alerts         | **Partial on existing scheduler:** persisted alert/sound settings, bundled sound, focused dialog/unfocused queue, complete/dismiss/snooze actions and hidden-title privacy. Locking stops delivery; generic locked alert/sound remains open. Windows minimized audio/focus and AT need manual validation. Alerts stop on exit. |

The exact unfinished acceptance criteria and Windows matrix are in `docs/continuation-plan.md`. Designs are not
implementation, and mocks are not actual Windows verification.

---

## Implemented functionality (not a production-readiness claim)

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
- ✅ Settings-controlled in-app reminder alert queue and bundled sound; independent native notification preference
- ⏳ **Exited-process notification delivery** — open; design needed for opt-in Windows integration
- ✅ **Milestone planning UI** — existing-service list/detail/create/edit/delete and associations; manual AT verification open

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
- ✅ **Encrypted cognitive checkpoints** — opted-in bounded drafts and explicit unsaved restore/discard/compare; manual Windows AT validation remains

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
- ✅ **Scoped sensitive-action audit logging** — bounded schema/retention, redaction, interruption/error tests; OS-user tampering and coverage limits apply
- ✅ **Scoped encrypted annotations/checkpoints** — stable v3 keys, per-store authenticated envelopes and pointer migration
- ⏳ **Excluded indexes and metadata** — search, links, bookmarks, reminders, settings and other documented exclusions remain plaintext/open
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
- ✅ **DOCX local reading** — bounded semantic parser, reader/navigation/search and hostile-archive tests; annotations and manual AT validation remain open
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
- **Milestone Windows accessibility validation** — UI implemented; real AT speech/focus checks remain
- **Due flashcard notifications** — requires out-of-process delivery infrastructure

### Remaining Phase 6 Work

- **Cognitive recovery manual validation** — JAWS/NVDA/Narrator, keyboard focus and speech on Windows remain unrun
- **Markdown-to-outline conversion** — requires heading hierarchy preservation and content-loss preview
- **Mind-map visual layouts** — semantic tree is authoritative; visual enhancements remain
- **Due flashcard background notifications** — depends on Phase 5 out-of-process delivery

### Shared Accessible Reader (Cross-document)

- Common reader capability contract for outline/TOC, sequential navigation, headings/links/tables, search, bookmarks
- Original-quote export with confidence/orphan status reporting
- Reading position persistence (especially for ePub)
- Markdown and sanitized HTML annotation parity verification
- ePub hostile-archive and remote-resource validation
- DOCX annotations and manual Windows assistive-technology validation
- Legacy `.doc` support: pending safe local parser/converter strategy
- PDF annotation sidebar and bidirectional navigation (Phase 5 work)
- PDF clipboard export with original quotes (Phase 6 work)

### Security and Storage

- **Audit history follow-ups** — native warning Windows AT validation, viewer/repair UI and broader automatic event coverage remain; scoped logging implemented
- **Excluded indexes/metadata** — broader migration of direct writers/caches remains open beyond scoped annotation/checkpoint protection
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

**Production readiness:** Not established. Implemented functionality still has explicit security/storage limitations and unrun Windows accessibility/packaging gates.  
**Testable on Windows:** Core app, installer, updater, UI Automation smoke tests, portable `.exe`  
**Manual AT Validation Needed:** All new security workflows, recovery flows, PDF/ePub navigation, milestone planning  
**Design & Implementation Open:** Exited-process delivery, excluded indexes/metadata, whole-vault encryption, shared reader contract, DOCX annotations; legacy `.doc` unsupported. Windows sound/focus and new recovery/alert AT workflows require manual validation.

---

## Provenance and validation

This branch starts from main commit ea347f3 and preserves merged audit, DOCX, milestone and PDF/ePub work.
The investigation commit 4ee9e4eb contains documentation only: cognitive-recovery channels and `asset-drafts.ts`
were not present on live main before this implementation. Historical PR #5 closure/checklist changes are not
assumed or performed here. PDF/ePub implementation
does not imply every format, lifecycle, hostile-input or accessibility requirement is complete.

Validation results for this increment are reported on the implementation PR. Earlier reported test counts or scans
are not evidence for new changes. No version bump, release, signing setup or repository-protection change is included.

Current local validation: `npm run typecheck`, `npm run lint`, `npm test` (**671 tests, 65 files**) and
`npm run build` passed. After review fixes, the final full suite passed **677 tests across 65 files**;
typecheck, lint and build passed again. The build reports Vite chunk-size warnings. `npm run format:check` failed on five unchanged
files: `electron/vault/docx-parser.ts`, `electron/vault/search.ts`,
`src/renderer/features/previews/DocxReader.tsx`, `src/test/docx-parser.test.ts` and `src/test/docx-reader.test.tsx`.
Changed-file formatting passed. Secret scanning found no secrets. CI initially required approval and ran no jobs;
it is not reported as passed. Real Windows sound/focus and JAWS/NVDA/Narrator checks were not run.
CodeQL found zero JavaScript alerts. The automated code-review service failed with a model-registry error;
a separate read-only reviewer identified two reminder issues that were fixed and confirmed in follow-up review.
