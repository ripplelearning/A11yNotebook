# Contributing

## Checks

Use Node.js 22 or later. Run `npm ci`, then `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
and `npm run build`.

## Code conventions

Keep renderer code free of Node and Electron imports. Place filesystem and operating-system operations in the main
process and expose only explicit, typed IPC methods. Validate renderer inputs at the IPC boundary and constrain all
vault paths to the currently open vault. Prefer small feature modules and native semantic controls.

## Accessibility

Every interaction must work with a keyboard and have a visible label that matches its accessible name. Keep focus
visible, use standard keyboard models for custom widgets, preserve native editing keys, support forced colors, and
announce operation results once through the status region. Add tests for keyboard/focus behavior and document
manual Windows screen-reader checks; automated tests do not verify speech output.

## Changes and pull requests

Keep changes focused, add or update tests and user documentation, and describe known limitations honestly. Do not
change the app version or publish releases as part of feature work. Include the checks run and any remaining manual
accessibility validation in the pull request description.
