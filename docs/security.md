# Security

## What this build protects

The sandboxed renderer has no Node/Electron filesystem access. Fixed typed IPC methods check the trusted
top-level application frame. Vault and metadata paths reject traversal, absolute paths, and symlinks.
Markdown and HTML note content are sanitized in the renderer; HTML attachment previews have an empty sandbox and a default-src-none policy. The attachment
protocol serves bounded local raster, PDF, and ePub data with nosniff and no-store. PDF.js uses a bundled worker;
epub.js processes the local archive as accessible text without rendering book markup or loading remote resources.
Web capture is an explicit user action:
main-process requests require globally routable unicast addresses for both URL literals and DNS results, reject
special-purpose/reserved ranges and IPv4-mapped IPv6 addresses, pin an address for each request, revalidate redirects,
and bound page/image sizes. Both capture formats use the same URL checks and deadlines. HTML capture is sanitized in
the main process with an allowlist; it contains no scripts, handlers, forms, or remote resources. Only downloaded
raster images with descriptions are localized, and failures are reported.

Note export uses a fixed typed IPC method, validates the source path inside the open vault, and asks the operating
system for a destination. It refuses to overwrite the source note and requests native overwrite confirmation.
Standalone HTML is sanitized again in the main process, contains a restrictive `default-src 'none'` policy, and
embeds only bounded local raster images as data URIs. Relative links and other attachments are not copied. The UI
requires explicit consent before exporting decrypted protected-note content; locked vaults and individually encrypted
notes without an unlocked note key cannot be exported. No generic renderer-supplied filesystem path is accepted.

These checks are not protection against a malicious process running as the same OS user that races filesystem
changes. Optimistic note/asset baselines reject stale writes but do not lock out external writers.
Multi-file move/link-repair rollback is best effort, not crash-atomic.

## Password locks and encrypted records

Legacy vault password protection uses scrypt (`N=32768`, `r=8`, `p=1`, 16-byte random salt) to derive a 256-bit key in
the main process. Version-1 `security.json` stores only the salt and an AES-GCM-encrypted verifier. The main process
caches the key until manual lock, configured idle timeout, vault switch, or application exit; locks clear the Buffer and
the renderer clears open notes, search results, credentials, and other content state. JavaScript cannot guarantee
that every copy in memory is erased.

Queued security and credential operations retain their initiating vault and recheck authorization when they execute.
Lock requests invalidate in-flight unlock derivations; discarded keys are wiped. Attachment reads and web captures
recheck vault/lock identity before returning bytes or committing downloaded content.

Notes are encrypted only after the user selects **Encrypt note** and supplies a separate note password. Their `.md`
or `.html` file then contains a versioned AES-256-GCM envelope with a fresh 96-bit nonce, 128-bit tag, random salt and stable
record ID, and authenticated format, domain, and record ID. The note key is derived with scrypt and cached only in
main-process memory until vault lock, switch, or exit. Legacy `credentials.json` stores its encrypted list with a
separate HKDF key domain; recovery-enabled version-3 vaults keep the authenticated credential envelope in
`security.json` so credentials and wrapped keys share one atomic migration boundary. Wrong passwords, malformed
envelopes, and authentication failures are rejected without returning plaintext. Renaming/moving an encrypted note
preserves its record ID. The renderer never receives a derived key.

### Opt-in vault recovery

Recovery is optional and is not silently enabled when opening a legacy vault. An unlocked user must confirm the current
vault password, generate a recovery key, save it independently, and explicitly acknowledge that it was saved. The
one-time key is displayed in an accessible read-only field; it is not written to metadata, logged, or copied to the
clipboard automatically. The renderer handles the recovery secret only for explicit saving or user-initiated recovery;
derived keys and the random vault data key remain in the main process.

Current recovery migration writes a version-3 `security.json` containing a fresh random 256-bit data key wrapped separately by
the scrypt-derived password key and the high-entropy random recovery key. AES-256-GCM uses fresh nonces, authenticated
version/domain/record identifiers, and independent HKDF domains. The configuration authenticates its credential
envelope and a wrapped copy of the prior vault key, preserving credentials and legacy vault-key-encrypted notes. The
credential envelope and key wrappers share one atomically replaced JSON file as the migration commit boundary; legacy
credential ciphertext is removed only after that commit. Existing version-1/2 configurations remain backward-compatible.
If the initial write fails, the prior security record and
credentials remain unchanged. If cleanup is interrupted after commit, the vault is locked and reopening retries removal
before exposing the vault. No plaintext export is part of migration.

Recovery unlock requires the recovery key and a new vault password. The new password wrapper is atomically committed
before the vault unlocks; the previous password is rejected afterward. The same authenticated flow supports recovery-key
rotation and revocation after current-password confirmation. Keep recovery keys private and separate from the vault.
Recovery resets only the vault password: notes encrypted with their own independent passwords remain unrecoverable
without those note passwords. Recovery is not whole-vault encryption, and it does not protect ordinary files or
plaintext metadata from direct filesystem access.

Vault idle lock defaults to 15 minutes and can be disabled or set from 1–240 minutes. The optional unsaved-edit
timeout changes the editor to read-only and requires a successful save before editing again, even after switching tabs.
Settings are reloaded after vault unlock; a settings-read failure does not undo a successful unlock. This edit timeout is an interface
guard, not a substitute for OS-level access control.

The note-encryption dialog can generate a cryptographically random note password. Copying a generated password starts a
30-second clipboard timer; the app clears the clipboard only if it still contains that same password, so it does not
erase unrelated clipboard content.

## Important limitations

Vault password protection gates app IPC but **does not encrypt the whole vault**. Unmarked notes, file names,
annotations, settings, reminders, and other metadata remain plaintext. Search indexing scans ordinary Markdown and
its persisted index may contain plaintext; it is not a secure store. Encrypted note content is not searchable and
does not contribute tasks or link data. HTML task indexing does not decrypt or inspect encrypted note envelopes.
Credentials are encrypted at rest, but are decrypted into renderer memory
when the credential manager is open. A vault recovery key does not recover independently password-encrypted notes.
Encrypted indexes and whole-vault encryption are not implemented. The limited local audit log described below does not
encrypt metadata or prove that every action was recorded. Protect the vault
with OS account controls and disk encryption.

PDF annotation paths are validated inside the current vault, including symlink
checks. Quotes, context, labels, and comments are stored in plaintext metadata
for ordinary PDFs; a vault password gate is **not** metadata encryption.
Protected-content checks reject annotation access that would expose protected
plaintext. Whole-vault and annotation-metadata encryption remain unimplemented.

PDF.js renders one bounded-scale canvas page with selectable text and stable
canonical-range annotation mapping. Changed file hashes require explicit
reconfirmation; unresolved notes keep their original quotes rather than being
silently moved or discarded. ePub.js renders paginated spine content and a navigation TOC; chapter markup is sanitized
with DOMPurify before rendering. Extracted text remains bounded to 500 sections and 20 MB, and ePub annotation UI is
not implemented.
Complex PDFs/fonts/encryption and some ePub packaging/content remain unsupported. Web capture preserves common semantic
HTML and downloads only supported raster images. HTML task IDs and scheduling metadata are ordinary note content and
are not a security boundary. Notifications may expose reminder titles
through the OS notification UI. Clipboard auto-clear applies only to generated note passwords copied from the
encryption dialog, not arbitrary text or other secrets.

The separate bounded PDF text extractor used by search follows page-tree/content-reference order for simple PDFs,
preserves blank pages, and ignores unreferenced streams. Unstructured input falls back to document-level text; it is
not a replacement for the PDF.js reader and does not support all PDF object streams, encodings, or filters.

## Sensitive-action audit log

The main process records trusted requests for vault password setup, unlock and manual lock; recovery preparation,
commit/rotation, password reset and revocation; note encryption; credential read/save/delete; and note export.
The allowlist is fixed in `electron/vault/audit.ts`. Ordinary note reads/saves, automatic idle/exit/switch locking,
clipboard actions and actions in external applications are not audited. This is a scoped local history, not a
comprehensive forensic or compliance log.

`.a11ynotebook/audit.json` uses schema version 1: an `entries` array with exactly `operation`, `outcome`, and UTC `time`.
No renderer-supplied payload, error text, identifier, credential, password, key, note body, quote, filename or path is
included. Outcomes are `succeeded`, `failed`, `cancelled`, or `committed-with-error`. These describe the request result;
`failed` does **not** promise that a filesystem operation was rolled back. Known commits followed by processing failures
are labelled explicitly and the caller receives a committed-operation error rather than advice to repeat the mutation.
Preparation of recovery only means a key was prepared, not that recovery was enabled.

On each append the log retains the newest 1,000 entries within 90 days and drops future timestamps; it is limited to
256 KiB. Pruning occurs on writes, not while the app is exited. Unsupported versions, extra fields, bad dates,
malformed/truncated JSON, non-files, symlinks and oversized existing logs are rejected without overwriting the evidence.
Writes share a queue across store instances for the same canonical destination, including same-vault reopening.
They use a private exclusive staging file, flush that file, revalidate the
destination and atomically replace it. One `pending-audit.json` staging file bounds crash leftovers; it is never
treated as committed history and is replaced on the next valid append. The app's single-instance lock and
in-process queue are assumed; simultaneous writers from separate installations/profiles are not supported.
File flushing and rename do not guarantee survival of every filesystem/OS/power failure.

Audit persistence returns a separate recorded/not-recorded outcome. On storage failure a native warning explains
whether the operation succeeded, failed, was cancelled, or committed before failing. A successful operation is not
undone or rejected merely because its history could not be written. Do not repeat a successful export, credential
change or recovery operation to retry logging. If even the warning dialog fails, the main process emits a fixed,
content-free diagnostic; it cannot guarantee that the user saw it. Inspect disk space/permissions and damaged
metadata before explicitly repairing a log. There is no audit viewer, repair button, automatic corrupt-log deletion,
cryptographic chain or remote log transmission.

Anyone who can act as the OS user can alter/delete the log, change the clock, replace app files or race filesystem
validation. The log is plaintext, and operation times themselves reveal activity. It cannot establish authenticity,
prevent OS-user tampering, guarantee secure erasure or record an abruptly killed process's unfinished requests.

## Investigation milestone — 2026-10-08, live main `91482f1`

The prior research task's findings were not retrievable: its completed Actions log reports a final response but
does not include its text, and the session-store lookup returned no report. This investigation was completed
independently before implementation. Specifications are the security inventory below, `continuation-plan.md`
(storage, cognitive and Windows gates), `roadmap.md` phases 5–8 and `FEATURE_STATUS.md`; some DOCX status prose
is stale despite the merged parser, IPC, reader and hostile-fixture tests.

Evidence and ownership:

- `metadata.ts:9–37` serializes generic JSON writes through plaintext random staging. `ipc.ts:224–288` opens
  security/settings and constructs annotations, assets and milestone stores; `metadataFor` checks service identity.
- `service.ts:36–47,319–329,422–424,459–476` and `search.ts` independently create/rebuild/write link, bookmark and
  search indexes, including before unlocking. Watcher refreshes are not mediated by the generic metadata writer.
- `ipc.ts` reminder/default/milestone/image-description handlers and `assets.ts:61–65,125–138` own the other
  generic stores. `ipc.ts` settings handlers write both vault and userData copies; `store.ts:68` separately writes
  shell/sample data and PDF preferences. `recent-vault.json`, content-free audit history and password/recovery
  bootstrap configuration are deliberate plaintext exclusions, not encrypted-content stores.
- `security.ts:28–65,135–165,663–707` defines legacy v1, wrapped-key v2 and authenticated recovery v3 records.
  Recovery migration commits in `security.json`, embeds encrypted credentials, retains a wrapped legacy note key,
  and durably retries credential cleanup. Password reset/rotation/revocation rewrap the stable data key; independent
  note passwords remain separate. Actual data-key rotation is not implemented.
- `assets.ts:47–86` validates source types/bounds but saves in place. `AssetsWorkspace.tsx:65–123` keeps dirty edits
  only in memory. `App.tsx:408–433` clears/unmounts them on lock; note autosave is not a cognitive checkpoint.
  No persisted drafts exist. Source asset files, notes, attachments and exports remain ordinary files.
- `reminders.ts` provides in-process queues/dedup, not interprocess leases. `electron-builder.yml` packages NSIS
  and portable builds but has no reminder helper or uninstall hook. No Task Scheduler registration is present.
- Live `App.tsx:650–665` omits DOCX from attachment routing despite the shipped reader; this is a routing defect,
  not evidence that DOCX needs to be implemented again.

### Feasibility decision and design before implementation

Deliver a **scoped opt-in**: encrypted annotations (Markdown/HTML/PDF) and new encrypted cognitive checkpoints.
Do not offer a universal metadata/index encryption toggle. Every other row below remains excluded/open.
Only an unlocked version-3 vault may opt in, after explicit acknowledgement of these exclusions.

Use main-process AES-GCM/HKDF store domains, a bounded versioned ciphertext container, authenticated vault/store/
generation identities, and an authenticated pointer in `security.json`. Stage ciphertext first; atomically commit
the pointer; then remove legacy annotation plaintext with durable cleanup intent. Before commit, old annotations
remain authoritative; after commit, missing/tampered ciphertext must never fall back to plaintext. Interrupted
cleanup blocks protected access and is retried after unlocking. Subsequent container generations replace atomically.
No decryption key is saved outside existing wrappers. Queued work rechecks vault/lock generation before publishing
or returning; protected plaintext is not retained in a main-process cache.

Checkpoints use asset type/path, revision, timestamps/expiry, baseline hash and encrypted baseline/content.
Debounce edits, bound retention and size, offer explicit restore/discard, and never automatically overwrite source.
External baseline changes require a conflict path. Atomic saves preserve the source on staging failures; checkpoint
retirement must match the saved revision. Move/delete/lock/switch must invalidate stale requests. Plaintext draft
fallback is forbidden. A crash within the debounce window can still lose the latest edits.

Offline disclosure/tampering while keys are unavailable is the target. Compromised running applications, unlocked
renderer memory, malicious OS-user processes, file names, source files, exports, backups and filesystem rollback
are outside this protection. Deletion is not guaranteed secure erasure; GC-managed strings cannot be reliably wiped.
Rename is a crash commit boundary, not a guarantee against every power/filesystem failure.

Exited-process Windows delivery is viable as a separate installed-only project, but unsafe to ship as an incomplete
registration scaffold here. Remaining gates include a trusted signed helper and activation boundary, argument-array
launch and validated XML, per-user non-elevated consent/status/failure UI, durable interprocess leases, app/helper
coordination, reboot/missed-event handling, opt-out/update/uninstall cleanup and real Windows toast tests. Any exported
opaque due-time snapshot needs separate leakage consent and generic messages; never save unlock keys or protected
titles. No task will be registered on this runner. The manual matrix in `continuation-plan.md` remains unrun.

## Encrypted metadata and drafts: inventory

Do not infer metadata protection from password gating, note encryption or recovery. The current stores are:

| Location                                               | Owner / writers                                  | Sensitive content and encryption status                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault `annotations.json`                               | `annotations.ts`, `ipc.ts`                       | Markdown/HTML **and PDF** quotes, context, labels, comments; plaintext                                                                        |
| Vault `reminders.json`                                 | `reminders.ts` via IPC                           | Standalone titles, note/task associations, scheduling and delivery/dedup state; plaintext                                                     |
| Vault `reminder-defaults.json`                         | `reminder-defaults.ts` via IPC                   | Notification consent/privacy/time/snooze defaults; plaintext                                                                                  |
| Vault `flashcards.json`                                | `assets.ts` via IPC                              | Deck paths, card fingerprints and review schedules; plaintext                                                                                 |
| Vault `milestones.json`                                | `milestones.ts` via IPC                          | Titles, status, dates, note/task associations; plaintext                                                                                      |
| Vault `settings.json` and app userData `settings.json` | `ipc.ts`                                         | Shortcuts, theme, edit/lock timeouts; plaintext, two copies                                                                                   |
| Vault `image-alts.json`                                | `ipc.ts`                                         | Image paths and user descriptions; plaintext                                                                                                  |
| Vault `bookmarks.json`                                 | `service.ts`, move rollback in IPC               | Note paths; plaintext, includes direct service writes                                                                                         |
| Vault `links.json`                                     | `service.ts` on open/refresh/save                | Paths and link graph; plaintext, direct writer                                                                                                |
| Vault `search-index.json` and `search-index-*.tmp`     | `search.ts` on initialization/refresh/watch/save | Root/path, extracted text/snippets/tags/stat cache; plaintext, separate writer and memory cache                                               |
| Vault `security.json`                                  | `security.ts` through IPC                        | Existing version 1/2/3 key wrappers, verifier/config authentication; version 3 embeds encrypted credentials/legacy key, not ordinary metadata |
| Vault `credentials.json` (legacy)                      | Credential IPC / recovery cleanup                | **Already ciphertext**, independent credential domain; recovery migration folds it into version 3, never plaintext                            |
| Vault `audit.json`, `pending-audit.json`               | `audit.ts`                                       | Content-free activity history; plaintext by deliberate policy                                                                                 |
| App userData `recent-vault.json`                       | `ipc.ts`                                         | Last-opened vault path; plaintext                                                                                                             |
| App userData `a11y-notebook-store.json` and `.tmp`     | `electron/store.ts`                              | Shell/sample-vault data and PDF reading preferences; plaintext, not vault-scoped                                                              |
| Cognitive asset files                                  | `assets.ts` / asset editors                      | Outline/mind-map/flashcard/grid source files; ordinary plaintext files, not metadata                                                          |
| Crash/recovery drafts                                  | No store exists                                  | Unsaved cognitive edits are memory-only; no recovery or protected draft policy ships here                                                     |

“Vault” rows refer to `.a11ynotebook/`. There is no separate `pdf-annotations.json`, `assets.json`, binary search
database or persisted recovery-key plaintext store. Existing metadata staging `pending-*.json` must also be accounted
for in any migration. Filesystem watchers and direct service/index writers make replacing only `metadata.write`
insufficient.

The **proposed**, not shipped, threat model is offline disclosure or modification of opted-in metadata when the data
key is unavailable. It excludes a compromised running app, renderer plaintext while unlocked, malicious OS-user
processes, filenames, ordinary note/asset/attachment files, exported documents and external-editor copies. This is
not whole-vault encryption. Existing plaintext copies, OS backups/snapshots and deletion remnants cannot be securely
erased by this application.

A future explicit migration should require an unlocked recovery-enabled version-3 vault with a stable random data key.
Legacy version-1/2 vaults continue unchanged unless the user explicitly migrates recovery first. Metadata keys belong
to the main process; password reset and recovery-key rotation rewrap the same data key, not independently
password-encrypted notes. No passwords or keys may be persisted for scheduled helpers. Each logical store needs a
distinct HKDF domain (`metadata:annotations`, `metadata:reminders`, `metadata:reminder-defaults`,
`metadata:flashcards`, `metadata:milestones`, `metadata:settings`, `metadata:image-alts`, `metadata:bookmarks`,
`metadata:links`, `metadata:search-index`, `metadata:asset-drafts`) and bounded authenticated envelopes binding
schema version, store identity, vault identity, generation and record identity. Audit and nonsensitive global
preferences require explicit documented exclusions; sensitive global copies must be removed or stopped.

Before implementation, introduce one authenticated generation manifest/commit point, pause all producers/watchers,
snapshot validated sources, encrypt **before** staging, and publish the complete generation atomically. On restart
choose only a fully committed generation; discard/roll back uncommitted ciphertext without silently selecting a
plaintext fallback. Persist cleanup intent and refuse to expose a partially protected vault until cleanup can finish.
After opt-in, absent, malformed or unauthenticated protected stores must fail closed while locked or on tampering;
all protected memory/index/renderer caches must clear on lock/switch. Direct startup/index/settings writers must
obey that policy before opening files. No migration or encryption toggle is exposed in this increment.

Remaining tests/implementation gates: cancellation before commit, interruption at every stage and restart,
rollback without key loss, post-commit cleanup failures, cross-store/generation substitution, nonce/bounds/tamper
rejection, recovery/password reset/rotation/revocation, data-key rotation with two-generation rollback, legacy notes,
independent note passwords, concurrent watcher/scheduler/write/lock/switch races, and absence of plaintext staging,
caches or drafts. Data-key rotation is distinct from recovery-key rotation and has no implementation yet.
