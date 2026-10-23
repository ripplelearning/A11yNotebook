# Dependency-ordered continuation

This document is an implementation queue, not a completion claim. The recovery foundation already exists on main.
Main includes scoped sensitive-action auditing, milestone planning UI, and local DOCX reading.
Remaining phases require focused implementations, tests, reviews, and accessibility
validation. Do not combine unrelated data migrations or infer that a feature is complete from roadmap scaffolding.

## Delivered here — opt-in library recovery ✅

- Legacy version-1 password records continue to unlock unchanged. Recovery is never enabled implicitly.
- After confirming the existing password in an unlocked library, the user can generate a 256-bit random recovery key,
  save it separately, and explicitly acknowledge saving it. It is displayed once in an accessible read-only field;
  the app does not copy, persist, or log the recovery secret.
- Current version 3 wraps a fresh random data key independently with the existing scrypt-derived password key and the
  high-entropy recovery key. AES-GCM envelopes use fresh nonces, domain separation, authenticated identifiers, strict
  bounds, and an authenticated config manifest. The manifest binds recovery-wrapper fields and credential presence;
  credential and legacy-key envelopes authenticate their own ciphertext.
- The atomic `security.json` replacement is the migration commit boundary. It contains the re-encrypted credentials and
  a wrapped prior library key for legacy library-key-encrypted notes. The old encrypted credential file is removed after
  commit. A durable cleanup marker causes startup to retry cleanup before exposing the library; a cleanup failure locks
  the library. A failure before the commit preserves the old security record and credentials.
- Recovery resets the library password, preserves credentials and library-key-encrypted notes, and rejects the old
  password. Users can rotate or revoke recovery after confirming their current password. Independently
  password-encrypted notes are deliberately not recoverable through the library recovery key.
- Derived keys and data keys remain in the main process. Recovery keys are user-facing secrets and are shown to the
  renderer only for explicit saving/acknowledgment and user-initiated recovery.

## Security and storage follow-ups — open

1. **Sensitive-action audit log — scoped implementation, automated tests.** Version 1 records only allowlisted
   operation/outcome/time for protection, recovery, credentials, note encryption and export. Bounded retention,
   redaction, interruption, concurrency, malicious metadata and independent storage-failure outcomes are tested.
   See `security.md` for exact coverage/exclusions, crash/durability and OS-user tampering limits. Native warning
   speech/focus still needs Windows AT verification; an audit viewer and comprehensive automatic-lock/event history
   are not implemented.
2. **Scoped annotation/checkpoint protection — implemented, including the broader indexes/metadata.** Explicit consent
   in an unlocked version-3 library enables main-process authenticated per-store ciphertext and security-pointer
   migration, with cleanup retry and no protected plaintext fallback. Markdown/HTML/PDF/DOCX/ePub annotations and
   cognitive checkpoints are included in the base stores. The broader wiring (PRs #83–#89) routes the direct
   `service.ts` link/bookmark writers, the `search.ts` cache/startup/watch writers, reminder/default stores,
   schedules, milestones, image descriptions, reminders and both settings copies through the same protection, each
   behind its own per-store consent; the settings global mirror is suppressed while a library's settings are
   encrypted. Global preferences and the audit log remain documented plaintext exclusions. Actual data-key
   rotation (not recovery-key rotation) is implemented (PRs #90–#91), including protected-store staging, the
   legacy-key fallback for unrotated content, and completion reseal.
3. **Whole-library encryption — complete for all file classes (PRs #96–#99).** This is a separate opt-in storage mode, not password
   gating. Before implementation, specify threat model and behavior for ordinary-file interoperability, filenames and
   attachments, external editors/watchers, search, export, lock, migration, and recovery. Require a bounded authenticated
   streaming/container format and a safe resumable migration with explicit rollback and crash-restart tests. Do not
   mark protection complete from scaffolding. If those criteria cannot be met, leave the feature explicitly open.

## Phase 5 — tasks, reminders, and planning — open

- Already implemented: persist and validate reminder defaults (time, snooze, privacy, and notification choices); creation dialogs consume
  defaults without rewriting existing reminders.
- Named milestone service already implemented; this increment adds planning UI with stable IDs, task/note associations, due dates, statuses, accessible summaries, and
  progress. Preserve identity across moves/deletes and source changes; HTML task IDs stay stable and Markdown task
  identity must be safe across edits.
- Already implemented in-process: shared main-process scheduler, due summaries, consent/privacy choices, deduplication, and switch/lock
  behavior across reminders and due flashcard reviews. Explicitly distinguish a closed window from an exited process.
- In-app alerts use this scheduler with persisted Settings choices, bundled sound, focused-only accessible dialogs,
  queued reminders, Mark Complete/Dismiss/Snooze actions, all requested snooze intervals, privacy and library cancellation.
  Native notifications are independent. Escape/Later closes without reminder dismissal.
- **Complete (PR #66):** the reminder service exposes a privacy-safe due snapshot (ids and times only); the IPC
  layer keeps it fresh and, on lock, a generation-guarded watcher fires one content-free "locked-due" event per due
  batch plus a generic native notification. The renderer's locked alert component plays the configured sound (even
  unfocused) and shows the generic “A reminder is due. Unlock the library to view it.” dialog. Unit tests cover the
  snapshot's privacy, watcher batching, and the lock/unlock cancellation race; an IPC-harness-level lock scenario
  remains unrun, and real Windows audio/focus validation is still manual (below).
- **Manual validation needed:** real Windows unfocused/minimized audio, queue focus transfer/return and
  JAWS/NVDA/Narrator speech. Automated mocks are not proof of these behaviors.
- Startup readiness replay buffers the latest 100 fired events for once-only sound delivery before the renderer
  subscribes. Older overflow items remain in persisted Reminders and load into the visual queue silently; audible
  catch-up for an overflow beyond 100 simultaneous startup deliveries is not guaranteed.
- **Exited-process reminders/reviews — implemented (PR #93); Windows delivery unverified.** The opt-in
  `backgroundReminders` setting registers a single Windows Task Scheduler task (fixed name, always replaced with
  /F; schtasks via argument arrays; escaped XML carrying only a due time and the launch command) that wakes the
  app at the next due time from the persisted ids-and-times snapshot. The wake shows a generic alert, drops fired
  entries, and re-registers; disabling deletes the task. Lock/privacy behavior matches the locked-library alerts:
  generic text only, no titles anywhere outside the unlocked app. Actual schtasks delivery on a real Windows
  machine remains unverified.

## Phase 6 — cognitive assets and templates — open

1. **Encrypted unsaved-edit recovery — implemented with opt-in scope.** Outlines, mind maps, flashcards and grids
   checkpoint after a 750 ms debounce only after scoped protection consent. Records bind asset path/type, revision,
   baseline content/hash and seven-day expiry; size/count limits apply. Reopening offers explicit Restore/Discard/Compare,
   with conflict warnings for changed source baselines. Restore is unsaved editor content, never an automatic disk write.
   Successful saves retire matching checkpoints, moves/renames migrate paths and deletes/discard clear drafts.
   Lock/switch invalidates queued operations and clears editors. No plaintext fallback exists; the debounce window
   can lose recent edits. Real Windows keyboard/screen-reader validation remains unrun.
   **Partial:** malformed outline/mind-map/grid checkpoint content is available for compare/copy, but structured
   restore requires valid content. A general source-edit recovery mode for malformed structured drafts remains open.
2. **General Markdown-to-outline conversion — delivered (PR #65).** Headings nest by level, lists nest by
   indentation, fenced code/tables/images stay verbatim, front matter is omitted, and every transformation is
   surfaced as a warning in the confirmation before a sibling `.outline.md` is created; the source note is
   never overwritten.
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
2. **ePub — partial.** Paginated epub.js rendering, nested navigation-document TOC, chapter sanitization, bounded text
   search, cleanup, and persisted reading position (PR #63) are implemented. Validate remote-resource and
   hostile-archive handling; document annotations remain open.
3. **DOCX — local reading implemented in PR #27.** The bounded main-process ZIP/XML parser extracts semantic
   paragraphs, headings, lists, tables, links and raster images; the reader provides navigation and search.
   Hostile-archive tests cover external resources, macros and unsafe expansion. DOCX annotations are not implemented.
   Real Windows assistive-technology validation remains unrun. Never execute Office automation/macros or upload
   private documents to third-party services.
4. **Legacy `.doc` — resolved (PR #62).** The vetted strategy is a bounded, local, spec-based extractor
   ([MS-CFB] compound file + [MS-DOC] piece table) implemented in `electron/vault/doc.ts`: text only, no
   formatting, no macros or embedded objects executed, nothing sent to a conversion service. `.doc` imports as a
   `.txt` note and previews as extracted text; unsupported or malformed files fail with an explicit error.
5. **PDF remaining capabilities — sidebar/export delivered (PR #67).** The notes panel is the annotation
   sidebar: note-to-page navigation, a notes-on-this-page indicator with a page-to-note focus jump, and clipboard
   export preserving original quotes plus confidence/verification/orphan status. Lifecycle, cleanup, performance,
   and broader security validation remain open follow-up; cross-page pointer selection remains separate.

## Accessibility release gate — manual validation not run

Every new workflow needs keyboard/focus/announcement tests and a manual Windows pass. Automated tests do not establish
screen-reader compatibility. Record app/build, OS, assistive-technology version, outcome, and defects for each cell:

| Workflow                                                                        | JAWS       | NVDA       | Narrator   | Windows UI Automation |
| ------------------------------------------------------------------------------- | ---------- | ---------- | ---------- | --------------------- |
| Recovery-key generation, explicit save acknowledgment, rotation, and revocation | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| Locked recovery, password reset, error recovery, and focus return               | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| Common reader navigation, search, annotations, and bidirectional focus          | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| ePub/DOCX reflow, TOC/structure, and annotation workflows                       | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| Scoped annotation consent/migration, lock and recovery reset                    | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| Cognitive checkpoint Restore/Discard/Compare and external conflicts             | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |
| Reminder queue, focus return, actions, privacy and minimized sound              | ⛔ Not run | ⛔ Not run | ⛔ Not run | ⛔ Not run            |

Also verify keyboard-only operation, visible focus, 200–400% reflow/zoom without loss of reading order, reduced motion,
high contrast and Windows forced colors, semantic headings/landmarks, and no duplicate decorative SVG announcements.
Windows execution and licensed/tooling-dependent manual passes are externally blocked in this environment.

## Exited-process Windows implementation gates — integration shipped (PR #93), verification open

The Task Scheduler registration, settings consent, wake flow, and disable-cleanup described in Phase 5 now exist.
What remains open is verification, not implementation:

- Use explicit opt-in, per-user non-elevated registration, confirmation before enable/disable and actionable status/
  registration/update/unregister failures. Launch only the trusted installed helper using argument arrays without a
  shell; Task Scheduler XML/arguments contain neither note text/titles nor passwords/keys. Define task ownership and
  path validation, version/update reconciliation and installer-uninstall cleanup; never silently install a service.
- Define installed-only support versus portable/dev paths (unsupported until reliable identity/cleanup exists),
  scheduled helper bounded lifetime, missed/reboot triggers, opt-out cancellation and stale-task cleanup.
- Reuse reminder consent/privacy/defaults and missed-delivery logic. Add an atomic **interprocess** lease/delivery
  ledger before concurrent helper/app startup can claim notifications. Existing in-process dedup alone is insufficient.
- Encrypted schedules cannot be decrypted after exit without an unlocked main-process key. Prefer an explicitly
  consented generic “Open A11y Notebook to check reminders” wake-up with no persisted sensitive schedule, or explicitly
  document no per-reminder delivery for protected libraries. Never persist credentials to bypass locking. Specify library
  switch/lock behavior, task cancellation, reboot and app/helper coordination before exporting even generic wake times.
- Add mocked OS tests for malicious arguments/paths/XML, failed registration/updates/unregister, consent cancellation,
  duplicate helpers, lease crash/restart, changed installation paths and locked/encrypted schedules. Mocks do not
  establish actual Task Scheduler or Windows toast behavior.

Manual matrix (all **not run**, no Windows runner in this session):

| Build/scenario                                       | Required verification                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Installed, opted out / enable cancelled              | No tasks/helper; no notifications after exit                             |
| Installed, opted in, window closed vs process exited | Correct distinction; bounded helper lifetime; generic privacy-safe toast |
| Restart/reboot/sleep after due time                  | One missed delivery; no duplicate app/helper toast                       |
| Concurrent app startup and helper executions         | Single delivery claim; crash/lease expiry recovers                       |
| Lock/switch/recovery/encrypted schedules             | No secret/key/title disclosure or unintended decryption                  |
| Disable/update/uninstall                             | Owned tasks removed or reconciled; actionable retry if cleanup fails     |
| Portable/dev/moved binary                            | Explicit supported/unsupported status; no silent registration            |
| JAWS/NVDA/Narrator/keyboard/forced colors            | Consent, errors/status and notification action accessible                |

## DOCX follow-ups

Local parsing, typed IPC, reader navigation/search and hostile fixtures already ship on main. Preserve the 40 MiB
archive, 50 MiB expanded-total and 10,000-entry bounds and rejection of encrypted archives, macros, OLE, unsafe
relationships and traversal. Original bytes remain unchanged; archive processing stays in the main process.
DOCX annotations and manual JAWS/NVDA/Narrator validation remain open. Legacy binary `.doc` is handled by the
bounded local text extractor in `electron/vault/doc.ts` (PR #62); it is never guessed as ZIP/DOCX.
