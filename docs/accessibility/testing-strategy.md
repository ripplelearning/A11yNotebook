# Accessibility testing strategy

## Goals

A11y Notebook needs to pass both automated checks and human verification. The goal is to verify the shell, keyboard flow, and common interactions in a way that is honest about what automated tools can and cannot prove.

## Automated DOM accessibility checks

- Use React Testing Library and Vitest for rendering and interaction checks.
- Validate the shell elements and options that matter most: menu bar, search input, nav pane, tabs, content pane, info pane, status bar, and command palette.
- Verify accessible names and labels on each major control.
- Confirm focus-target states and active region toggles are present.

## Keyboard interaction tests

- F6 and Shift+F6 move through the expected focus regions.
- Ctrl+K opens the command palette and Escape closes it.
- Read-only/edit mode toggles produce visible status and mode updates.
- Search and command actions retain keyboard operability.

## Electron integration tests

- Smoke-test the Electron shell startup path.
- Confirm the browser window loads the renderer and displays the expected app shell.
- Confirm the preload bridge is enabled without exposing Node to the renderer.

## Windows UI Automation smoke-test plan

- Run the app on Windows with UI Automation tools to inspect the accessibility tree.
- Check that key regions, containers, and controls are discoverable.
- Confirm name, role, and state metadata match the intended semantics.
- Run smoke tests for keyboard-only flows and pane navigation.

## Manual screen-reader validation matrix

Recommended manual checks:

- JAWS on Windows 11
- NVDA on Windows 11
- Narrator on Windows 11
- Keyboard-only navigation of menu bar, panes, tabs, search, and command palette
- Read-only and edit mode transitions
- Status bar reading and command feedback

## Important limitation

UI Automation and DOM tests do not prove that a screen reader speaks the right thing. They confirm that the app exposes accessible names, roles, and states. Speech output still needs manual screen-reader validation because the automation tree cannot reliably capture actual spoken output or speech timing.
