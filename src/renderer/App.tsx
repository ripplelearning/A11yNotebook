import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  COMMANDS,
  cycleFocusRegions,
  dispatchCommand,
  FOCUS_REGION_ORDER,
  getCommandById,
  matchesShortcut,
  toAriaKeyShortcut,
  type CommandId,
} from '../shared/command-registry';
import { isMenuCommand } from '../shared/ipc';
import type { AppMode, FocusRegion, FocusTarget, VaultEntry, VaultInfo } from '../shared/types';
import CommandPalette from './components/CommandPalette';
import { AboutDialog, KeyboardShortcutsDialog } from './components/HelpDialogs';
import UpdateDialog from './components/UpdateDialog';
import MarkdownDocument from './features/vault/MarkdownDocument';
import VaultTree from './features/vault/VaultTree';
import { useUpdater } from './hooks/useUpdater';

type DialogId = 'palette' | 'updates' | 'shortcuts' | 'about';

interface OpenNote {
  id: string;
  path: string;
  title: string;
  content: string;
  saved: string;
}

function findEntry(entries: VaultEntry[], targetPath: string | null): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    const nested = entry.children && findEntry(entry.children, targetPath);
    if (nested) return nested;
  }
  return undefined;
}

const TAB_PANEL_ID = 'main-tabpanel';

const REGION_LABELS: Record<FocusRegion, string> = {
  navigation: 'Navigation pane',
  tabs: 'Tabs',
  main: 'Main content',
  'right-pane': 'Right pane',
  status: 'Status bar',
};

const menuGroups: { label: string; items: CommandId[] }[] = [
  { label: 'Vault', items: ['open-vault', 'new-notebook'] },
  { label: 'View', items: ['toggle-right-pane', 'toggle-read-only-mode'] },
  { label: 'Window', items: ['focus-search', 'focus-navigation', 'focus-main-content', 'focus-right-pane'] },
  { label: 'Help', items: ['check-for-updates', 'show-keyboard-shortcuts', 'show-about', 'command-search'] },
];

export default function App() {
  const [activeRegion, setActiveRegion] = useState<FocusRegion>('navigation');
  const [mode, setMode] = useState<AppMode>('read-only');
  const [rightPaneOpen, setRightPaneOpen] = useState(true);
  const [activeDialog, setActiveDialog] = useState<DialogId | null>(null);
  const [searchText, setSearchText] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [selectedTab, setSelectedTab] = useState('welcome');
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [openNotes, setOpenNotes] = useState<OpenNote[]>([]);
  const [treeSelection, setTreeSelection] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<VaultEntry[]>([]);
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  const updater = useUpdater();

  const searchRef = useRef<HTMLInputElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabPanelRef = useRef<HTMLElement>(null);
  const rightPaneRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const tabs = [
    { id: 'welcome', label: 'Welcome' },
    ...openNotes.map((note) => ({
      id: note.id,
      label: `${note.title}${note.content !== note.saved ? ' (unsaved)' : ''}`,
    })),
  ];

  useEffect(() => {
    const bridge = window.a11yNotebook;
    if (bridge)
      void bridge.vault
        .get()
        .then(setVault)
        .catch(() => setStatusMessage('Could not open the last vault.'));
  }, []);

  useEffect(() => {
    const bridge = window.a11yNotebook;
    if (!bridge || !vault || !searchText.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const notes: VaultEntry[] = [];
    const collect = (entries: VaultEntry[]) =>
      entries.forEach((entry) => {
        if (entry.kind === 'note') notes.push(entry);
        if (entry.children) collect(entry.children);
      });
    collect(vault.entries);
    void Promise.all(
      notes.map(async (entry) => {
        const content = await bridge.vault.readNote(entry.path).catch(() => '');
        return `${entry.name}\n${content}`.toLocaleLowerCase().includes(searchText.trim().toLocaleLowerCase())
          ? entry
          : null;
      }),
    ).then((matches) => {
      if (!cancelled) setSearchResults(matches.filter((entry): entry is VaultEntry => entry !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [searchText, vault]);

  const availableRegions = FOCUS_REGION_ORDER.filter((region) => region !== 'right-pane' || rightPaneOpen);

  /** The element that receives focus when a region is entered. */
  const getFocusElement = useCallback(
    (target: FocusTarget): HTMLElement | null => {
      switch (target) {
        case 'search':
          return searchRef.current;
        case 'navigation':
          return navigationRef.current;
        case 'tabs':
          return tabRefs.current[selectedTab] ?? null;
        case 'main':
          return tabPanelRef.current;
        case 'right-pane':
          return rightPaneRef.current;
        case 'status':
          return statusRef.current;
      }
    },
    [selectedTab],
  );

  const focusNow = useCallback(
    (target: FocusTarget) => {
      const element = getFocusElement(target);
      if (!element) {
        return false;
      }
      element.focus();
      if (target !== 'search') {
        setActiveRegion(target);
      }
      return true;
    },
    [getFocusElement],
  );

  // Focus requests are applied after render so that targets which are about to
  // appear (such as the right pane) exist, and so they run after a closing dialog
  // has restored focus.
  useEffect(() => {
    if (pendingFocus) {
      focusNow(pendingFocus);
      setPendingFocus(null);
    }
  }, [pendingFocus, focusNow]);

  // Keep the highlighted region in sync when focus moves by mouse or Tab.
  useEffect(() => {
    const containers: [FocusRegion, RefObject<HTMLElement>][] = [
      ['navigation', navigationRef],
      ['tabs', tabListRef],
      ['main', tabPanelRef],
      ['right-pane', rightPaneRef],
      ['status', statusRef],
    ];
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const match = containers.find(([, ref]) => ref.current?.contains(target));
      if (match) {
        setActiveRegion(match[0]);
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  // If the right pane is hidden while it contains focus, keep focus in the workspace.
  useEffect(() => {
    if (!rightPaneOpen && activeRegion === 'right-pane') {
      if (!document.activeElement || document.activeElement === document.body) {
        setPendingFocus('main');
      } else {
        setActiveRegion('main');
      }
    }
  }, [rightPaneOpen, activeRegion]);

  const regionContaining = (element: Element | null): FocusRegion | null => {
    if (!element) {
      return null;
    }
    if (navigationRef.current?.contains(element)) return 'navigation';
    if (tabListRef.current?.contains(element)) return 'tabs';
    if (tabPanelRef.current?.contains(element)) return 'main';
    if (rightPaneRef.current?.contains(element)) return 'right-pane';
    if (statusRef.current?.contains(element)) return 'status';
    return null;
  };

  const checkForUpdates = () => {
    setActiveDialog('updates');
    updater.check();
  };

  const openEntry = async (entry: VaultEntry) => {
    const bridge = window.a11yNotebook;
    if (!bridge) return;
    setTreeSelection(entry.path);
    if (entry.kind === 'attachment') {
      await bridge.vault.openExternal(entry.path);
      return;
    }
    if (entry.kind !== 'note') return;
    const content = await bridge.vault.readNote(entry.path);
    const note: OpenNote = {
      id: entry.path,
      path: entry.path,
      title: entry.name.replace(/\.md$/i, ''),
      content,
      saved: content,
    };
    setOpenNotes((current) =>
      current.some((item) => item.id === note.id)
        ? current.map((item) => (item.id === note.id ? note : item))
        : [...current, note],
    );
    setSelectedTab(note.id);
  };

  const createNote = async () => {
    if (!vault || !window.a11yNotebook) {
      setStatusMessage('Open a vault before creating a note.');
      return;
    }
    const title = window.prompt('New note title');
    if (!title?.trim()) return;
    const selected = findEntry(vault.entries, treeSelection);
    const parent = selected?.kind === 'notebook' ? selected : undefined;
    const relativePath = `${parent ? `${parent.path}/` : ''}${title.trim().replace(/\.md$/i, '')}.md`;
    setVault(await window.a11yNotebook.vault.createNote(relativePath));
    await openEntry({ name: relativePath.split('/').at(-1) ?? relativePath, path: relativePath, kind: 'note' });
    setStatusMessage('Note created.');
  };

  const refreshVault = async () => {
    const latest = await window.a11yNotebook?.vault.get();
    if (latest) setVault(latest);
  };

  const saveActiveNote = async () => {
    const note = openNotes.find((item) => item.id === selectedTab);
    if (!note || !window.a11yNotebook) return;
    await window.a11yNotebook.vault.saveNote(note.path, note.content);
    setOpenNotes((current) => current.map((item) => (item.id === note.id ? { ...item, saved: item.content } : item)));
    setStatusMessage(`Saved ${note.title}.`);
    await refreshVault();
  };

  useEffect(() => {
    const note = openNotes.find((item) => item.id === selectedTab);
    if (!note || note.content === note.saved || !window.a11yNotebook) return;
    const timeout = window.setTimeout(() => {
      void window.a11yNotebook?.vault.saveNote(note.path, note.content).then(() => {
        setOpenNotes((current) =>
          current.map((item) => (item.id === note.id ? { ...item, saved: item.content } : item)),
        );
        setStatusMessage(`Saved ${note.title}.`);
      });
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [openNotes, selectedTab]);

  const handleCommand = (commandId: CommandId) => {
    if (commandId === 'open-vault') {
      void window.a11yNotebook?.vault
        .open()
        .then((opened) => {
          if (opened) {
            setVault(opened);
            setOpenNotes([]);
            setSelectedTab('welcome');
            setStatusMessage(`Opened vault ${opened.name}.`);
          }
        })
        .catch(() => setStatusMessage('Could not open the selected vault.'));
      return;
    }
    if (commandId === 'new-notebook') {
      if (!vault || !window.a11yNotebook) {
        setStatusMessage('Open a vault before creating a notebook.');
        return;
      }
      const name = window.prompt('New notebook name');
      if (name?.trim()) {
        void window.a11yNotebook.vault
          .createNotebook(name.trim())
          .then(setVault)
          .then(() => setStatusMessage('Notebook created.'));
      }
      return;
    }
    if (commandId === 'refresh-links') {
      void window.a11yNotebook?.vault.get().then(setVault);
      setStatusMessage('Vault refreshed.');
      return;
    }
    if (commandId === 'close-current-tab') {
      const note = openNotes.find((item) => item.id === selectedTab);
      if (!note) return;
      if (note.content !== note.saved && !window.confirm(`Discard unsaved changes to ${note.title}?`)) return;
      setOpenNotes((current) => current.filter((item) => item.id !== note.id));
      setSelectedTab('welcome');
      setStatusMessage(`Closed ${note.title}.`);
      return;
    }
    if (activeDialog === 'palette' && commandId !== 'command-search') {
      setActiveDialog(null);
    }
    const result = dispatchCommand(commandId, {
      mode,
      rightPaneOpen,
      setMode,
      setRightPaneOpen,
      setCommandPaletteOpen: (open) => setActiveDialog(open ? 'palette' : null),
      setSelectedTab,
      focusTarget: setPendingFocus,
      checkForUpdates,
      showKeyboardShortcuts: () => setActiveDialog('shortcuts'),
      showAbout: () => setActiveDialog('about'),
    });
    if (result) {
      setStatusMessage(result);
    }
  };

  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    // Open dialogs manage their own keyboard interaction (Tab trapping and Escape).
    if (activeDialog) {
      return;
    }
    if (event.key === 'F6' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const current = regionContaining(document.activeElement);
      const next = current
        ? cycleFocusRegions(current, event.shiftKey ? 'backward' : 'forward', availableRegions)
        : availableRegions.includes(activeRegion)
          ? activeRegion
          : availableRegions[0];
      focusNow(next);
      return;
    }
    if (event.key === 'Tab' && event.ctrlKey) {
      event.preventDefault();
      const currentIndex = tabs.findIndex((tab) => tab.id === selectedTab);
      const nextIndex = (currentIndex + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
      setSelectedTab(tabs[nextIndex].id);
      return;
    }
    const command = COMMANDS.find((item) => item.shortcut && matchesShortcut(event, item.shortcut));
    if (command) {
      event.preventDefault();
      handleCommand(command.id);
    }
  };

  // Always call the latest handler without re-registering the listener on every render.
  const keyDownHandlerRef = useRef(handleGlobalKeyDown);
  keyDownHandlerRef.current = handleGlobalKeyDown;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyDownHandlerRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Commands chosen from the native Windows menu (Help menu items).
  const menuCommandHandlerRef = useRef(handleCommand);
  menuCommandHandlerRef.current = handleCommand;
  useEffect(() => {
    const bridge = window.a11yNotebook;
    if (!bridge) {
      return undefined;
    }
    return bridge.onMenuCommand((command) => {
      if (isMenuCommand(command)) {
        menuCommandHandlerRef.current(command);
      }
    });
  }, []);

  // Mirror updater announcements in the status bar. While the update dialog is open
  // it announces them itself, so the status bar is not updated to avoid double speech.
  const activeDialogRef = useRef(activeDialog);
  activeDialogRef.current = activeDialog;
  useEffect(() => {
    if (updater.announcement && activeDialogRef.current !== 'updates') {
      setStatusMessage(updater.announcement);
    }
  }, [updater.announcement]);

  const closeDialog = () => setActiveDialog(null);

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setSelectedTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const currentNote = openNotes.find((item) => item.id === selectedTab);
  const downloadPercent = updater.status.state === 'download-progress' ? updater.status.percent : null;
  useEffect(() => {
    document.title =
      currentNote && vault
        ? `${currentNote.title} – ${vault.name} – A11y Notebook`
        : `A11y Notebook${vault ? ` – ${vault.name}` : ''}`;
  }, [currentNote, vault]);

  return (
    <div className="app-shell" aria-label="A11y Notebook application shell">
      <header className="app-header" aria-label="Application header">
        <div className="title-block">
          <h1>A11y Notebook</h1>
          <span className="current-item">
            {currentNote?.title ?? 'No note open'} / {vault?.name ?? 'No vault open'}
          </span>
        </div>
        <div className="global-search">
          <label htmlFor="global-search" className="sr-only">
            Global search
          </label>
          <input
            id="global-search"
            ref={searchRef}
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search vault, notes, tasks, files"
          />
        </div>
      </header>

      <nav className="menu-bar" aria-label="Main menu">
        {menuGroups.map((group) => {
          const labelId = `menu-group-${group.label.toLowerCase()}`;
          return (
            <div key={group.label} className="menu-group" role="group" aria-labelledby={labelId}>
              <span id={labelId} className="menu-label">
                {group.label}
              </span>
              {group.items.map((commandId) => {
                const command = getCommandById(commandId);
                if (!command) return null;
                return (
                  <button
                    key={command.id}
                    type="button"
                    className="menu-item"
                    onClick={() => handleCommand(command.id)}
                    aria-keyshortcuts={command.shortcut ? toAriaKeyShortcut(command.shortcut) : undefined}
                  >
                    {command.label}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <main className="workspace" aria-label="Workspace layout">
        <aside
          ref={navigationRef}
          className={activeRegion === 'navigation' ? 'panel active-panel' : 'panel'}
          data-region="navigation"
          aria-label="Navigation pane"
          tabIndex={-1}
        >
          <h2>{vault?.name ?? 'Vault'}</h2>
          <div className="vault-actions">
            <button type="button" onClick={() => void createNote()} disabled={!vault}>
              New note
            </button>
            <button
              type="button"
              onClick={() => {
                if (!vault || !window.a11yNotebook) return;
                const name = window.prompt('New notebook name');
                if (name?.trim()) void window.a11yNotebook.vault.createNotebook(name.trim()).then(setVault);
              }}
              disabled={!vault}
            >
              New notebook
            </button>
            <button
              type="button"
              onClick={() => {
                if (treeSelection && findEntry(vault?.entries ?? [], treeSelection)?.kind === 'notebook' && window.a11yNotebook)
                  void window.a11yNotebook.vault
                    .importFile(treeSelection)
                    .then((updated) => updated && setVault(updated));
                else setStatusMessage('Select a notebook before importing a file.');
              }}
              disabled={!vault || findEntry(vault.entries, treeSelection)?.kind !== 'notebook'}
            >
              Import file
            </button>
          </div>
          {vault ? (
            <VaultTree
              entries={vault.entries}
              selectedPath={treeSelection}
              onSelect={(entry) => setTreeSelection(entry.path)}
              onOpen={(entry) => void openEntry(entry)}
              onRename={(entryPath, name) => void window.a11yNotebook?.vault.rename(entryPath, name).then(setVault)}
              onDelete={(entryPath) =>
                void window.a11yNotebook?.vault.delete(entryPath).then((updated) => {
                  setVault(updated);
                  if (selectedTab === entryPath) setSelectedTab('welcome');
                })
              }
            />
          ) : (
            <p>Open a folder as a local vault from the Vault menu.</p>
          )}
          {searchResults.length ? (
            <section aria-label="Search results">
              <h3>{searchResults.length} search results</h3>
              <ul>
                {searchResults.map((entry) => (
                  <li key={entry.path}>
                    <button type="button" onClick={() => void openEntry(entry)}>
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <section className="content-panel" aria-label="Main content">
          <div
            ref={tabListRef}
            className={activeRegion === 'tabs' ? 'tab-bar active-panel' : 'tab-bar'}
            data-region="tabs"
            role="tablist"
            aria-label="Open tabs"
          >
            {tabs.map((tab, index) => {
              const selected = selectedTab === tab.id;
              return (
                <div key={tab.id} className="tab-control">
                  <button
                    ref={(element) => {
                      tabRefs.current[tab.id] = element;
                    }}
                    id={`tab-${tab.id}`}
                    type="button"
                    className={selected ? 'tab active-tab' : 'tab'}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={TAB_PANEL_ID}
                    aria-label={tab.label}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setSelectedTab(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                  >
                    {tab.label}
                  </button>
                  {tab.id !== 'welcome' ? (
                    <button
                      type="button"
                      className="close-tab"
                      aria-label={`Close ${tab.label}`}
                      onClick={() => {
                        const note = openNotes.find((item) => item.id === tab.id);
                        if (
                          note &&
                          note.content !== note.saved &&
                          !window.confirm(`Discard unsaved changes to ${note.title}?`)
                        )
                          return;
                        setOpenNotes((current) => current.filter((item) => item.id !== tab.id));
                        if (selected) setSelectedTab('welcome');
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <article
            ref={tabPanelRef}
            id={TAB_PANEL_ID}
            className={activeRegion === 'main' ? 'document active-panel' : 'document'}
            data-region="main"
            role="tabpanel"
            aria-labelledby={`tab-${selectedTab}`}
            tabIndex={0}
          >
            {currentNote ? (
              <>
                <h2>{currentNote.title}</h2>
                {mode === 'edit' ? (
                  <button type="button" onClick={() => void saveActiveNote()}>
                    Save note
                  </button>
                ) : null}
                <MarkdownDocument
                  content={currentNote.content}
                  mode={mode}
                  onChange={(content) =>
                    setOpenNotes((current) =>
                      current.map((note) => (note.id === currentNote.id ? { ...note, content } : note)),
                    )
                  }
                  onSave={() => void saveActiveNote()}
                />
              </>
            ) : (
              <div className="document-body">
                <h2>Welcome to A11y Notebook</h2>
                <p>Open or create a local vault to begin organizing Markdown notes and attachments.</p>
                <p>
                  Use F6 and Shift+F6 to move between panes, Ctrl+K for commands, and Ctrl+E to switch read/edit mode.
                </p>
              </div>
            )}
          </article>
        </section>

        {rightPaneOpen ? (
          <aside
            ref={rightPaneRef}
            className={activeRegion === 'right-pane' ? 'side-panel active-panel' : 'side-panel'}
            data-region="right-pane"
            aria-label="Right information pane"
            tabIndex={-1}
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

      <footer ref={statusRef} className="status-bar" data-region="status" aria-label="Status bar" tabIndex={-1}>
        <span className="status-message" role="status" aria-live="polite">
          {statusMessage}
        </span>
        {downloadPercent !== null ? <span>Update download: {downloadPercent}%</span> : null}
        <span>Pane: {REGION_LABELS[activeRegion]}</span>
        <span>Mode: {mode}</span>
      </footer>

      {activeDialog === 'palette' ? <CommandPalette onRun={handleCommand} onClose={closeDialog} /> : null}
      {activeDialog === 'shortcuts' ? <KeyboardShortcutsDialog onClose={closeDialog} /> : null}
      {activeDialog === 'about' ? <AboutDialog onClose={closeDialog} /> : null}
      {activeDialog === 'updates' ? (
        <UpdateDialog
          status={updater.status}
          announcement={updater.announcement}
          currentVersion={__APP_VERSION__}
          onDownload={updater.download}
          onInstallNow={updater.installNow}
          onInstallOnExit={() => {
            void updater.installOnExit().then((accepted) => {
              if (accepted) {
                closeDialog();
                setStatusMessage('The update will be installed when you exit A11y Notebook.');
              }
            });
          }}
          onRetry={updater.check}
          onClose={closeDialog}
        />
      ) : null}
    </div>
  );
}
