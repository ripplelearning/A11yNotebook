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

## Updater renderer API

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

The renderer also receives a separate fixed library API for selecting/reading/writing library resources. Its channels
are registered by `electron/vault/ipc.ts`; it accepts relative paths only and resolves them against the active
library. It does not expose generic IPC or Node filesystem methods. See [architecture](architecture.md) for the
library-specific operations and their data model. Internal `vault` identifiers remain compatible.

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

Sign production releases. The workflow currently permits explicitly labelled unsigned stable releases when
certificate secrets are absent; that capability is not evidence of production readiness.

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
  release workflow enforces this). `package.json` and `package-lock.json` use plain semver such as `1.1.3`; only
  the git tag carries the `v` prefix (`v1.1.3`).
- Only the Windows NSIS installer supports in-app updates. macOS targets (dmg, zip) ship unsigned, so macOS
  in-app updates do not run; Mac users download new releases from the release page and install via right-click
  → Open until signing is set up.

## Preparing a downloadable Windows release candidate

The version-specific preparation notes below are historical and are not current release instructions.
Current `main` is at package version `1.1.6`; [Release run #9](https://github.com/ripplelearning/A11yNotebook/actions/runs/39716156648)
failed its stable desktop gate. UI Automation hit an empty `$PSScriptRoot` while binding its default executable path,
and the installed-upgrade check rejected the Windows product version `1.1.1.0` against expected `1.1.1`.
The immutable `v1.1.4` tag points to
`7e67edcb4ccfb7ae97c86600b9097e90a05dfdb9`: rerunning it cannot pick up this fix.
[Release run #7, attempt 2](https://github.com/ripplelearning/A11yNotebook/actions/runs/39676673070)
passed the duplicate-release gate but stopped before packaging: 88 test files passed and the
PDF annotation consent/encrypted-move/recovery case hit its implicit 5-second deadline.
Its reported 5466 ms duration does not identify exact body time or the slow operation.

That case now uses the adjacent recovery case's explicit 30-second integration budget.
It performs six real async scrypt derivations (N=32768, r=8, p=1, maxmem=64 MiB), plus
durable encrypted-storage, audit and move operations. An isolated Linux/Node 24 trace measured
1717 filesystem requests with 266 ms summed request latency in the captured trace,
including setup/import work (not a complete per-body filesystem accounting).
Temporary callback instrumentation on Node 22 measured all six KDFs at 74.2–76.4 ms each
(452 ms total); with five related files running and one libuv worker per process, those
requests took 85.6–115.4 ms each (581 ms total). Instrumentation was removed after measuring.
These are not Windows failure instrumentation: CPU/worker
contention and libuv queueing are plausible contributors, not an established precise cause.
CI and Release both use Node 22, Windows and the same isolated `npm test` configuration.
Closely related metadata-pointer, recovery-primitive and encrypted IPC lifecycles with four
or more sequential password derivations now have the same scoped budget; shorter cases keep
their defaults. PDF IPC teardown awaits the test body even after timeout, then actual service
disposal before deleting fixtures, under a separate 30-second hook deadline instead of a sleep.
No production KDF, assertions, global timeout, isolation or retry policy is changed.
See the [prior release-preparation assessment](#113-release-preparation-assessment-2026-10-21) for historical
evidence only; it does not validate `1.1.5`. Publication still requires new CI and exact-tag release checks.
Do not retag old commits or replace existing releases.
Manual screen-reader validation is a **promotion** gate, not a prerequisite for providing a test executable.
Signing happens during the build; it does not require installation on the tester's PC.

After release preparation is reviewed and merged through normal branch protection:

1. Check out the merged source. Before `npm ci`, run `node scripts/verify-release.mjs package`.
   This dependency-free check requires no tag and uses the same package/lockfile validation as release checks.
   Package versions must be `X.Y.Z` or `X.Y.Z-rc.N`, without a `v` prefix; both lockfile version fields must match.
   Ensure the selected version, tag and release are unused. If an RC is desired, choose an unused `X.Y.Z-rc.N`
   and update both package files in a reviewed change first; do not tag stable package contents as an RC.
2. Only after readiness checks and explicit publication approval, an authorized maintainer creates and pushes
   the **new** `v<package-version>` tag on the exact merged commit.
   Tag pushes trigger publication, not a dry run. No tag is created or pushed by this preparation work.
3. The Release workflow checks out that exact tag, verifies its commit and package version,
   requires ancestry in `main`, and refuses to overwrite an existing release. The commands
   `node scripts/verify-release.mjs tag <tag>` and `node scripts/verify-release.mjs artifacts <tag>`
   still require an existing tag on the exact checkout; package-only validation does not bypass them.
   If execution needs to be retried **before publication**, an authorized maintainer can dispatch `release.yml`
   from reviewed `main` with its `tag` input set to the existing tag. This can publish; never dispatch it as a test.
   The dispatch ref selects the reviewed workflow; its checkout still uses the exact release tag.
   Do not retry publication over a partial/existing release: inspect it and use a new version/tag if needed.

   Desktop validation does not gate publication. The Windows desktop UI Automation and
   installed-upgrade checks require an interactive Windows desktop and cannot run on
   GitHub-hosted runners (session 0), so the workflow runs them, records their outcomes in
   `desktop-validation.json`, and discloses any failures in the workflow summary and the
   release notes. Publication proceeds once every other gate passes (build, tests,
   signing, tag, ancestry, checksum, and publication-safety checks are never waived).
   Failed and not-run desktop checks remain failures on record; run them on a real
   Windows desktop before production promotion. Tag pushes and manual dispatches behave
   identically; dispatching `release.yml` only needs the `tag` input:

   ```sh
   gh workflow run release.yml --repo ripplelearning/A11yNotebook --ref main -f tag=vX.Y.Z
   ```

   The dispatch ref selects the workflow definition, but the workflow checks out the exact commit named by `tag`.
   Dispatching from updated `main` with an older tag does **not** make that tag use newer PowerShell smoke scripts.
   To exercise a fix in the release scripts, use a new reviewed, merged commit with a new matching package version
   and unused tag; never move or replace an existing tag. If a prior run left a partial release, inspect it first
   and do not overwrite its assets; prepare a new version/tag when recovery requires different build contents.

   After normal review, merge and passing Windows/Ubuntu CI, choose a new plain-semver version higher than the
   current package version, then verify that both its tag and release are unused. These placeholders are not
   publication approval:

   ```sh
   VERSION='X.Y.Z' # replace with the reviewed, unused version
   TAG="v$VERSION"
   git fetch origin main --tags
   git checkout --detach <reviewed-merged-SHA>
   git merge-base --is-ancestor HEAD origin/main
   node scripts/verify-release.mjs package
   git ls-remote origin "refs/tags/$TAG"
   gh api --paginate repos/ripplelearning/A11yNotebook/releases --jq '.[].tag_name'
   ```

   Stop if any check fails, the package version does not match the selected version, the tag lookup returns a ref,
   or the release list already contains `$TAG` (including a draft). Only after review and explicit publication
   approval may an authorized maintainer create and push that **new** tag on the merged commit:

   ```sh
   git tag "$TAG" <reviewed-merged-SHA>
   git push origin "refs/tags/$TAG"
   ```

   The tag push is the normal publication entry point. If that event did not run, the supported
   manual alternative is `gh workflow run release.yml --repo ripplelearning/A11yNotebook --ref main -f tag="$TAG"`
   with the existing exact merged tag; the desktop-failure override is not set and defaults to false. Do not
   dispatch a branch as the tag input or run both routes
   concurrently. Never pre-create an empty release, move/delete `v1.1.4`, delete releases or overwrite assets.
   This agent preparation cannot create/push tags or promise publication.
   A successful PR/CI build is not release success: wait for the matching Release run to succeed,
   inspect its provenance, download the actual release assets and verify `SHA256SUMS.txt`.
   Packaging, signing status, desktop checks and downloadable assets remain unverified until then.

4. The Windows job runs typecheck, lint, tests, release-tool formatting, generated-document drift checks, build and packaging
   without publishing. It requires nonempty installer, portable, blockmap and channel metadata; verifies the
   metadata's version, installer name, size and SHA-512; and rejects cross-channel metadata.
   RC builds produce `rc.yml`, **not `latest.yml`**, and publish with `--prerelease --latest=false`.
   Existing stable installations retain `allowPrerelease = false`; they will not offer this RC.
5. With owner-provisioned `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` repository secrets, packaging
   requires signing and verifies Authenticode on the installer, portable and unpacked app.
   Without the certificate, both RC and stable builds are explicitly **UNSIGNED**; the workflow verifies `NotSigned`.
   Stable publication requires passing desktop checks by default; only the explicit manual workflow override above
   can waive those checks. Signed production distribution remains recommended;
   unsigned publication does not satisfy signed-updater/publisher validation. Never send credentials in chat.
6. Desktop UI Automation and disposable installed-upgrade smoke checks run on Windows. Their actual outcomes
   are attached as `desktop-validation.json`, including failures and not-run outcomes (hosted runners may lack a usable
   desktop). An RC remains downloadable if these desktop checks fail; stable publication is blocked unless the
   explicit manual override is used. An override is a recorded exception, not a passing result.
   These are not JAWS/NVDA/Narrator tests, and installer-over-install is **not** full updater E2E.
7. The workflow retains downloadable Actions artifacts, then creates a new GitHub prerelease with installer,
   portable executable, update metadata, `SHA256SUMS.txt`, `signatures.json`, `desktop-validation.json` and
   `provenance.json` (exact commit/tag and run URL). Use the release page and verify the attached checksums
   before running downloaded executables. Publication verifies asset sizes against the local build.

Preparation does not publish candidate assets. For testing before merge, approve the PR's Windows CI run
and download its `windows-test-build` Actions artifact.
That artifact records the actual tested commit (which can be a PR merge commit), not a release tag; it is explicitly
a CI test build rather than evidence that the exact-tag release flow passed.

### Remaining production-promotion checks

- Test the downloaded candidate with JAWS, NVDA, Narrator, forced colors and normal Windows desktop workflows.
- Inspect signing results and publisher identity. An unsigned RC is not a signed production release.
- Exercise a real **consented updater** transition from a prior signed installed version to a higher signed
  stable release, including download, restart/install, persistence and same-publisher enforcement.
  The RC cannot be offered to stable users without changing the prerelease policy, which this work deliberately
  does not do. Unit tests of consent and signature settings, or running an installer over an existing install,
  do not prove this full updater path. Do not disable signature verification or use real user libraries.
- Review any failed Windows desktop checks recorded in the release artifacts before production promotion.

Whole-library encryption and unrelated roadmap features are not requirements for distributing this test candidate.

## 1.1.3 release-preparation assessment (2026-10-21)

**NO-GO for publication.** Main CI is green, but this is release preparation, not approval to ship.
No release workflow was dispatched, no release was published, and no remote tag was created.

### Brief maintenance notes

- [#48](https://github.com/ripplelearning/A11yNotebook/pull/48) rejects `v`-prefixed package versions,
  including both lockfile version fields; release tags retain the `v` prefix.
- [#49](https://github.com/ripplelearning/A11yNotebook/pull/49) migrates GitHub Actions to Node 24-capable
  action versions and pins Ubuntu CI to `ubuntu-24.04`. The **action runtime** is separate from the
  **project Node version**: CI and Release still request Node 22 via `setup-node`.
- This preparation adds the shared validator's package-only CLI check before dependency installation on both
  CI platforms, with CLI regression coverage; it does not change exact-tag checks or publication gates.

### Verified upstream evidence

Latest `main` at inspection: `8191dc55240286202bffd955dbc4bf8eb8d221f8` (merge of #49).
[CI #195](https://github.com/ripplelearning/A11yNotebook/actions/runs/39545977736) explicitly concluded **success**:

| Job                                                                                                      | Conclusion | Verified scope                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| [Ubuntu 24.04](https://github.com/ripplelearning/A11yNotebook/actions/runs/39545977736/job/119044123775) | success    | Dependency install, typecheck, lint, 1,030 tests (including 5 release-validation tests), build     |
| [Windows](https://github.com/ripplelearning/A11yNotebook/actions/runs/39545977736/job/119044124131)      | success    | Same checks, non-publishing installer/portable packaging, provenance/SHA-256 generation and upload |

Both jobs tested that exact SHA and used project Node `22.23.3`. Complete job logs contained no emitted Node 20
deprecation or runner-image migration warning; this does not assert that every repository workflow was exercised.
Windows-only steps were **skipped** on Ubuntu, not passed. Windows signatures and desktop checks were **not run**
by this CI workflow. The [Windows test build](https://github.com/ripplelearning/A11yNotebook/actions/runs/39545977736/artifacts/12321389292)
is not an exact-tag release candidate. Build logs retain a Vite large-chunk warning.

The uploaded Windows ZIP was downloaded without executing its binaries. Its SHA-256 matched the upload log
(`ab91cfd9b2e397c92c3ed815dba3d63e13e14867ecb97c36b5781420e0c275b9`); every entry in its
`SHA256SUMS.txt` matched, and provenance recorded the main SHA above with `releaseTag: null`.
The shared `verifyArtifacts` validator passed on its actual installer, portable, blockmap and `latest.yml`,
including installer size and SHA-512 metadata. This is real CI artifact validation, not a fixture test,
but does not exercise the exact-tag artifacts CLI's signature/provenance path.

The complete current listings (7 tags, 5 releases; no further pages) contain tags `v0.1.0`, `v1.1.0`,
`1.1.1`, `v1.1.1`, `v1.1.2-rc.2`, `1.1.2-rc.3`, `v1.1.2`, and releases `v1.1.0`, `1.1.1`,
`v1.1.1`, `1.1.2-rc.3`, `v1.1.2`. Neither `1.1.3` nor `v1.1.3` exists as a tag/release.
Keep the already intended package version `1.1.3`; no speculative bump or historical retagging is needed.
Recheck history immediately before any later publication.

Open-issue listing and related version-format/runtime-migration issue search returned **no actual issues**.
#48 and #49 are merged PRs, linked above. Unrelated open PRs #5, #24 and #34 remain untouched;
there is no verified issue closure to perform.

### Local preparation checks

On Linux with Node `24.21.0` (not the workflow's project Node 22), the changed working tree passed:
targeted release-validation tests (6), full tests (89 files, 1,031 tests), typecheck (both configs), lint,
repository-wide `format:check`, build, and generated-shortcut drift verification.
`node scripts/verify-release.mjs package` also passed directly.
Windows packaging was not repeated locally; the Windows results above come from the identified upstream job.

At preparation commit `1b2c624eb55a5fd0603082028788d0179919610c`, both the package CLI and
`node scripts/verify-release.mjs tag v1.1.3` passed with a temporary local tag on that exact clean checkout.
The tag was deleted immediately and never pushed; it was not a published candidate.
The artifacts CLI with that tag correctly failed on missing local release files, not an end-to-end pass.
Actual upstream artifacts were checked separately as recorded above; signature/desktop evidence remains absent.

### Outstanding evidence before publication

- Merge this preparation and confirm both CI job conclusions for the new merged SHA; upstream results above
  do not cover these new changes.
- Review dependency advisories: local locked `npm ci` / `npm audit` reported 14 existing advisories
  (8 moderate, 4 high, 2 critical), including direct `markdown-it`, `vite` and `concurrently` findings.
  No dependencies were changed here; resolve or explicitly assess these before production distribution.
- On Windows, run non-publishing packaging for the selected exact source, verify Authenticode status under the
  configured signing policy, then validate actual installer/portable/blockmap/channel metadata and hashes.
  Record exact source and results. This Linux editing environment cannot execute Windows binaries,
  Authenticode, UI Automation or installed-upgrade checks; they remain **blocked/not run locally**.
  Existing PR Windows CI supplies a safe non-publishing build route, but not all release gates.
- Obtain passing Windows desktop UIA and installed-upgrade outcomes; do not bypass stable promotion gates.
  Complete and record JAWS, NVDA, Narrator, keyboard-only, enlarged-text and forced-colors acceptance using the
  [accessibility checklist](accessibility/acceptance-checklist.md).
- Record a real consented installed-updater transition, persistence and same-publisher enforcement as described
  above. Fixture/unit tests and installer-over-install smoke are **not full updater E2E**.
- Only after blockers are cleared and an authorized maintainer approves publication, select the unused exact
  merged version tag and run the release process. Verify attached provenance, signatures, checksums and assets;
  never overwrite a partial release.
