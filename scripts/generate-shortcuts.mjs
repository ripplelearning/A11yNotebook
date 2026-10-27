// Generates the keyboard reference from the authoritative shared command registry.
import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import prettier from 'prettier';

const registryPath = new URL('../src/shared/command-registry.ts', import.meta.url);
const outputPath = new URL('../docs/keyboard-shortcuts.md', import.meta.url);
const source = await readFile(registryPath, 'utf8');
const commandList = source.match(/export const COMMANDS:[\s\S]*?=\s*\[([\s\S]*?)\n\];/)?.[1];
if (!commandList) throw new Error('Could not find COMMANDS in the shared registry.');

const rows = [...commandList.matchAll(/\{([^{}]*)\}/g)]
  .map(([, item]) => ({
    label: item.match(/\blabel:\s*'([^']+)'/)?.[1],
    shortcuts: [
      item.match(/\bshortcut:\s*'([^']+)'/)?.[1],
      ...[...(item.match(/\bshortcutAliases:\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
        ([, shortcut]) => shortcut,
      ),
    ].filter(Boolean),
  }))
  .filter((item) => item.label)
  .flatMap((item) => item.shortcuts.map((shortcut) => `| ${shortcut} | ${item.label} |`));

const document = `# Keyboard shortcuts\n\nGenerated from \`src/shared/command-registry.ts\` by \`npm run docs:shortcuts\`.\n\nOn macOS, use Command (⌘) in place of Ctrl and Option in place of Alt.\n\n| Shortcut | Command |\n| --- | --- |\n${rows.join('\n')}\n\n## Navigation keys\n\n| Shortcut | Action |\n| --- | --- |\n| F6 / Shift+F6 | Move to the next / previous pane |\n| Ctrl+Tab / Ctrl+Shift+Tab | Switch open tabs |\n| In the library tree: Up/Down, Left/Right, Home/End | Move, expand, and collapse |\n| In the library tree: Enter, F2, Delete, \`*\`, first-letter type-ahead | Open, rename, delete, expand siblings, or find |\n`;
const featureNavigation = `
## Feature navigation

These are defaults; Settings can change command bindings. Help and the command palette show active bindings.
Standard text editing and pane/tab navigation are reserved.

| Context | Keys / behavior |
| --- | --- |
| Global context menu | Shift+F10 / Applications key / right-click; arrows, Home/End, type-ahead, Enter/Space, Escape |
| Rich-text toolbar | One tab stop; Left/Right, Home/End; Tab leaves toolbar |
| Outline/mind-map tree | Arrows; Enter new item; Tab/Shift+Tab indent/outdent; Alt+Up/Down reorder |
| Editable grid | Arrows, Home/End; Enter/F2 edit; Enter commit; Shift+Enter newline; Escape cancel; Space sorts header |
| Details grid | Arrows/Home/End navigate cells and headers; Enter opens or sorts; Space selects or sorts; F2 renames |
| Flashcards | Tab to Show answer, then Again/Hard/Good/Easy |

## Customize and capture

Settings exposes a **Keyboard Shortcuts** heading. Every command has a manual textbox and an optional
**Capture Shortcut for [command]** button. Activate it, then press Ctrl/Alt plus a letter or number, or F1–F12
with optional Ctrl/Alt/Shift modifiers. Capture normalizes the combination into that command's draft textbox;
**Save settings** applies it and **Cancel** discards draft changes.

**Escape** or **Cancel capture** cancels without closing Settings or changing the old binding. **Tab** cancels
and continues dialog navigation. A different capture button replaces the listener. Reset, save and close stop capture.
Modifier-only presses wait; repeats, IME/composition, AltGraph and unsupported keys do not replace the old value.
Existing conflict checks apply to defaults, custom assignments, fixed aliases, and reserved navigation/editing keys.
Listening and validation feedback are announced; successful capture focuses the textbox and cancellation returns
focus to the capture button (Tab instead continues navigation). App shortcuts and native accelerators are suspended
while listening. Operating-system-reserved combinations may not reach the app and cannot always be intercepted.

Under **Appearance and interface**, **Show command/action buttons in the UI** restores the button-rich layout.
It defaults off (also for older settings), keeps the native menu in either mode, and applies on Save settings.
Browser-only development retains accessible command buttons without a native menu.
`;
await writeFile(outputPath, await prettier.format(document + featureNavigation, { parser: 'markdown' }));
