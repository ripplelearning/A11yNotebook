# Security

## What this build protects

The sandboxed renderer has no Node/Electron filesystem access. Fixed typed IPC methods check the trusted
top-level application frame. Vault and metadata paths reject traversal, absolute paths, and symlinks.
Markdown and HTML note content are sanitized in the renderer; HTML attachment previews have an empty sandbox and a default-src-none policy. The attachment
protocol serves bounded local raster, PDF, and ePub data with nosniff and no-store. PDF.js uses a bundled worker;
epub.js processes the local archive as accessible text without rendering book markup or loading remote resources.
Web capture is an explicit user action:
main-process requests require public HTTPS DNS addresses, pin an address for each request, revalidate redirects,
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

Notes are encrypted only after the user selects **Encrypt note** and supplies a separate note password. Their `.md`
or `.html` file then contains a versioned AES-256-GCM envelope with a fresh 96-bit nonce, 128-bit tag, random salt and stable
record ID, and authenticated format, domain, and record ID. The note key is derived with scrypt and cached only in
main-process memory until vault lock, switch, or exit. Legacy `credentials.json` stores its encrypted list with a
separate HKDF key domain; recovery-enabled version-2 vaults keep the authenticated credential envelope in
`security.json` so credentials and wrapped keys share one atomic migration boundary. Wrong passwords, malformed
envelopes, and authentication failures are rejected without returning plaintext. Renaming/moving an encrypted note
preserves its record ID. The renderer never receives a derived key.

### Opt-in vault recovery

Recovery is optional and is not silently enabled when opening a legacy vault. An unlocked user must confirm the current
vault password, generate a recovery key, save it independently, and explicitly acknowledge that it was saved. The
one-time key is displayed in an accessible read-only field; it is not written to metadata, logged, or copied to the
clipboard automatically. The renderer handles the recovery secret only for explicit saving or user-initiated recovery;
derived keys and the random vault data key remain in the main process.

Recovery migration writes a version-2 `security.json` containing a fresh random 256-bit data key wrapped separately by
the scrypt-derived password key and the high-entropy random recovery key. AES-256-GCM uses fresh nonces, authenticated
version/domain/record identifiers, and independent HKDF domains. The configuration authenticates its credential
envelope and a wrapped copy of the prior vault key, preserving credentials and legacy vault-key-encrypted notes. The
credential envelope and key wrappers share one atomically replaced JSON file as the migration commit boundary; legacy
credential ciphertext is removed only after that commit. If the initial write fails, the version-1 security record and
credentials remain unchanged. If cleanup is interrupted after commit, the vault is locked and reopening retries removal
before exposing the vault. No plaintext export is part of migration.

Recovery unlock requires the recovery key and a new vault password. The new password wrapper is atomically committed
before the vault unlocks; the previous password is rejected afterward. The same authenticated flow supports recovery-key
rotation and revocation after current-password confirmation. Keep recovery keys private and separate from the vault.
Recovery resets only the vault password: notes encrypted with their own independent passwords remain unrecoverable
without those note passwords. Recovery is not whole-vault encryption, and it does not protect ordinary files or
plaintext metadata from direct filesystem access.

Vault idle lock defaults to 15 minutes and can be disabled or set from 1–240 minutes. The optional unsaved-edit
timeout changes the editor to read-only and requires saving before editing again. This edit timeout is an interface
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
Encrypted indexes, sensitive-action audit logging, and whole-vault encryption are not implemented. Protect the vault
with OS account controls and disk encryption.

PDF annotation paths are validated inside the current vault, including symlink
checks. Quotes, context, labels, and comments are stored in plaintext metadata
for ordinary PDFs; a vault password gate is **not** metadata encryption.
Protected-content checks reject annotation access that would expose protected
plaintext. Whole-vault and annotation-metadata encryption remain unimplemented.

PDF.js renders one bounded-scale canvas page with selectable text and stable
canonical-range annotation mapping. Changed file hashes require explicit
reconfirmation; unresolved notes keep their original quotes rather than being
silently moved or discarded. ePub.js provides bounded flattened spine-section text navigation/search,
not styled reflow, TOC rendering, or annotation UI. The reader's text extraction is capped at 500 pages and 20 MB.
Complex PDFs/fonts/encryption and some ePub packaging/content remain unsupported. Web capture preserves common semantic
HTML and downloads only supported raster images. HTML task IDs and scheduling metadata are ordinary note content and
are not a security boundary. Sensitive-action audit logging is not implemented. Notifications may expose reminder titles
through the OS notification UI. Clipboard auto-clear applies only to generated note passwords copied from the
encryption dialog, not arbitrary text or other secrets.
