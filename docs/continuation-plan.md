# Dependency-ordered continuation

This document is an implementation queue, not a completion claim. Only the recovery foundation in the first section
ships in this increment. Remaining phases require their own focused implementations, tests, reviews, and accessibility
validation. Do not combine unrelated data migrations or infer that a feature is complete from roadmap scaffolding.

## Delivered here — opt-in vault recovery ✅

- Legacy version-1 password records continue to unlock unchanged. Recovery is never enabled implicitly.
- After confirming the existing password in an unlocked vault, the user can generate a 256-bit random recovery key,
  save it separately, and explicitly acknowledge saving it. It is displayed once in an accessible read-only field;
  the app does not copy, persist, or log the recovery secret.
- Version 2 wraps a fresh random data key independently with the existing scrypt-derived password key and the
  high-entropy recovery key. AES-GCM envelopes use fresh nonces, domain separation, authenticated identifiers, strict
  bounds, and an authenticated configuration digest.
- The atomic `security.json` replacement is the migration commit boundary. It contains the re-encrypted credentials and
  a wrapped prior vault key for legacy vault-key-encrypted notes. The old encrypted credential file is removed after
  commit. A durable cleanup marker causes startup to retry cleanup before exposing the vault; a cleanup failure locks
  the vault. A failure before the commit preserves the old security record and credentials.
- Recovery resets the vault password, preserves credentials and vault-key-encrypted notes, and rejects the old
  password. Users can rotate or revoke recovery after confirming their current password. Independently
  password-encrypted notes are deliberately not recoverable through the vault recovery key.
- Derived keys and data keys remain in the main process. Recovery keys are user-facing secrets and are shown to the
  renderer only for explicit saving/acknowledgment and user-initiated recovery.

## Security and storage follow-ups — open

1. **Sensitive-action audit log — open.** Define a local, bounded append/retention format and validate every event.
   Record operation, outcome, and time only; exclude passwords, recovery/data/derived keys, credential values, note
   bodies, quotes, and unnecessary sensitive paths. Use atomic/validated writes and explicit error handling: a failed
   audit write must not be reported as recorded success. Document that a local log is not tamper-proof against the OS
   user. Tests must cover malformed logs, size/retention limits, interrupted writes, and redaction.
2. **Encrypted indexes and metadata — open, depends on stable key handling.** Inventory annotations (including PDF),
   reminders, flashcard schedules, settings, image descriptions, link/search indexes, and any recovery/crash drafts.
   Specify per-store domains and versioned authenticated envelopes in the main process. Migrate explicitly and
   backward-compatibly; reject protected reads while locked. Test interruption/restart, rollback, key rotation,
   malformed/tampered records, and ensure no plaintext temporary file, index, or draft is produced.
3. **Whole-vault encryption — open design and implementation.** This is a separate opt-in storage mode, not password
   gating. Before implementation, specify threat model and behavior for ordinary-file interoperability, filenames and
   attachments, external editors/watchers, search, export, lock, migration, and recovery. Require a bounded authenticated
   streaming/container format and a safe resumable migration with explicit rollback and crash-restart tests. Do not
   mark protection complete from scaffolding. If those criteria cannot be met, leave the feature explicitly open.

## Phase 5 — tasks, reminders, and planning — open

- Persist and validate reminder defaults (time, snooze, privacy, and notification choices); creation dialogs consume
  defaults without rewriting existing reminders.
- Add named milestones with stable IDs, task/note associations, due dates, statuses, accessible summaries, and
  progress. Preserve identity across moves/deletes and source changes; HTML task IDs stay stable and Markdown task
  identity must be safe across edits.
- First share the main-process scheduler, due summaries, consent/privacy choices, deduplication, and switch/lock
  behavior across reminders and due flashcard reviews. Explicitly distinguish a closed window from an exited process.
- **Exited-process reminders/reviews remain open.** Design an opt-in Windows integration (Task Scheduler/helper or
  supported equivalent) with explicit consent, uninstall/disable cleanup, no shell injection, secrets, or plaintext
  titles in command lines, and duplicate/restart/race prevention. Specify lock/privacy behavior and missed-reminder
  fallback. Tray-only behavior is not delivery after process exit; never install a service silently.

## Phase 6 — cognitive assets and templates — open

1. **Unsaved-edit recovery first.** Add bounded, versioned crash-recovery records for outlines, mind maps, flashcards,
   and grids; offer accessible explicit restore/discard; validate vault scope and external-edit baselines/conflicts;
   clean stale drafts. Protected data must not create plaintext drafts. Depends on encrypted metadata/draft policy.
2. **General Markdown-to-outline conversion.** Preserve heading hierarchy and meaningful content; deliberately handle
   front matter, fenced code, and lists; preview content-loss warnings; create a sibling asset without overwriting the
   source.
3. **Mind-map visual layouts.** Improve hierarchical/radial views while the semantic keyboard-operable tree remains
   authoritative. SVG must be decorative and nonduplicating; retain visible focus and equivalent nonvisual operations,
   zoom, reduced-motion, and forced-colors behavior.
4. **Due flashcard notifications.** Use Phase 5's shared scheduler, consent, privacy, and deduplication infrastructure;
   stopping, switching, or locking must not reveal protected content.

## Shared accessible reader — staged work open

Provide a common reader capability contract and consistent accessible UI/commands for outline/TOC, sequential
navigation, headings/links/tables, search, bookmarks, reading position, annotation creation/list/jump/focus/edit/delete,
original-quote export, changed-file confidence/orphan status, and lifecycle cleanup. Preserve semantic reading order,
language, image descriptions, list/table headings, and real links in the accessible DOM. Use format-native anchors:
PDF page/range; ePub spine/resource plus validated text position or CFI; HTML/Markdown stable semantic text anchors; and
Word paragraphs/runs. Do not force reflow documents into PDF page coordinates.

Implement adapters in this order after the shared contract and safe lifecycle are tested:

1. **Markdown and sanitized HTML parity — open.** Reuse the existing safe capture/sanitization boundary; no active
   browsing scripts, relaxed sandbox, or arbitrary network access. Verify existing note annotations against the common
   capability contract.
2. **ePub — open.** Add safe reflow, navigation-document TOC, resource resolution, and annotations. Reject traversal,
   unsafe archives, remote resources, and scripts; bound archive entries, total decompression, and parsing. Release
   resources on book/vault changes.
3. **DOCX — open.** Extract supported semantic structures for accessible reading/navigation; reject external resources,
   macros, unsafe ZIP expansion, and oversized/hostile documents. Never execute Office automation/macros or upload
   private documents to third-party services.
4. **Legacy `.doc` — unsupported/open pending a vetted local strategy.** `.doc` is not renamed `.docx`. If no secure,
   feasible local parser/converter is identified, show an explicit unsupported state and propose a vetted local
   dependency; never silently misparse or send documents to a conversion service.
5. **PDF remaining capabilities — open.** Preserve the implemented semantic reader and stable anchors. Finish common
   sidebar/export/lifecycle behavior as needed; preserve original quotes, confidence/orphan reporting, bidirectional
   focus/navigation, cleanup, performance, and security checks. Cross-page pointer selection remains separate follow-up.

## Accessibility release gate — manual validation not run

Every new workflow needs keyboard/focus/announcement tests and a manual Windows pass. Automated tests do not establish
screen-reader compatibility. Record app/build, OS, assistive-technology version, outcome, and defects for each cell:

| Workflow                                                                        | JAWS       | NVDA       | Narrator   | Windows UI Automation |
| ------------------------------------------------------------------------------- | ---------- | ---------- | ---------- | --------------------- |
| Recovery-key generation, explicit save acknowledgment, rotation, and revocation | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| Locked recovery, password reset, error recovery, and focus return               | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| Common reader navigation, search, annotations, and bidirectional focus          | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| ePub/DOCX reflow, TOC/structure, and annotation workflows                       | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |

Also verify keyboard-only operation, visible focus, 200–400% reflow/zoom without loss of reading order, reduced motion,
high contrast and Windows forced colors, semantic headings/landmarks, and no duplicate decorative SVG announcements.
Windows execution and licensed/tooling-dependent manual passes are externally blocked in this environment.
