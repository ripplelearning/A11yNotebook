import { useEffect, useMemo, useState } from 'react';
import {
  COMMANDS,
  cycleFocusRegions,
  dispatchCommand,
  type CommandId,
  type FocusRegion,
  type KeyboardShortcutDefinition,
} from '../shared/command-registry';
import { sampleVault, sampleNotebook, sampleDocument } from '../shared/sample-data';
import type { AppMode } from '../shared/types';

const focusOrder: FocusRegion[] = ['navigation', 'main', 'tabs', 'right-pane', 'status'];

const menuGroups = [
  { label: 'Vault', items: ['open-vault', 'new-notebook'] },
  { label: 'View', items: ['toggle-right-pane', 'toggle-read-only-mode'] },
  { label: 'Window', items: ['focus-search', 'focus-navigation', 'focus-main-content'] },
  { label: 'Help', items: ['show-keyboard-shortcuts', 'command-search'] },
];

export default function App() {
  const [activeRegion, setActiveRegion] = useState<FocusRegion>('navigation');
  const [mode, setMode] = useState<AppMode>('read-only');
  const [rightPaneOpen, setRightPaneOpen] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [commandQuery, setCommandQuery] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [selectedTab, setSelectedTab] = useState('welcome');

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) {
      return COMMANDS;
    }
    return COMMANDS.filter(
      (command) =>
        command.label.toLowerCase().includes(query) ||
        command.description.toLowerCase().includes(query) ||
        command.id.toLowerCase().includes(query),
    );
  }, [commandQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F6') {
        event.preventDefault();
        setActiveRegion((current) => cycleFocusRegions(current, 'forward'));
        setStatusMessage(`Focus moved to ${cycleFocusRegions(activeRegion, 'forward')}.`);
      }

      if (event.shiftKey && event.key === 'F6') {
        event.preventDefault();
        setActiveRegion((current) => cycleFocusRegions(current, 'backward'));
        setStatusMessage(`Focus moved to ${cycleFocusRegions(activeRegion, 'backward')}.`);
      }

      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        setStatusMessage('Command search opened.');
      }

      if (event.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false);
        setStatusMessage('Command search closed.');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeRegion, commandPaletteOpen]);

  const handleCommand = (commandId: CommandId) => {
    const result = dispatchCommand(commandId, {
      mode,
      rightPaneOpen,
      setMode,
      setRightPaneOpen,
      setStatusMessage,
      setCommandPaletteOpen,
      setSelectedTab,
    });

    if (result) {
      setStatusMessage(result);
    }
  };

  const currentTab = selectedTab === 'welcome' ? sampleDocument : sampleNotebook.documents[0];

  return (
    <div className="app-shell" aria-label="A11y Notebook application shell">
      <header className="app-header" aria-label="Application header">
        <div className="title-block">
          <h1>A11y Notebook</h1>
          <span className="current-item">{sampleVault.name} / {sampleNotebook.name}</span>
        </div>
        <div className="global-search">
          <label htmlFor="global-search" className="sr-only">
            Global search
          </label>
          <input
            id="global-search"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search vault, notes, tasks, files"
            aria-label="Global search"
          />
        </div>
      </header>

      <nav className="menu-bar" aria-label="Main menu">
        {menuGroups.map((group) => (
          <div key={group.label} className="menu-group" aria-label={group.label}>
            <span className="menu-label">{group.label}</span>
            {group.items.map((commandId) => {
              const command = COMMANDS.find((item) => item.id === commandId);
              if (!command) return null;
              return (
                <button
                  key={command.id}
                  type="button"
                  className="menu-item"
                  onClick={() => handleCommand(command.id as CommandId)}
                  aria-label={command.label}
                >
                  {command.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <main className="workspace" aria-label="Workspace layout">
        <aside
          className={activeRegion === 'navigation' ? 'panel active-panel' : 'panel'}
          data-region="navigation"
          aria-label="Navigation pane"
        >
          <h2>Vaults</h2>
          <ul className="nav-list" aria-label="Vault and notebook navigation">
            <li aria-current="true">{sampleVault.name}</li>
            <li>{sampleNotebook.name}</li>
            <li>Tasks</li>
            <li>Reminders</li>
            <li>Bookmarks</li>
          </ul>
        </aside>

        <section className="content-panel" aria-label="Main content">
          <div
            className={activeRegion === 'tabs' ? 'tab-bar active-panel' : 'tab-bar'}
            data-region="tabs"
            aria-label="Open tabs"
          >
            {['welcome', 'notes', 'tasks'].map((tabId) => (
              <button
                key={tabId}
                type="button"
                className={selectedTab === tabId ? 'tab active-tab' : 'tab'}
                role="tab"
                aria-selected={selectedTab === tabId}
                onClick={() => setSelectedTab(tabId)}
              >
                {tabId === 'welcome' ? 'Welcome' : tabId === 'notes' ? 'Notes' : 'Tasks'}
              </button>
            ))}
          </div>

          <article
            className={activeRegion === 'main' ? 'document active-panel' : 'document'}
            data-region="main"
            aria-label="Main content area"
            tabIndex={0}
          >
            <h2>{currentTab.title}</h2>
            <p>{currentTab.summary}</p>
            <div className="document-body" contentEditable={mode === 'edit'} suppressContentEditableWarning>
              <p>
                Welcome to A11y Notebook. This first foundation shows the accessible shell, focus regions,
                and command model. More advanced vault and document features are planned in later phases.
              </p>
              <p>
                Use F6 and Shift+F6 to move between the main panes, Control+K to open command search,
                and the status bar to confirm the current state.
              </p>
            </div>
          </article>
        </section>

        {rightPaneOpen ? (
          <aside
            className={activeRegion === 'right-pane' ? 'side-panel active-panel' : 'side-panel'}
            data-region="right-pane"
            aria-label="Right information pane"
          >
            <h2>Info</h2>
            <dl>
              <dt>Mode</dt>
              <dd>{mode}</dd>
              <dt>Last action</dt>
              <dd>{statusMessage}</dd>
              <dt>Search</dt>
              <dd>{searchText || 'No active query'}</dd>
            </dl>
          </aside>
        ) : null}
      </main>

      <footer className="status-bar" data-region="status" aria-live="polite" aria-label="Status bar">
        <span>{statusMessage}</span>
        <span>Mode: {mode}</span>
      </footer>

      {commandPaletteOpen ? (
        <div className="modal-backdrop" aria-modal="true" role="dialog" aria-label="Command palette">
          <div className="command-palette">
            <label htmlFor="command-search" className="sr-only">
              Search commands
            </label>
            <input
              id="command-search"
              type="search"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Search commands"
              aria-label="Search commands"
            />
            <ul className="command-list" aria-label="Command list">
              {filteredCommands.map((command) => (
                <li key={command.id}>
                  <button type="button" onClick={() => handleCommand(command.id)}>
                    <span>{command.label}</span>
                    <small>{command.description}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
