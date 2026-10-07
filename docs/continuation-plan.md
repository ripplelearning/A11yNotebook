# Dependency-ordered continuation

This document is an implementation queue, not a completion claim. The recovery foundation already exists on main.
This increment adds scoped sensitive-action auditing and milestone planning UI; it does not deliver metadata
encryption, cognitive draft recovery, DOCX or exited-process reminders. Remaining phases require focused implementations, tests, reviews, and accessibility
validation. Do not combine unrelated data migrations or infer that a feature is complete from roadmap scaffolding.

## Delivered here — opt-in vault recovery ✅

- Legacy version-1 password records continue to unlock unchanged. Recovery is never enabled implicitly.
- After confirming the existing password in an unlocked vault, the user can generate a 256-bit random recovery key,
  save it separately, and explicitly acknowledge saving it. It is displayed once in an accessible read-only field;
  the app does not copy, persist, or log the recovery secret.
- Version 2 wraps a fresh random data key independently with the existing scrypt-derived password key and the
  high-entropy recovery key. AES-GCM envelopes use fresh nonces, domain separation, authenticated identifiers, strict
  bounds, and an authenticated config manifest. The manifest binds recovery-wrapper fields and credential presence;
  credential and legacy-key envelopes authenticate their own ciphertext.
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

1. **Sensitive-action audit log — scoped implementation, automated tests.** Version 1 records only allowlisted
   operation/outcome/time for protection, recovery, credentials, note encryption and export. Bounded retention,
   redaction, interruption, concurrency, malicious metadata and independent storage-failure outcomes are tested.
   See `security.md` for exact coverage/exclusions, crash/durability and OS-user tampering limits. Native warning
   speech/focus still needs Windows AT verification; an audit viewer and comprehensive automatic-lock/event history
   are not implemented.
2. **Encrypted indexes and metadata — open, depends on stable key handling.** Inventory annotations (including PDF),
   reminders, flashcard schedules, settings, image descriptions, link/search indexes, and any recovery/crash drafts.
   Specify per-store domains and versioned authenticated envelopes in the main process. Migrate explicitly and
   backward-compatibly; reject protected reads while locked. Test interruption/restart, rollback, key rotation,
   malformed/tampered records, and ensure no plaintext temporary file, index, or draft is produced.
   The verified store inventory, proposed domain/key ownership and generation-commit policy are in `security.md`.
   Direct `service.ts` link/bookmark writers, `search.ts` cache/startup/watch writers, both settings copies and global
   preferences must be addressed; do not silently add encryption to only the generic metadata writer.
3. **Whole-vault encryption — open design and implementation.** This is a separate opt-in storage mode, not password
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
- **Exited-process reminders/reviews remain open.** Design an opt-in Windows integration (Task Scheduler/helper or
  supported equivalent) with explicit consent, uninstall/disable cleanup, no shell injection, secrets, or plaintext
  titles in command lines, and duplicate/restart/race prevention. Specify lock/privacy behavior and missed-reminder
  fallback. Tray-only behavior is not delivery after process exit; never install a service silently.

## Phase 6 — cognitive assets and templates — open

1. **Unsaved-edit recovery first.** Add bounded, versioned crash-recovery records for outlines, mind maps, flashcards,
   and grids; offer accessible explicit restore/discard; validate vault scope and external-edit baselines/conflicts;
   clean stale drafts. Protected data must not create plaintext drafts. Depends on encrypted metadata/draft policy.
   Still no draft store, checkpoint hook or restore/discard dialog exists. After the metadata commit policy ships,
   define a versioned vault/asset-scoped encrypted draft envelope with asset type, content, saved baseline/hash,
   revision and expiry; validate type and size before parsing. Checkpoint on debounce/explicit save boundaries,
   never automatically overwrite a file. Offer restore/discard with keyboard focus and announcements and an explicit
   conflict path when the file changed externally, moved or was deleted. Save success removes only the matching draft
   revision; save failure retains it. Moves must preserve identity; delete/switch/lock must cancel stale writes and
   clear memory. Test partial writes/restart, stale cleanup, races, external conflict, discard cancellation and no
   plaintext protected content. Disabling persistent drafts is safer than a plaintext fallback while policy is open.
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
2. **ePub — partial.** Paginated epub.js rendering, nested navigation-document TOC, chapter sanitization, bounded text
   search, and cleanup are implemented. Validate remote-resource and hostile-archive handling; add document annotations
   and persisted reading position.
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

## Exited-process Windows implementation gates — no integration ships here

Tray/closed-window behavior is not delivery after exit. No Task Scheduler registration/helper/enable/disable/status
API, settings consent or uninstall cleanup exists. The existing app scheduler is not an interprocess transaction.
Before claiming implementation:

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
  document no per-reminder delivery for protected vaults. Never persist credentials to bypass locking. Specify vault
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

## DOCX implementation gates — unsupported in this increment

No local DOCX parser/dependency was added or vetted in this session. A parser choice must be checked against dependency
advisories, maintained local parsing behavior and license, and tested before exposing typed document IPC. A semantic
adapter must preserve paragraphs, headings, ordered/unordered lists, table headers/cells, safe links and image
descriptions; add keyboard navigation and bounded search using the reader architecture rather than altering PDF or
epub.js semantics. Original bytes remain unchanged and all filesystem/archive processing stays in the main process.

Preflight ZIP structure **before** parser expansion: bound compressed and expanded totals, each entry, entry count,
compression ratio and nesting/XML depth; reject duplicate/traversal/absolute/backslash paths, unsupported compression,
malformed central/local headers, encrypted archives, macros, ActiveX/OLE/embedded packages, DTD/entities, active content
and unsafe external relationships/resources. Never fetch resources, use Office automation or upload files. Add hostile
fixtures (including forged size fields and expansion bombs), time/resource bounds, sender/path/cancellation/race tests
and semantic/keyboard/focus tests. Legacy binary `.doc` remains explicitly unsupported, not guessed as ZIP/DOCX.
