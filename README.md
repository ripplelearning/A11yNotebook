# A11y Notebook

A11y Notebook is a Windows-first, accessibility-first desktop application for organizing personal knowledge locally and securely. The current foundation intentionally focuses on the shell, command system, keyboard model, and data/storage boundaries while leaving the full knowledge vault engine for later phases.

## Current scope

- Accessible application shell with a top header, menu bar, navigation tree, content pane, tabs, right pane, and status bar.
- Keyboard-first focus regions with F6/Shift+F6 support.
- Command registry and command palette with initial commands.
- Read-only/edit mode toggling and accessible announcements.
- Local JSON persistence boundary and sample vault data.
- Test coverage for registry logic and focus cycling.
- Documentation that explains how HomerDev influenced the design without copying the project wholesale.

## Accessibility commitments

- Native semantic controls before custom controls.
- Screen reader friendly labels and states.
- Keyboard-operable interface with visible focus and command lifecycle feedback.
- Compatibility planning for JAWS, NVDA, Narrator, and Windows UI Automation.

## Getting started

1. Install dependencies:
   npm install
2. Start the app in development mode:
   npm run dev
3. Run tests:
   npm test
4. Type check:
   npm run typecheck

## Production build

npm run build

## Project structure

- `electron/` — Electron main process and preload bridge.
- `src/renderer/` — React UI shell and components.
- `src/shared/` — commands, types, and persistence models.
- `docs/` — product and accessibility docs.
- `src/test/` — test configuration and helpers.

## Roadmap summary

The first milestone is a working foundation only. The later road map includes vault and notebook persistence, document editing, full text search, task management, cognitive assets, templates, annotations, bookmarks, PDF/ePub/web viewing, and security-aware password protection.
