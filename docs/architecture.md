# Architecture

## Process model

```text
React renderer ── typed methods ── sandboxed preload ── whitelisted IPC ── Electron main
    │                                                                    ├─ vault filesystem service
    └─ semantic UI and local Markdown rendering                           ├─ native dialogs / shell
                                                                         └─ updater controller
```

The renderer has no Node integration. `electron/preload.ts` exposes a fixed `NotebookBridge`; the main process
checks the sender's top-level frame and validates all vault-relative paths before filesystem access. Shared
contracts and serializable data types live in `src/shared/`.

The vault IPC methods are `vault:open`, `vault:get`, `vault:read-note`, `vault:save-note`,
`vault:create-notebook`, `vault:create-note`, `vault:rename`, `vault:reveal`, `vault:open-external`,
`vault:import`, `vault:delete`, `vault:get-tasks`, `vault:toggle-task`, `vault:get-link-index`,
`vault:get-bookmarks`, and `vault:toggle-bookmark`. Destructive delete uses an OS confirmation dialog and moves
the selected resource to the Recycle Bin.

## Folders and data

- `electron/vault/`: filesystem-backed vault operations and IPC registration.
- `electron/`: window, preload bridge, native menus, updater, and persistence.
- `src/renderer/features/vault/`: accessible file tree and Markdown reader/editor.
- `src/shared/`: IPC names, command registry, bridge types, and data contracts.
- `src/test/`: Vitest tests for renderer interactions and main-process logic.
- Vault folders contain notebook subfolders, `.md` notes, and ordinary attachment files. `.a11ynotebook/` is
  reserved for readable JSON metadata including `links.json` and `bookmarks.json`; notes are not converted to a
  proprietary format. Link indexes are rebuilt from Markdown source when the vault is opened/refreshed or a note
  is saved.

## Adding a command or feature

Add a typed command to `src/shared/command-registry.ts` and connect it to the relevant renderer action. When a
feature needs filesystem or operating-system access, add a narrow method and fixed channel to `src/shared/bridge.ts`
and `src/shared/ipc.ts`, map it in preload, and validate its sender and inputs in the main process. Never expose
generic IPC, Node modules, or an arbitrary filesystem path to the renderer. Add interaction and security tests, and
update the user guide and roadmap to describe only working behavior.
