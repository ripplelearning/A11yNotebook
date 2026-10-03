# Security

## What this build protects

The sandboxed renderer has no Node/Electron filesystem access. Fixed typed IPC methods check the trusted
top-level application frame. Vault and metadata paths reject traversal, absolute paths, and symlinks.
Markdown/HTML are sanitized; HTML previews have an empty sandbox and a default-src-none policy. The image
protocol allows only bounded local raster files, never executable HTML/SVG. There is no generic IPC or remote
resource fetch API. Updater channels and their user-consent flow remain separate.

These checks are not protection against a malicious process running as the same OS user that races filesystem
changes. Optimistic note/asset baselines reject stale writes but do not lock out external writers.
Multi-file move/link-repair rollback is best effort, not crash-atomic.

## No confidentiality or password protection yet

**Vault passwords, editing locks, idle auto-lock, encrypted notes, an encrypted credentials store, clipboard
auto-clear, password generation, and sensitive-action audit logging are not implemented.** No UI control pretends
to enable them. All ordinary notes, extracted search text, annotations, reminders, settings, and schedules are
plaintext. The search index can contain note text even after editing; do not treat it as a secure store.
Do not keep passwords or other secrets in this build. Protect the vault with OS account controls and appropriate
disk encryption/backups. Notifications expose reminder titles through the Windows notification UI.

## Proposed encryption design — not implemented or validated

A future implementation needs a reviewed format and threat model before shipping:

- Derive a per-vault key in the main process with Node `crypto.scrypt`, a random per-vault salt, and versioned,
  bounded work parameters in `security.json`. Validate parameters before allocation/derivation.
- Authenticate an encrypted verifier rather than storing a password or reversible plaintext verifier. Wrong
  passwords and corrupted authentication tags must fail without writing files or returning partial plaintext.
- Use AES-256-GCM with a fresh random 96-bit nonce for every encryption and a 128-bit authentication tag.
  Authenticate format version and stable record identity as additional authenticated data. Renames must not
  silently invalidate identity or reuse nonces.
- Separate keys/record domains for notes and credentials. Keep derived keys in main only; decrypt selected
  notes in memory. Never put decrypted encrypted-note text in the persisted search cache, temp files, backups,
  logs, or crash reports. A reviewed in-memory search strategy is needed.
- Locking must clear main key buffers and renderer decrypted documents, cancel autosave/pending sensitive
  operations, require reauthentication for editing, and stop timers leaking protected content. JavaScript
  garbage collection cannot promise complete memory erasure; document that limitation.
- Audit only action names, record identifiers, timestamps, and outcomes, never passwords, key bytes, note
  plaintext, or credential values. Clipboard clearing must only clear the value this app copied, without
  erasing newer clipboard contents from another app.
- Test wrong passwords, tampering, nonce/key separation, interrupted writes, rename/move migration, startup,
  idle-lock races, clipboard replacement, and renderer/key isolation. App locking alone is not disk encryption.

This design is a roadmap constraint, not a security guarantee. There are deliberately no partial crypto helpers
or credential-entry widgets in the current build.
