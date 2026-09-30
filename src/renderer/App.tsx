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
import { sampleVault, sampleNotebook, sampleDocument } from '../shared/sample-data';
import type { AppMode, FocusRegion, FocusTarget } from '../shared/types';
import CommandPalette from './components/CommandPalette';
import { AboutDialog, KeyboardShortcutsDialog } from './components/HelpDialogs';
import UpdateDialog from './components/UpdateDialog';
import { useUpdater } from './hooks/useUpdater';

type DialogId = 'palette' | 'updates' | 'shortcuts' | 'about';

const TABS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'notes', label: 'Notes' },
  { id: 'tasks', label: 'Tasks' },
];

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
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  const updater = useUpdater();

  const searchRef = useRef<HTMLInputElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabPanelRef = useRef<HTMLElement>(null);
  const rightPaneRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLElement>(null);

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

  const handleCommand = (commandId: CommandId) => {
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
        nextIndex = (index + 1) % TABS.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index - 1 + TABS.length) % TABS.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    setSelectedTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const currentTab = selectedTab === 'welcome' ? sampleDocument : sampleNotebook.documents[0];
  const downloadPercent = updater.status.state === 'download-progress' ? updater.status.percent : null;

  return (
    <div className="app-shell" aria-label="A11y Notebook application shell">
      <header className="app-header" aria-label="Application header">
        <div className="title-block">
          <h1>A11y Notebook</h1>
          <span className="current-item">
            {sampleVault.name} / {sampleNotebook.name}
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
            ref={tabListRef}
            className={activeRegion === 'tabs' ? 'tab-bar active-panel' : 'tab-bar'}
            data-region="tabs"
            role="tablist"
            aria-label="Open tabs"
          >
            {TABS.map((tab, index) => {
              const selected = selectedTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(element) => {
                    tabRefs.current[tab.id] = element;
                  }}
                  id={`tab-${tab.id}`}
                  type="button"
                  className={selected ? 'tab active-tab' : 'tab'}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={TAB_PANEL_ID}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setSelectedTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {tab.label}
                </button>
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
            <h2>{currentTab.title}</h2>
            <p>{currentTab.summary}</p>
            <div className="document-body" contentEditable={mode === 'edit'} suppressContentEditableWarning>
              <p>
                Welcome to A11y Notebook. This first foundation shows the accessible shell, focus regions, and command
                model. More advanced vault and document features are planned in later phases.
              </p>
              <p>
                Use F6 and Shift+F6 to move between the main panes, Control+K to open command search, and the status bar
                to confirm the current state.
              </p>
            </div>
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
