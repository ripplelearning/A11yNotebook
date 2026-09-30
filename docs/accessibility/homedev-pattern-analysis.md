---
title: 'HomerDev pattern analysis for A11y Notebook'
---

# HomerDev pattern analysis for A11y Notebook

This document translates the most relevant lessons from HomerDev into A11y Notebook without copying the underlying architecture or branding.

## 1. Layout by code and native controls

### HomerDev technique

HomerDev's Lbc dialogs are built with ordinary Windows controls, and add order becomes focus order. The result is predictable reading order, keyboard tab flow, and UI Automation behavior.

### Why it matters

Native, semantic controls are easier for screen readers to announce correctly and easier to navigate with the keyboard.

### Applicability

This applies directly to A11y Notebook. A11y Notebook should build its shell and dialogs from semantic HTML, not custom faux widgets built with generic divs.

### A11y Notebook adaptation

- Use native buttons, inputs, lists, dialogs, menus, and forms.
- Keep DOM order aligned with keyboard flow.
- Avoid setting accessible names that duplicate visible text.

### Risks and compatibility notes

- Custom CSS-only controls can hide semantics from UI Automation.
- The app should preserve screen-reader announcements by relying on labels and roles instead of ad hoc aria hacks.

## 2. Avoid duplicate accessible names

### HomerDev technique

HomerDev explicitly avoids making an accessible name the same as an already-announced label or title. It prevents double reading.

### Why it matters

Screen readers often announce both a title and an equivalent label, which creates repetition.

### Applicability

This should be followed in Electron/React by using labels, `aria-labelledby`, and `aria-describedby` only when relevant.

### A11y Notebook adaptation

- Use visible labels for inputs and buttons.
- Use `aria-label` only when there is no visible text label.
- Keep window/caption text simple and avoid restating the same information in an accessible name.

## 3. Central command registry

### HomerDev technique

The KeyMap registry centralizes command names, descriptions, and key assignments. Multiple surfaces read the same authoritative data.

### Why it matters

A command list, keyboard shortcut help, command palette, and menu bar can drift if they are maintained separately.

### Applicability

This is a direct fit for A11y Notebook's shell and command palette.

### A11y Notebook adaptation

- Keep a single shared command registry.
- Reuse it for menu items, command search, and keyboard help.
- Keep command summaries short and action-oriented.

## 4. Handle key events at the correct layer

### HomerDev technique

The app intercepts app-level commands at a form/controller layer before child controls see the event, while preserving the control's native behavior.

### Why it matters

Some keys should be reserved for app commands, but text boxes and document content need regular editing navigation to work.

### Applicability

This applies to the Electron renderer shell and document editor states.

### A11y Notebook adaptation

- Reserve global commands like F6 and Ctrl+K for shell actions.
- Do not override native editing keys inside text boxes unless the app explicitly defines a command.
- Keep the main content and search input state-driven instead of hard-wired to custom key handlers.

## 5. Focus tips, status messages, and live announcements

### HomerDev technique

HomerDev separates status text from repeated spoken announcements, choosing status-bar text to be reread by the user rather than repeated constantly.

### Why it matters

A status bar provides a persistent place to deliver operation results without overriding screen-reader focus feedback.

### Applicability

This is highly relevant to A11y Notebook.

### A11y Notebook adaptation

- Provide a dedicated status bar with `aria-live="polite"` and readable updates.
- Avoid announcing the same thing that a screen reader already announces as the user tabs.
- Use status updates for changed mode, command results, and focus shifts when the user needs the cue.

## 6. Read-only views and content navigation

### HomerDev technique

HomerDev uses read-only help and results views where the user can navigate the content without editing it.

### Why it matters

Users often need to review the content in a linear, navigable form and search it without accidentally changing it.

### Applicability

This strongly applies to A11y Notebook's main document pane and read-only view.

### A11y Notebook adaptation

- Use a read-only document pane with strong semantics and linear reading order.
- Allow keyboard users to move through headings, paragraphs, links, and code-like content.
- Offer edit mode distinctly from read-only mode.

## 7. UI Automation evidence and honest testing

### HomerDev technique

The `uiCheck` script uses UI Automation to confirm a program exposes expected controls and text after keystrokes.

### Why it matters

The app can fail accessibility without a person being able to tell by eye.

### Applicability

This is useful for A11y Notebook, especially for DOM-level and browser-level validation.

### A11y Notebook adaptation

- Add accessible DOM tests with React Testing Library and Vitest.
- Add smoke tests for critical shell controls and focus behaviors.
- Document the limitation: UI Automation does not prove screen-reader speech output.

## 8. Persistence, settings, and command safety

### HomerDev technique

HomerDev writes settings and lists as soon as a user answers, rather than on a closing event.

### Why it matters

State should be durable without forcing the user to guess when it saved.

### Applicability

This is relevant for notebook and settings persistence in A11y Notebook.

### A11y Notebook adaptation

- Persist local app state to JSON as soon as a change is accepted.
- Keep commands and settings typed and explicit.
- Avoid cross-cutting state drift between menu items, command palette, and settings panels.

## 9. Shared shell behavior across app shapes

### HomerDev technique

HomerDev centralizes common frame behavior and commands for MDI child windows and dialogs.

### Why it matters

Repetition across windows creates inconsistent keyboard behavior.

### Applicability

This still matters in a single-window desktop app with panels and tabs.

### A11y Notebook adaptation

- Centralize command behavior in one shell layer.
- Route focus-region changes and status updates through a single shell model.
- Keep region behavior consistent across navigation, main content, tabs, and info pane.

## 10. Compatibility with JAWS, NVDA, Narrator, and Windows UI Automation

### HomerDev technique

HomerDev emphasizes multiple reader compatibility and UIA-level verification.

### Why it matters

No single screen reader or automation path can be assumed.

### Applicability

This is central to A11y Notebook.

### A11y Notebook adaptation

- Test the app in JAWS, NVDA, and Narrator on Windows.
- Favor proper roles, labels, and live-region semantics.
- Keep keyboard interactions consistent with standard Windows conventions.
- Perform manual screen-reader validation later that goes beyond automated DOM checks.

## 11. Implementation notes: pane focus, dialogs, and the updater

### Reference technique

HomerDev (section 4) handles keys at the layer that owns them. It keeps focus on real, native controls and uses status messages only for information that focus alone does not convey (section 5).

### A11y Notebook implementation

- F6 and Shift+F6 call `.focus()` on each pane's container (`tabIndex={-1}`, so containers stay out of the Tab order). The tabs pane focuses the selected tab. The status bar shows the current pane as plain text, but moving focus is not announced through the live region, because the screen reader already reads the newly focused, labelled pane.
- Dialogs handle their own keys (Tab trapping and Escape). Global shortcuts are ignored while a dialog is open.
- Command results that focus does not convey (for example, "Right pane opened.") go to the status bar's polite live region.
- The update dialog makes its own announcements while it is open. The status bar takes over when it is closed, so screen readers never hear the same message twice.
- The Help menu is a group of native buttons. A11y Notebook does not build a custom ARIA `menubar`, because native buttons need no extra keyboard model and are exposed reliably to UI Automation. The native Windows menu (Alt, H) offers the same Help commands.

### Compatibility considerations

- `aria-modal="true"` is honored by current versions of JAWS, NVDA, and Narrator in Chromium. The focus trap is also enforced in script, so focus stays inside the dialog even where it is not honored.
- Download progress is announced at most every 10 percent, so users are not flooded with speech.

## Summary

HomerDev is a reference for accessibility engineering, not a blueprint to clone. The most valuable patterns are:

- predictable focus order,
- native and semantic controls,
- command centralization,
- status and live updates,
- honest UI Automation testing,
- and a keyboard-first model that respects screen-reader behavior.

A11y Notebook preserves its own product direction while adopting those principles in a modern Electron + React architecture.
