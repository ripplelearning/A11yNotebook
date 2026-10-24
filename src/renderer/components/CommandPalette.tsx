import { useMemo, useState } from 'react';
import { COMMANDS, type CommandId } from '../../shared/command-registry';
import Modal from './Modal';
import type { NotebookSettings } from '../../shared/settings';

type CommandPaletteProps = {
  onRun: (commandId: CommandId) => void;
  onClose: () => void;
  shortcuts?: NotebookSettings['shortcuts'];
  isDisabled?: (commandId: CommandId) => boolean;
};

export default function CommandPalette({ onRun, onClose, shortcuts = {}, isDisabled }: CommandPaletteProps) {
  const [query, setQuery] = useState('');

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return COMMANDS.filter((command) => command.id !== 'context-import-internal');
    }
    return COMMANDS.filter(
      (command) =>
        command.id !== 'context-import-internal' &&
        (command.label.toLowerCase().includes(normalized) ||
          command.aliases?.some((alias) => alias.toLowerCase().includes(normalized)) ||
          command.description.toLowerCase().includes(normalized) ||
          command.id.toLowerCase().includes(normalized)),
    );
  }, [query]);

  return (
    <Modal titleId="command-palette-title" title="Command palette" onClose={onClose} className="command-palette">
      <label htmlFor="command-search" className="sr-only">
        Search Command Palette
      </label>
      <input
        id="command-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search Command Palette"
        aria-describedby="command-count"
        autoComplete="off"
        data-autofocus
      />
      <p id="command-count" className="sr-only" role="status" aria-live="polite">
        {filteredCommands.length === 1 ? '1 command' : `${filteredCommands.length} commands`}
      </p>
      <ul className="command-list" aria-label="Command list">
        {filteredCommands.map((command) => (
          <li key={command.id}>
            <button
              type="button"
              disabled={isDisabled?.(command.id)}
              onClick={() => onRun(command.id)}
              aria-describedby={`command-${command.id}-description`}
            >
              {command.label}
            </button>
            <small id={`command-${command.id}-description`}>
              {command.description}
              {(shortcuts[command.id] ?? command.shortcut)
                ? ` Shortcut: ${shortcuts[command.id] ?? command.shortcut}.`
                : ''}
            </small>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
