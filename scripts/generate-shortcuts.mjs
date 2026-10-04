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
    shortcut: item.match(/\bshortcut:\s*'([^']+)'/)?.[1],
  }))
  .filter((item) => item.label && item.shortcut)
  .map((item) => `| ${item.shortcut} | ${item.label} |`);

const document = `# Keyboard shortcuts\n\nGenerated from \`src/shared/command-registry.ts\` by \`npm run docs:shortcuts\`.\n\n| Shortcut | Command |\n| --- | --- |\n${rows.join('\n')}\n\n## Navigation keys\n\n| Shortcut | Action |\n| --- | --- |\n| F6 / Shift+F6 | Move to the next / previous pane |\n| Ctrl+Tab / Ctrl+Shift+Tab | Switch open tabs |\n| In the vault tree: Up/Down, Left/Right, Home/End | Move, expand, and collapse |\n| In the vault tree: Enter, F2, Delete, \`*\`, first-letter type-ahead | Open, rename, delete, expand siblings, or find |\n`;
const featureNavigation = `
## Feature navigation

These are defaults; Settings can change command bindings. Help and the command palette show active bindings.
Standard text editing and pane/tab navigation are reserved.

| Context | Keys / behavior |
| --- | --- |
| Tree action menu | Shift+F10 / Applications key; Up/Down, Home/End, Enter, Escape |
| Formatting toolbar | Left/Right, Home/End; Tab leaves toolbar |
| Outline/mind-map tree | Arrows; Enter new item; Tab/Shift+Tab indent/outdent; Alt+Up/Down reorder |
| Editable grid | Arrows, Home/End; Enter/F2 edit; Enter commit; Escape cancel |
| Flashcards | Tab to Show answer, then Again/Hard/Good/Easy |
`;
await writeFile(outputPath, await prettier.format(document + featureNavigation, { parser: 'markdown' }));
