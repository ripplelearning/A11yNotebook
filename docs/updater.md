# In-app updater design

A11y Notebook checks for and installs new versions through **Help → Check for Updates**. Updates come only from
the GitHub Releases of [`ripplelearning/A11yNotebook`](https://github.com/ripplelearning/A11yNotebook/releases) and
are never downloaded or installed without the user's explicit choice.

## Components

| File                                       | Process  | Responsibility                                                                                                |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| `src/shared/updater.ts`                    | shared   | `UpdaterStatus` type, runtime validation, release-note summarising, error formatting, announcement wording.   |
| `src/shared/ipc.ts`                        | shared   | The fixed IPC channel names and whitelists (`INVOKE_CHANNELS`, `MENU_COMMANDS`).                              |
| `src/shared/bridge.ts`                     | shared   | Type of the API exposed on `window.a11yNotebook`.                                                             |
| `electron/updater-controller.ts`           | main     | Update state machine (`idle → checking → available → downloading → downloaded`). Unit tested.                 |
| `electron/updater.ts`                      | main     | Configures `electron-updater`, forwards its events to the controller, registers the whitelisted IPC handlers. |
| `electron/preload.ts`                      | preload  | Maps the narrow typed API onto IPC. Runs sandboxed and imports nothing but `electron`.                        |
| `electron/menu.ts`                         | main     | Native Windows menu. Its Help items forward whitelisted commands to the renderer.                             |
| `src/renderer/hooks/useUpdater.ts`         | renderer | Subscribes to status updates, validates them, and throttles progress announcements.                           |
| `src/renderer/components/UpdateDialog.tsx` | renderer | Accessible modal dialog for every updater state.                                                              |

`src/shared` never imports Node or Electron, so it is safe for the renderer.

## Renderer API (the whole IPC surface)

```ts
window.a11yNotebook.updater.check(): Promise<void>
window.a11yNotebook.updater.download(): Promise<void>
window.a11yNotebook.updater.installNow(): Promise<void>
window.a11yNotebook.updater.installOnExit(): Promise<void>
window.a11yNotebook.updater.onStatus(callback): () => void  // returns unsubscribe
window.a11yNotebook.onMenuCommand(callback): () => void      // native Help menu items
```

There is no generic `invoke`/`send`, the renderer never provides a channel name, and none of the methods take
arguments. Callbacks receive only the payload, never the raw `IpcRendererEvent`.

| Channel                   | Direction       | Payload                                                            |
| ------------------------- | --------------- | ------------------------------------------------------------------ |
| `updater:check`           | renderer → main | none                                                               |
| `updater:download`        | renderer → main | none                                                               |
| `updater:install-now`     | renderer → main | none                                                               |
| `updater:install-on-exit` | renderer → main | none                                                               |
| `updater:status`          | main → renderer | `UpdaterStatus`                                                    |
| `menu:command`            | main → renderer | `'check-for-updates' \| 'show-keyboard-shortcuts' \| 'show-about'` |

## Message flow

1. The user chooses **Help → Check for Updates**. It is in the in-app Help menu, in the native Windows Help menu,
   and in the command palette (`check-for-updates` in the shared command registry).
2. The renderer opens the **Software update** dialog and calls `updater.check()`.
3. The main process checks that the sender is the application's own top-level frame, then calls
   `autoUpdater.checkForUpdates()`.
4. The main process sends statuses to the renderer:

| State                  | Payload                                                | Dialog content                                                                 |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `checking`             | —                                                      | "Checking GitHub…" and **Close**                                               |
| `update-available`     | `version`, `releaseName?`, `releaseNotes` (plain text) | New version, current version, release-note summary, **Download** / **Not now** |
| `update-not-available` | current `version`                                      | "You are using the latest version" and **Close**                               |
| `download-progress`    | `percent` (0–100 integer)                              | Progress bar and **Hide** (the download continues)                             |
| `update-downloaded`    | `version`                                              | **Restart and install** / **Install on exit**                                  |
| `unsupported`          | `message`                                              | Explanation (development or portable build) and **Close**                      |
| `error`                | readable `message`                                     | Alert with the message, **Try again** / **Close**                              |

5. **Download** calls `autoUpdater.downloadUpdate()`. The controller refuses to download unless an update was
   reported as available.
6. **Restart and install** calls `autoUpdater.quitAndInstall(false, true)`: the installer runs and A11y Notebook
   restarts. **Install on exit** sets `autoInstallOnAppQuit = true`, so the update is installed when the user exits.

## Security decisions

- **User consent.** `autoDownload = false` and `autoInstallOnAppQuit = false` until the user picks
  **Install on exit**. There are no background checks.
- **Fixed feed.** The packaged app pins the feed with
  `setFeedURL({ provider: 'github', owner: 'ripplelearning', repo: 'A11yNotebook' })`, which matches the
  `publish` block in `electron-builder.yml`. The renderer cannot change the feed URL.
- **No downgrades or prereleases.** `allowDowngrade = false` and `allowPrerelease = false`.
- **No tokens.** Public GitHub releases can be read without authentication. The app has no token and logs none.
  Only the release workflow uses a token (`GITHUB_TOKEN`), and only in CI.
- **Narrow bridge.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload script can
  only reach the fixed channels.
- **IPC validation.** The main process registers handlers only for `INVOKE_CHANNELS`. Each handler checks that the
  sender is the main window's top-level frame loaded from the app's own `file://` entry point (or the local dev
  server during development), and it ignores any arguments.
- **Untrusted content is text only.** GitHub release notes are HTML. They are turned into short plain text in the
  main process (`summarizeReleaseNotes`) and rendered by React as text, never as HTML. The renderer also checks
  every incoming status with `isUpdaterStatus` and drops anything malformed.
- **Hardened window.** The production renderer has a strict Content Security Policy. New windows are denied (links
  to this repository open in the default browser), navigation away from the app is blocked, `<webview>` is
  blocked, and permission requests are denied.

## Code signing

Sign production releases.

- Unsigned installers trigger Windows SmartScreen ("Windows protected your PC") and have no publisher identity.
- When the installer is signed (set `CSC_LINK` / `CSC_KEY_PASSWORD` in the release workflow, see
  `.github/workflows/release.yml`), electron-builder writes the certificate's publisher name into
  `app-update.yml`. `electron-updater` then **checks that every downloaded update is signed by the same
  publisher** before installing it, and rejects it otherwise.
- **Unsigned development builds still download and install updates**, but no signature check happens. The only
  protection is HTTPS to GitHub and the SHA-512 checksum in `latest.yml`. That is fine for personal testing but
  **not safe for production distribution**.

## Development and portable builds

- When the app is not packaged (`npm run dev`), the updater never contacts GitHub. Check for Updates reports
  "Updates are only available in the installed build."
- The portable `.exe` cannot update itself. Check for Updates tells the user to download the latest installer from
  the Releases page.

## Accessibility

- The dialog is a real modal: `role="dialog"`, `aria-modal="true"`, labelled by its heading and described by its
  main message. Focus moves into it when it opens, Tab and Shift+Tab stay inside it, Escape closes it, and focus
  returns to the control that opened it.
- When the dialog's state changes, focus moves to the new main button, so focus never falls back to the page body.
- Progress uses `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext`.
  A polite live region announces it every 10 percent, not on every progress event.
- While the dialog is open, it makes the announcements. Once it is closed (for example with **Hide** during a
  download), the status bar's polite live region takes over. The two are never used at the same time, so
  nothing is spoken twice.
- Errors use `role="alert"` and appear as text in the dialog, so they never rely on color alone.
- Button names are clear and unique within each state.

## Limitations

- `electron-updater` only sees **published GitHub Releases**. Pushing commits to `main` does nothing until a
  version tag (`vX.Y.Z`) is pushed and the release workflow publishes it.
- The version in `package.json` must be higher than the installed version, and the tag must match it (the
  release workflow enforces this).
- Only the Windows NSIS installer supports in-app updates. macOS and Linux targets are not set up yet.
