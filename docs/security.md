# Security

## What this build protects

The sandboxed renderer has no Node/Electron filesystem access. Fixed typed IPC methods check the trusted
top-level application frame. Vault and metadata paths reject traversal, absolute paths, and symlinks.
Markdown and HTML note content are sanitized in the renderer; HTML attachment previews have an empty sandbox and a default-src-none policy. The attachment
protocol serves bounded local raster, PDF, and ePub data with nosniff and no-store. PDF.js uses a bundled worker;
epub.js processes the local archive as accessible text without rendering book markup or loading remote resources.
Web capture is an explicit user action:
main-process requests require public HTTPS DNS addresses, pin an address for each request, revalidate redirects,
and bound page/image sizes.

These checks are not protection against a malicious process running as the same OS user that races filesystem
changes. Optimistic note/asset baselines reject stale writes but do not lock out external writers.
Multi-file move/link-repair rollback is best effort, not crash-atomic.

## Password locks and encrypted records

Vault password protection uses scrypt (`N=32768`, `r=8`, `p=1`, 16-byte random salt) to derive a 256-bit key in
the main process. `security.json` stores only the salt and an AES-GCM-encrypted verifier. The main process caches
the key until manual lock, configured idle timeout, vault switch, or application exit; locks clear the Buffer and
the renderer clears open notes, search results, credentials, and other content state. JavaScript cannot guarantee
that every copy in memory is erased.

Notes are encrypted only after the user selects **Encrypt note** and supplies a separate note password. Their `.md`
or `.html` file then contains a versioned AES-256-GCM envelope with a fresh 96-bit nonce, 128-bit tag, random salt and stable
record ID, and authenticated format, domain, and record ID. The note key is derived with scrypt and cached only in
main-process memory until vault lock, switch, or exit. `credentials.json` stores the encrypted credential list with a
separate HKDF key domain. Wrong passwords, malformed envelopes, and authentication failures are rejected without
returning plaintext. Renaming/moving an encrypted note preserves its record ID. The renderer never receives a derived
key.

Vault idle lock defaults to 15 minutes and can be disabled or set from 1–240 minutes. The optional unsaved-edit
timeout changes the editor to read-only and requires saving before editing again. This edit timeout is an interface
guard, not a substitute for OS-level access control.

The encryption dialog can generate a cryptographically random note password. Copying a generated password starts a
30-second clipboard timer; the app clears the clipboard only if it still contains that same password, so it does not
erase unrelated clipboard content.

## Important limitations

Vault password protection gates app IPC but **does not encrypt the whole vault**. Unmarked notes, file names,
annotations, settings, reminders, and other metadata remain plaintext. Search indexing scans ordinary Markdown and
its persisted index may contain plaintext; it is not a secure store. Encrypted note content is not searchable and
does not contribute tasks or link data. Credentials are encrypted at rest, but are decrypted into renderer memory
when the credential manager is open. Password recovery is not implemented. Losing either password makes its encrypted
records unrecoverable. Recovery keys, encrypted indexes, and whole-vault encryption are not implemented. Protect
the vault with OS account controls and disk encryption.

PDF.js renders bounded pages and provides accessible text/page navigation/search; ePub.js provides bounded spine-section
text navigation/search, not full visual reflow. The reader's text extraction is capped at 500 pages and 20 MB.
Complex PDFs/fonts/encryption and some ePub packaging/content remain unsupported. Web capture preserves common HTML
formatting and downloads only
supported raster images. Sensitive-action audit logging is not implemented. Notifications may expose reminder titles
through the OS notification UI. Clipboard auto-clear applies only to generated note passwords copied from the
encryption dialog, not arbitrary text or other secrets.
