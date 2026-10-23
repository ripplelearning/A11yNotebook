# A11y Notebook — Implementation Status

**Last Updated:** 2026-10-22  
**Current Version:** 1.2.0
**Scope:** releases through v1.1.5 plus the October 22, 2026 feature batch (PRs #62–#67)

Status marks below mean **implemented**, **partial**, **open**, or **externally blocked**. They do not mean
production-ready or manually verified. Automated DOM/mocked OS tests do not establish Windows toast delivery,
installer behavior, screen-reader speech, or secure erasure.

## Requested six-feature increment

| Feature                               | Evidence-based status                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sensitive-action audit logging        | Scoped main-process implementation and automated tests: allowlisted operation/outcome/time, bounded versioned log, atomic staging, redaction and explicit independent storage failures. Not a tamper-proof/comprehensive forensic history; see `docs/security.md` for exclusions.                                                                                                                                                   |
| Opt-in encrypted metadata/indexes     | **Implemented (base PR #45-era; broadened PRs #83–#89):** annotations and cognitive checkpoints by default, plus per-store opt-in migration for reminder defaults, milestones, bookmarks, the link index, image descriptions, flashcard schedules, reminders, library settings, and the persisted search-index cache — stable unlocked v3 config, explicit per-store consent, authenticated per-store containers/pointers and resumable cleanup. Remaining plaintext exclusions are documented in `docs/security.md` (audit log, global preferences, the times-only due snapshot); not whole-library encryption.                                                                                                                                      |
| Cognitive unsaved-edit crash recovery | **Scoped implementation:** bounded encrypted debounced checkpoints, baseline conflict detection and explicit unsaved Restore/Discard/Compare. Malformed structured drafts are compare/copy-only (partial); no plaintext fallback. Debounce-window loss and manual Windows AT checks remain.                                                                                                                                         |
| Milestone planning UI                 | Accessible planning UI on existing service/typed IPC; automated UI tests. Manual Windows AT checks remain unrun.                                                                                                                                                                                                                                                                                                                    |
| DOCX accessible local reading         | **Implemented on main (PR #27).** Bounded local ZIP/XML parser, semantic reader, navigation/search and hostile fixtures. DOCX annotations were added in PRs #76–#77 and ePub annotations in PRs #78–#79, both with the shared reader capability contract (PR #75). Legacy `.doc` text extraction was added in PR #62 via a bounded local spec-based parser (text only, no formatting).                                                                                                                                                          |
| Exited-process Windows reminders      | **Implemented (PR #93), Windows delivery unverified.** Opt-in setting registers a single Windows Task Scheduler task (argument-array schtasks calls, escaped content-free XML) that wakes the app at the next due time from the persisted ids-and-times snapshot; the wake shows a generic alert, drops fired entries, and re-registers. Turning the setting off deletes the task. schtasks delivery has not yet been run on a real Windows machine.                                                                                                                                                                                                                                                    |
| Custom in-app reminder alerts         | **Implemented including the locked case (PR #66):** persisted alert/sound settings, bundled sound, focused dialog/unfocused queue, complete/dismiss/snooze actions and hidden-title privacy. While locked, a privacy-safe snapshot of due times (ids only) drives a generic "A reminder is due. Unlock the library to view it." alert with sound. Windows minimized audio/focus and AT need manual validation. Alerts stop on exit. |

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

### Phase 2 — Library and Notebook Model

- ✅ Local library folders with notebooks, Markdown/HTML notes, and attachments
- ✅ Recent-library picker: up to ten recent libraries with a guarded open action on the Libraries screen (PR #64)
- ✅ Human-readable hidden `.a11ynotebook/` metadata directory
- ✅ Filesystem service with path validation and symlink rejection
- ✅ Accessible tree navigation (roving focus, expansion, Home/End, type-ahead, F2 rename, Delete)
- ✅ Global full-text search with snippet context and filtering (notebooks, kind, tags, dates)
- ✅ External-change watching and conflict resolution with autosave pause
- ✅ Confirmed moves/renames with unambiguous link repair and metadata migration
- ✅ Registry-backed global context menu (Shift+F10, Applications key, right-click)
- ✅ Context-menu note encryption when library protection enabled

### Phase 3 — Reader and Editor Experience

- ✅ Sanitized semantic Markdown rendering and plain-text source editing
- ✅ Structured plain-text reading view: `.txt` notes and attachments render as paragraphs/line breaks, never as Markdown or a bare `<pre>` block (PR #62)
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
- ✅ Built-in and library HTML/Markdown templates with placeholders, cursor placement, and preview
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
- ✅ Library switch and lock cancellation for scheduled tasks
- ✅ Settings-controlled in-app reminder alert queue and bundled sound; independent native notification preference
- ✅ Generic due alerts while the library is locked: privacy-safe due-time snapshot, configured sound, and a content-free alert (PR #66)
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
- ✅ **General Markdown-to-outline conversion** — headings/lists nest into a valid outline with every transformation reported as a warning before confirming (PR #65)
- ✅ **Encrypted cognitive checkpoints** — opted-in bounded drafts and explicit unsaved restore/discard/compare; manual Windows AT validation remains

### Phase 7 — Security and Local Protection

- ✅ Optional library password gate with configurable idle-lock timeout
- ✅ Unsaved-edit timeout protection with timed-out notes cleared after successful saves
- ✅ Opt-in versioned library recovery with separate random recovery key
- ✅ Authenticated password wrapper and credential-preserving atomic migration
- ✅ Password reset, rotation, and revocation via recovery
- ✅ AES-256-GCM encrypted credential storage (main-process library key)
- ✅ User-selected AES-256-GCM encrypted individual notes with scrypt-derived passwords
- ✅ Cryptographic password generation and conditional 30-second clipboard clearing
- ✅ Implemented protection limits and unsupported formats documented in `security.md`
- ✅ Library switch/lock detection and race-condition guarding for security operations
- ✅ Recovery migration commit race-condition protection against concurrent locks
- ✅ **Scoped sensitive-action audit logging** — bounded schema/retention, redaction, interruption/error tests; OS-user tampering and coverage limits apply
- ✅ **Scoped encrypted annotations/checkpoints** — stable v3 keys, per-store authenticated envelopes and pointer migration
- ⏳ **Excluded indexes and metadata** — search, links, bookmarks, reminders, settings and other documented exclusions remain plaintext/open
- ⏳ **Whole-library encryption** — open; separate opt-in mode with streaming/container format design needed

### Phase 8 — Import and Document Support

- ✅ Attachments stored in library, listed in tree, reveal/external open available
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
- ✅ **PDF notes export and navigation** — clipboard export with original quotes and status, notes-on-this-page indicator with a page-to-note focus jump (PR #67)
- ✅ **ePub reading-progress persistence** — CFI + section position saved per book and restored on open (PR #63)
- ✅ **DOCX local reading** — bounded semantic parser, reader/navigation/search and hostile-archive tests; annotations and manual AT validation remain open
- ✅ **Legacy `.doc` text extraction** — bounded local CFB/piece-table parser (text only, no formatting), import and preview (PR #62)
- ✅ **RTF import and preview** — bounded local converter to sanitized semantic HTML (PR #62)
- ✅ **Google Docs guidance** — `.gdoc` pointer files explain that the document must be downloaded in a supported format and imported (PR #62)

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
- **Mind-map visual layouts** — semantic tree is authoritative; visual enhancements remain
- **Due flashcard background notifications** — depends on Phase 5 out-of-process delivery

### Shared Accessible Reader (Cross-document)

- Common reader capability contract for outline/TOC, sequential navigation, headings/links/tables, search, bookmarks
- Markdown and sanitized HTML annotation parity verification
- ePub hostile-archive and remote-resource validation
- DOCX annotations and manual Windows assistive-technology validation

### Security and Storage

- **Audit history follow-ups** — native warning Windows AT validation, viewer/repair UI and broader automatic event coverage remain; scoped logging implemented
- ✅ **Broader encrypted indexes/metadata** — every library metadata store can now be individually migrated into encrypted protection from Settings: reminder defaults, milestones, bookmarks, the link index, image descriptions, flashcard schedules, reminders, library settings, and the persisted search-index cache, on top of the base annotations + checkpoints pair (PRs #83–#89). The settings save path no longer mirrors library settings into the plaintext app-global file while a library's settings are encrypted, and enabling settings encryption deletes the stale global mirror
- ✅ **Data-key rotation** — the actual vault data key can be rotated from Settings (PRs #90, #91): both factors are verified, protected metadata is staged under the new key before the rotated config commits, the credentials store and library-encrypted notes are re-encrypted, and anything not yet rotated keeps opening through the legacy-key fallback. Distinct from recovery-key rotation, which rewraps the same key
- 🚧 **Whole-library encryption** — the authenticated streaming container format and migration manifest are implemented and unit-tested (PR #92: per-file HKDF keys, chunk-boundary authentication binding file id, index, and finality; manifest keeps the v3 config untouched). The file-migration wiring (rewriting library files through the format, decrypting read paths, opt-in UI, crash-resume) remains open
- ✅ **Background reminder alerts (Windows)** — opt-in `backgroundReminders` setting (PR #93): a Windows Task Scheduler task briefly launches the app at each due time to show a generic alert after the app exits. The task and its persisted due snapshot contain only ids and due times, never titles or content; disabling deletes the task. Delivery on a real Windows machine is not yet verified

### Other Requested Features

- Tag and metadata suggestions with calendar-like organization
- Exited-process reminder delivery verification on Windows
- Whole-library encryption and encrypted metadata

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
**Design & Implementation Open:** Whole-library encryption file-migration wiring (format and manifest implemented in PR #92). Windows sound/focus, Task Scheduler delivery, and new recovery/alert AT workflows require manual validation.

---

## October 22, 2026 feature batch (PRs #62–#67, released as v1.2.0)

- **PR #62 — reading view and import formats:** structured plain-text rendering for `.txt` notes/attachments; local RTF→HTML import/preview; local spec-based `.doc` text extraction (the vetted strategy the continuation plan required: no external service, explicit text-only limits); `.gdoc` download guidance.
- **PR #63 — ePub reading positions:** per-book CFI/section persistence with path migration on move/rename.
- **PR #64 — recent-library picker:** ten most recent libraries on the Libraries screen; opening by path restricted to that list.
- **PR #65 — Markdown-to-outline conversion:** warning-surfacing conversion that always emits a valid `.outline.md`; source note unchanged.
- **PR #66 — locked-library due alerts:** completes the Phase 5 in-app criterion (privacy-safe snapshot, sound, generic alert, race-guarded watcher).
- **PR #67 — PDF notes export/navigation:** clipboard export with original quotes and status; page-to-note focus jump.

Validation: each PR passed typecheck, lint, its targeted suites locally, and the full GitHub CI suite (Ubuntu + Windows) before merge. Manual Windows JAWS/NVDA/Narrator validation of the new surfaces remains open, as does the Phase 12 matrix.

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

---

## October 23, 2026 completion batch (PRs #69–#94)

- **PRs #69–#75 — continuation-plan items:** reference-style Markdown link repair; crash-atomic multi-file moves with a write-ahead journal; heading/position bookmarks; guaranteed fallback undo via the command palette; general recovery mode for malformed structured drafts; general YAML front-matter metadata editing; the shared reader capability contract with Markdown/HTML annotation parity and copyable note annotations.
- **PRs #76–#79 — DOCX and ePub annotations:** anchor models, shared versioned annotation store envelopes, reader UI with anchored/ambiguous/orphan status, jump/edit/delete, and clipboard export with original quotes.
- **PRs #80–#82 — PDF Phase 7 and mind maps:** cross-page grouped notes; PDF lifecycle/resource-limit validation with an idempotent destroy; rich mind-map visual layouts (hierarchical and radial) with the semantic keyboard tree remaining authoritative.
- **PRs #83–#89 — broader encrypted metadata:** the parameterized protection foundation plus per-store wiring for reminder defaults, milestones, bookmarks, the link index, image descriptions, flashcard schedules, reminders, library settings (including closing the plaintext global-mirror leak), and the search-index cache.
- **PRs #90–#91 — data-key rotation:** crypto core plus audited IPC, content re-encryption, and Settings UI.
- **PR #92 — whole-library encryption foundation:** authenticated streaming container format and migration manifest (wiring remains open).
- **PR #93 — exited-process reminders:** Windows Task Scheduler wake alerts over the persisted due snapshot, plus background flashcard alerts through the same snapshot kinds.
- **PR #94 — store inventory cleanup:** removed the phantom `asset-drafts` protected-store name (drafts live in the checkpoints store).

Validation: each PR passed typecheck, the full lint, targeted suites locally, and the full GitHub CI suite (Ubuntu + Windows) before merge. Still open and honestly unverified: manual JAWS/NVDA/Narrator and forced-colors validation, UI Automation smoke runs, code signing, Task Scheduler delivery on a real Windows machine, and the whole-library encryption file-migration wiring.
