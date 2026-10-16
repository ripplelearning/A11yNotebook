# Contributing

## Checks

Use Node.js 22 or later. Run `npm ci`, then `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
and `npm run build`.

Windows packaging (`npm run package:win`, which does not publish) must run on Windows. Its `beforePack` hook uses
the Windows .NET Framework C# compiler to build `native/windows/OpenWith.cs`, then bundles the executable under
`resources/native/`. No helper binary is checked in, and the application never compiles or launches shell scripts
at runtime. Ordinary renderer/Electron builds on Linux do not compile this helper. Test Open With in the packaged
Windows application, not an unbundled development session; missing helper/compiler errors are not a successful
native integration check. See the manual portable-workflow steps in `docs/accessibility/acceptance-checklist.md`.

## Code conventions

Keep renderer code free of Node and Electron imports. Place filesystem and operating-system operations in the main
process and expose only explicit, typed IPC methods. Validate renderer inputs at the IPC boundary and constrain all
library paths to the currently open library. Prefer small feature modules and native semantic controls.

## Accessibility

Every interaction must work with a keyboard and have a visible label that matches its accessible name. Keep focus
visible, use standard keyboard models for custom widgets, preserve native editing keys, support forced colors, and
announce operation results once through the status region. Add tests for keyboard/focus behavior and document
manual Windows screen-reader checks; automated tests do not verify speech output.

## Changes and pull requests

Keep changes focused, add or update tests and user documentation, and describe known limitations honestly. Do not
change the app version or publish releases as part of feature work. Include the checks run and any remaining manual
accessibility validation in the pull request description.
