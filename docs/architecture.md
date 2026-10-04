# Architecture

## Process model

```text
React renderer ── typed methods ── sandboxed preload ── whitelisted IPC ── Electron main
    │                                                                    ├─ vault filesystem service
    └─ semantic UI and local sanitized note rendering                     ├─ native dialogs / shell
                                                                         └─ updater controller
```

The renderer has no Node integration. `electron/preload.ts` exposes a fixed `NotebookBridge`; the main process
checks the sender's top-level frame and validates all vault-relative paths before filesystem access. Shared
contracts and serializable data types live in `src/shared/`.

The vault IPC methods are `vault:open`, `vault:get`, `vault:read-note`, `vault:save-note`,
`vault:create-notebook`, `vault:create-note`, `vault:rename`, `vault:reveal`, `vault:open-external`,
`vault:open-url`,
`vault:import`, `vault:delete`, `vault:get-tasks`, `vault:toggle-task`, `vault:get-link-index`,
`vault:get-bookmarks`, and `vault:toggle-bookmark`. Destructive delete uses an OS confirmation dialog and moves
the selected resource to the Recycle Bin. Extended channels for search, move/link repair, annotations, assets,
attachments, reminders, and settings are declared in `src/shared/ipc.ts` and mirrored by type-checked preload
constants. Only `vault:changed` and `vault:reminder-event` are subscribable vault events; listeners never receive
the raw Electron event. Updater handlers remain separate.

## Folders and data

- `electron/vault/`: filesystem-backed vault operations and IPC registration.
- `electron/`: window, preload bridge, native menus, updater, and persistence.
- `src/renderer/features/vault/`: accessible file tree, Markdown/HTML reader, source editor, and rich-text editor.
- `src/shared/`: IPC names, command registry, bridge types, and data contracts.
- `src/test/`: Vitest tests for renderer interactions and main-process logic.
- Vault folders contain notebook subfolders, `.md`/`.html` notes, and ordinary attachment files. `.a11ynotebook/` is
  reserved for readable JSON metadata including `links.json` and `bookmarks.json`; notes are not converted to a
  proprietary format. Link indexes are rebuilt from Markdown and supported HTML references when the vault is opened/refreshed or a note
  is saved.

## Adding a command or feature

Add a typed command to `src/shared/command-registry.ts` and connect it to the relevant renderer action. When a
feature needs filesystem or operating-system access, add a narrow method and fixed channel to `src/shared/bridge.ts`
and `src/shared/ipc.ts`, map it in preload, and validate its sender and inputs in the main process. Never expose
generic IPC, Node modules, or an arbitrary filesystem path to the renderer. Add interaction and security tests, and
update the user guide and roadmap to describe only working behavior.

## Context menu and note editing

The global context menu is generated from `COMMANDS` metadata in `src/shared/command-registry.ts`. Context comes
from the focused element or its `data-context` marker; the renderer supplies the selected vault path, tab, link, task,
or text selection. Shift+F10, the Applications key, and pointer context-menu events route to one menu component, which
uses the WAI-ARIA menu keyboard pattern and restores focus to its invoker. Modal dialogs suppress the app menu. Menu
context is presentation state only; filesystem access still uses fixed IPC channels and main-process validation.

`.md` and `.html` files are editable notes. HTML is sanitized with DOMPurify in the renderer on read, render, paste,
and save. Script-capable and embedded elements, forms, event handlers, remote image sources, and unsafe URI schemes
are removed; local raster image references use the vault attachment protocol and require alt text. Markdown source
remains a native textarea. Rich-text editing uses a labelled multiline contenteditable and a one-tab-stop toolbar;
Markdown content is converted to and from a supported semantic HTML subset while in this mode. Format conversion
creates a sibling note only after a warning; the original is kept. This avoids destructive conversion but does not
provide complete loss analysis or in-place path/metadata migration. Full HTML checklist/task/template/export integration remains incomplete.

## Indexes, synchronization, and transactions

`electron/vault/search.ts` owns a versioned, atomically persisted inverted index with startup freshness checks.
Changed documents update postings without rereading unchanged bodies. Markdown and bounded text/CSV/HTML/PDF/ePub
extraction are supported; other formats have filename-only records. Queries and filters are validated in main. The renderer
debounces queries and receives only results, never scans all note bodies.

`watcher.ts` uses recursive Windows/macOS `fs.watch`, with per-directory fallback, hidden-path exclusion,
debounce, and cleanup on vault switch/quit. Search refresh precedes a change event; the renderer then refreshes
tree/tasks/links and compares open notes. `useVaultChanges` preserves dirty content and pauses autosave. Renderer
saves include their saved-content baseline for optimistic conflict detection. This is not an atomic lock against
another process writing between the comparison and the write.
Note edits and task toggles write a checked same-directory temporary file before atomic replacement, preserving
the original if a write fails partially. Vault opening pauses editing; stale refresh responses are ignored.

Moves use main-process validation, a native affected-note confirmation, source-content preflight, and explicit
rewrites of unambiguous wiki/inline-relative links (including moved notes' outgoing references). Metadata paths
are migrated. Errors attempt rollback without overwriting a note changed externally; multi-file operations are
not crash-atomic. Keep a backup before a large link-repair operation.

## Feature boundaries and metadata

Renderer modules live under `features/editor`, `annotations`, `templates`, `reminders`, `assets`, `previews`,
`settings`, and `search`; hooks coordinate status announcements and vault events. `src/shared/assets.ts` provides
an extensible suffix-based registry and pure serialization/scheduling functions. It does not load executable plugins.

`annotations.json` stores versioned labelled quote/context/offset anchors associated with paths.
`reminders.json` stores standalone reminders and task delivery/snooze state. A main-process scheduler persists
delivery before native notifications, reschedules on startup, and stops on vault switch. No background OS service
is installed. `flashcards.json` maps deck paths and question/answer fingerprints to SM-2-style schedules.
`image-alts.json` stores image descriptions. `settings.json` stores appearance/autosave/shortcut overrides, with
app userData defaults. Metadata operations reject symlink directories/files and atomically replace JSON.

The `vault-file://attachment/` protocol serves bounded, validated raster images and local PDF/ePub bytes with
no-store/nosniff. HTML attachment previews are sanitized and put into a sandboxed srcdoc frame. PDF.js runs with a
bundled local worker, renders pages, extracts accessible text, and provides page navigation and text search. The
epub.js reader parses the local archive and presents spine sections as searchable accessible text without executing
book markup or loading its remote resources. Both readers reject files over 40 MB and bound text extraction. PDF/ePub
visual refinements, EPUB reflow/TOC navigation, zoom, selection, and annotations remain incomplete. The earlier
bounded main-process extractors are retained for input validation; ePub's XML parser is overridden to patched
`@xmldom/xmldom` 0.8.15. User-initiated web capture accepts public HTTPS destinations, pins resolved public IPs for requests,
limits response/image sizes and redirects, strips active HTML, and stores downloaded raster images as attachments.

`electron/vault/security.ts` derives vault and per-note keys with scrypt and encrypts selected notes and the credentials
store with AES-256-GCM. Unlocked keys remain only in main-process memory and are cleared on vault lock or switch.
Typed IPC gates vault operations when password protection is enabled and the vault is locked. Idle lock and
unsaved-edit lock delays are validated settings.
Password protection is an access lock, not whole-vault encryption: unmarked notes, the search index, other metadata,
and filesystem names remain plaintext. Individually encrypted notes use separate scrypt-derived passwords. Full
PDF.js/ePub.js fidelity and guaranteed memory erasure are not provided.
