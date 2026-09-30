# Product roadmap

## Phase 1 — Foundation shell and accessibility model

- Electron + React + TypeScript shell
- Accessible menu, header, navigation, content area, tabs, info pane, and status bar
- Global command registry and command palette
- Focus-region cycling with F6 and Shift+F6
- Read-only/edit mode toggles and live state announcements
- JSON persistence boundary and sample vault data
- Automated tests for registry behavior and renderer accessibility primitives

## Phase 2 — Vault and notebook model

- Typed local vault/notebook/file models
- JSON-backed vault storage and import/export
- Notebook creation, rename, move, delete, and metadata handling
- File tree view with labels and keyboard navigation
- Basic search and filter across notebook entries

## Phase 3 — Reader and editor experience

- Read-only document viewer with semantic navigation
- Edit mode with focus-safe document editing
- Structured headings, bookmarks, and notes
- Local link and backlink awareness
- Keyboard commands for editing and navigation

## Phase 4 — Search, indexing, and annotations

- Full-text local search across notes, documents, PDFs, ePubs, and web captures
- Bookmarks and annotations
- Link graph and backlink tracking
- User-generated tags and metadata suggestions

## Phase 5 — Tasks, reminders, and project planning

- Todo lists and checklist items
- Reminders and calendar-like organization patterns
- Project tracking and milestone summaries
- Sortable tables and cognitive assets

## Phase 6 — Cognitive assets and templates

- Mind maps, outlines, flashcards, and tables
- User-editable templates and custom asset modules
- Extensible asset model for later plugin architecture

## Phase 7 — Security and local protection

- Optional vault password protection
- Editing lock requirements
- Secure local storage model
- Audit logging for sensitive changes

## Phase 8 — Import and document support

- Markdown, PDF, ePub, HTML, and web capture previews
- File attachments and reference panes
- Link resolution and file metadata extraction

## Phase 9 — Accessibility validation and release readiness

- Automated DOM and keyboard interaction tests
- Windows UI Automation smoke testing
- Manual screen-reader validation across JAWS, NVDA, and Narrator
- Packaging, installer, and release process
